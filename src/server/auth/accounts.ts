import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { UserKind, UserStatus } from "@/server/authz/actor";
import type { Db } from "@/server/db/client";
import { account, session, user } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { isLearnerPlaceholderEmail, newLearnerPlaceholderEmail } from "./learner-email";
import { clearFailedSignIns } from "./lockout";
import { assertPasswordAllowed } from "./password";

/**
 * Creating accounts and setting passwords, for the sign-up, family and staff services.
 *
 * Public sign-up through Better Auth's own HTTP routes is switched off (`auth.ts`), because who
 * may hold an account is decided by our services: the under-13 block, the 18+ confirmation for
 * parents, whether sign-up is open, seat limits and consent. Those services call the functions
 * here inside their own transaction, so a user, its profile and its family membership are created
 * together or not at all.
 *
 * Rows are written exactly as Better Auth expects to read them: a `credential` account whose
 * `account_id` is the user id and whose `password` is Better Auth's scrypt hash.
 */

export type UserRow = typeof user.$inferSelect;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
/** Letters, digits, underscores and dots: the same shape Better Auth's username plugin accepts at sign-in. */
const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

/** Lower-cases and trims. Usernames are case-insensitive everywhere. */
export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Shape only. The personal-information and profanity checks belong to the family service. */
export function isValidUsernameShape(username: string): boolean {
  const u = normaliseUsername(username);
  return u.length >= USERNAME_MIN_LENGTH && u.length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(u);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type CreateAccountInput = {
  kind: UserKind;
  /** Display name. For a learner, the nickname: never a full name. */
  name: string;
  /** Required for parents and staff. Leave out for a learner, who gets an internal placeholder. */
  email?: string | null;
  /** Required for learners. */
  username?: string | null;
  /** Leave out when the learner will set their own with an invite code, or a parent will use a magic link. */
  password?: string | null;
  status?: UserStatus;
  /** True once the address is proven, e.g. a parent who arrived by an emailed link. Learners are always true. */
  emailVerified?: boolean;
};

/**
 * Inserts the `user` row and, when a password is given, its `credential` account.
 * Pass a transaction as `db` to create the profile and family rows alongside.
 */
export async function createAccount(db: Db, input: CreateAccountInput): Promise<UserRow> {
  const isLearner = input.kind === "learner";
  const username = input.username ? normaliseUsername(input.username) : null;
  const realEmail = input.email ? normaliseEmail(input.email) : null;

  if (realEmail && isLearnerPlaceholderEmail(realEmail)) {
    throw new AppError("invalid_input", "That email address can't be used. Please try a different one.");
  }
  if (!isLearner && !realEmail) {
    throw new AppError("invalid_input", "An email address is needed for this account.");
  }
  if (isLearner && !username) {
    throw new AppError("invalid_input", "Choose a username for this account.");
  }
  if (username && !isValidUsernameShape(username)) {
    throw new AppError(
      "invalid_input",
      `Usernames need ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters, using only letters, numbers, dots and underscores.`,
      { fieldErrors: { username: ["Use only letters, numbers, dots and underscores."] } },
    );
  }
  if (input.password) {
    await assertPasswordAllowed(input.password, { username, name: input.name, email: realEmail });
  }

  // A learner without an email gets the non-routable placeholder (see learner-email.ts).
  const email = realEmail ?? newLearnerPlaceholderEmail();
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .insert(user)
        .values({
          kind: input.kind,
          name: input.name.trim(),
          email,
          // Better Auth refuses sign-in while this is false; a placeholder has nothing to verify.
          emailVerified: realEmail ? (input.emailVerified ?? false) : true,
          username,
          status: input.status ?? "active",
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error("User insert returned no row");
      if (passwordHash) {
        await tx.insert(account).values({
          userId: created.id,
          providerId: "credential",
          accountId: created.id,
          password: passwordHash,
        });
      }
      return created;
    });
  } catch (error) {
    throw translateUniqueViolation(error) ?? error;
  }
}

/**
 * Sets or replaces a password: a parent resetting a child's, a learner redeeming an invite code,
 * staff resetting on a parent's behalf. Checks the policy, signs the user out everywhere and
 * clears any sign-in lock. The caller is responsible for authorisation and the audit entry.
 */
export async function setAccountPassword(db: Db, userId: string, password: string): Promise<void> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, username: user.username })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AppError("not_found", "That account could not be found.");

  await assertPasswordAllowed(password, {
    username: target.username,
    name: target.name,
    email: isLearnerPlaceholderEmail(target.email) ? null : target.email,
  });
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: passwordHash })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx
        .insert(account)
        .values({ userId, providerId: "credential", accountId: userId, password: passwordHash });
    }
    await tx.delete(session).where(eq(session.userId, userId));
    await clearFailedSignIns(tx, userId);
  });
}

/**
 * Signs a user out everywhere at once. Used when a parent pauses a child (spec 3.6), when an
 * account is locked or banned, and after a password change. Returns how many sessions ended.
 */
export async function revokeAllSessions(db: Db, userId: string): Promise<number> {
  const ended = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  return ended.length;
}

/** Turns a Postgres unique violation on username or email into a message a person can act on. */
function translateUniqueViolation(error: unknown): AppError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === "23505") {
      const constraint = String(e.constraint_name ?? e.constraint ?? "");
      if (constraint === "user_username_uq") {
        return new AppError("conflict", "That username is already taken. Try another one.", {
          fieldErrors: { username: ["That username is already taken."] },
        });
      }
      if (constraint === "user_email_uq") {
        // Deliberately vague: do not confirm to a stranger that an address has an account.
        return new AppError(
          "conflict",
          "We couldn't create that account. If you already have one, try signing in.",
        );
      }
    }
    current = e.cause;
  }
  return null;
}
