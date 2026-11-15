import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink, twoFactor, username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { BRAND_NAME } from "@/lib/brand";
import { USER_KINDS, type UserKind, type UserStatus } from "@/server/authz/actor";
import { db } from "@/server/db/client";
import {
  account,
  authRateLimit,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from "@/server/db/schema";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, normaliseEmail, normaliseUsername } from "./accounts";
import { sendAuthEmail } from "./email";
import { isLearnerPlaceholderEmail } from "./learner-email";
import { clearFailedSignIns, isLockedOut, recordFailedSignIn } from "./lockout";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPassword } from "./password-policy";

/**
 * Better Auth 1.7 on our Drizzle schema (docs/ARCHITECTURE.md "Identity").
 *
 * - Parents and staff: email and password. Parents may also use a magic link.
 * - Learners: username and password. They have no email (see `learner-email.ts`).
 * - Staff: TOTP second factor; sessions end 12 hours after sign-in, whatever happens.
 * - Accounts are only ever created by our services (`accounts.ts`), never by a public Better Auth
 *   route, because the under-13 block, consent and seat limits live in those services.
 *
 * Everything that decides "may this person have a session?" is in `beforeSessionCreate`, the one
 * place every sign-in method passes through.
 */

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** Spec 3.1: staff sessions expire after 12 hours. Enforced here, by a database trigger and again in `getCtx`. */
export const STAFF_SESSION_SECONDS = 12 * HOUR;
/** Learners and parents: seven days, renewed on use… */
export const SESSION_SECONDS = 7 * DAY;
/** …but never longer than 30 days without signing in again. */
export const SESSION_ABSOLUTE_SECONDS = 30 * DAY;

/** A user with one of these statuses cannot sign in, and `getCtx` treats them as signed out. */
export const SIGNED_OUT_STATUSES: ReadonlySet<UserStatus> = new Set(["banned", "deleted", "locked"]);

/** A session created on one of these routes has just passed a second-factor check. */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);
const SIGN_IN_PATHS: ReadonlySet<string> = new Set(["/sign-in/username", "/sign-in/email"]);
/** Routes that take a new password, and the body field that holds it. */
const NEW_PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
};

const isKnownKind = (kind: unknown): kind is UserKind => USER_KINDS.includes(kind as UserKind);

const LOCKED_MESSAGE =
  "Too many wrong passwords, so sign-in is paused for about 15 minutes. Try again later, or ask a parent to reset your password.";

type SignInTarget = { id: string; failedSigninCount: number; lockedUntil: Date | null };

/** Finds the account a sign-in attempt is aimed at, by username or email. */
async function findSignInTarget(path: string, body: Record<string, unknown>): Promise<SignInTarget | null> {
  const columns = { id: user.id, failedSigninCount: user.failedSigninCount, lockedUntil: user.lockedUntil };
  if (path === "/sign-in/username" && typeof body.username === "string") {
    const rows = await db
      .select(columns)
      .from(user)
      .where(eq(user.username, normaliseUsername(body.username)))
      .limit(1);
    return rows[0] ?? null;
  }
  if (path === "/sign-in/email" && typeof body.email === "string") {
    const rows = await db
      .select(columns)
      .from(user)
      .where(eq(user.email, normaliseEmail(body.email)))
      .limit(1);
    return rows[0] ?? null;
  }
  return null;
}

function bodyOf(ctx: { body?: unknown }): Record<string, unknown> {
  return ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
}

/** Replaces a learner's placeholder email with null wherever Better Auth is about to return a user. */
function hidePlaceholderEmail(returned: unknown): void {
  if (!returned || typeof returned !== "object" || returned instanceof Response || returned instanceof Error)
    return;
  const maybeUser = (returned as { user?: unknown }).user;
  if (!maybeUser || typeof maybeUser !== "object") return;
  const record = maybeUser as Record<string, unknown>;
  if (typeof record.email === "string" && isLearnerPlaceholderEmail(record.email)) record.email = null;
}

/**
 * Builds a Better Auth instance. Use `getAuth()` / `auth`; this is exported only so that tests can
 * build one with rate limiting switched on.
 */
export function createAuth(overrides: { rateLimited?: boolean } = {}) {
  // Off locally and in tests, so development and end-to-end runs are not throttled.
  const rateLimited = overrides.rateLimited ?? (env.APP_ENV === "production" || env.APP_ENV === "preview");

  return betterAuth({
    appName: BRAND_NAME,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
    telemetry: { enabled: false },

    database: drizzleAdapter(db, {
      provider: "pg",
      // Keys are Better Auth's model names; values are our tables.
      schema: { user, session, account, verification, twoFactor: twoFactorTable, rateLimit: authRateLimit },
    }),

    advanced: {
      // UUIDs everywhere: the database generates them with gen_random_uuid().
      database: { generateId: "uuid" },
    },

    // Our services create accounts; nobody signs themselves up, renames themselves or sets an
    // avatar URL through Better Auth's own routes. Username look-ups would let anyone enumerate learners.
    disabledPaths: [
      "/sign-up/email",
      "/update-user",
      "/change-email",
      "/delete-user",
      "/is-username-available",
    ],

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Parents and staff must prove their address. Learners are created already "verified".
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: HOUR,
      revokeSessionsOnPasswordReset: true,
      // Parents and staff only: a teen's password is reset from the parent dashboard.
      sendResetPassword: async ({ user: target, url }) => {
        await sendAuthEmail({ kind: "reset_password", to: target.email, url, userId: target.id });
      },
    },

    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user: target, url }) => {
        await sendAuthEmail({ kind: "verify_email", to: target.email, url, userId: target.id });
      },
    },

    user: {
      additionalFields: {
        // `input: false`: can never be set from a request body.
        kind: { type: "string", required: true, input: false },
        status: { type: "string", required: false, defaultValue: "active", input: false },
      },
    },

    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: DAY,
      // No cookie cache: pausing, locking or banning an account must take effect on the next request.
      cookieCache: { enabled: false },
      additionalFields: {
        twoFactorVerified: { type: "boolean", required: false, defaultValue: false, input: false },
        absoluteExpiresAt: { type: "date", required: false, input: false },
      },
    },

    rateLimit: {
      enabled: rateLimited,
      storage: "database",
      window: 60,
      max: 100,
    },

    plugins: [
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        // The nickname lives on learner_profile; a second display copy of the username is not needed.
        displayUsername: false,
      }),
      magicLink({
        expiresIn: 10 * 60,
        disableSignUp: true,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // Parents only. Staff need a second factor and learners have no email. Stay silent
          // otherwise, so the form never reveals whether an address has an account.
          const rows = await db
            .select({ kind: user.kind, status: user.status })
            .from(user)
            .where(eq(user.email, normaliseEmail(email)))
            .limit(1);
          const target = rows[0];
          if (!target || target.kind !== "parent" || SIGNED_OUT_STATUSES.has(target.status)) return;
          await sendAuthEmail({ kind: "magic_link", to: email, url });
        },
      }),
      twoFactor({
        issuer: BRAND_NAME,
        skipVerificationOnEnable: false,
      }),
      // Must stay last: it copies cookies set by the plugins above into Next.js responses.
      nextCookies(),
    ],

    databaseHooks: {
      session: {
        create: {
          /** The single gate every new session passes through, whatever the sign-in method. */
          before: async (newSession, hookCtx) => {
            const rows = await db
              .select({
                kind: user.kind,
                status: user.status,
                lockedUntil: user.lockedUntil,
                twoFactorEnabled: user.twoFactorEnabled,
              })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .limit(1);
            const owner = rows[0];
            const now = new Date();

            if (!owner || !isKnownKind(owner.kind) || SIGNED_OUT_STATUSES.has(owner.status)) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_UNAVAILABLE",
                message:
                  "This account can't be used to sign in right now. If you think that's a mistake, contact support.",
              });
            }
            if (isLockedOut(owner, now)) {
              throw new APIError("TOO_MANY_REQUESTS", { code: "ACCOUNT_LOCKED", message: LOCKED_MESSAGE });
            }

            const path = hookCtx?.path ?? "";
            if (path === "/magic-link/verify" && owner.kind !== "parent") {
              throw new APIError("FORBIDDEN", {
                code: "MAGIC_LINK_NOT_ALLOWED",
                message: "Sign-in links are for parent accounts only. Please sign in with your password.",
              });
            }

            // Staff: 12 hours from sign-in. Everyone else: renewed on use, 30 days at most.
            const ceilingSeconds = owner.kind === "staff" ? STAFF_SESSION_SECONDS : SESSION_ABSOLUTE_SECONDS;
            let ceiling = new Date(now.getTime() + ceilingSeconds * 1000);
            // A session that replaces another (first-time 2FA set-up) keeps the earlier ceiling.
            const carried = (newSession as { absoluteExpiresAt?: unknown }).absoluteExpiresAt;
            if (carried instanceof Date && carried.getTime() < ceiling.getTime()) ceiling = carried;
            const expiresAt =
              newSession.expiresAt.getTime() > ceiling.getTime() ? ceiling : newSession.expiresAt;

            return {
              data: {
                expiresAt,
                absoluteExpiresAt: ceiling,
                // Only a session minted by a successful second-factor check counts as verified.
                twoFactorVerified: owner.twoFactorEnabled && SECOND_FACTOR_PATHS.has(path),
              },
            };
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path ?? "";
        const body = bodyOf(ctx);

        // A learner's placeholder address is not an identifier: nothing may sign in, reset or verify with it.
        if (typeof body.email === "string" && isLearnerPlaceholderEmail(body.email)) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_EMAIL",
            message: "That email address can't be used here.",
          });
        }

        // Check the lock before the password is looked at, so a locked account answers the same
        // way to a right and a wrong password.
        if (SIGN_IN_PATHS.has(path)) {
          const target = await findSignInTarget(path, body);
          if (target && isLockedOut(target, new Date())) {
            throw new APIError("TOO_MANY_REQUESTS", { code: "ACCOUNT_LOCKED", message: LOCKED_MESSAGE });
          }
        }

        const passwordField = NEW_PASSWORD_FIELDS[path];
        const newPassword = passwordField ? body[passwordField] : undefined;
        if (typeof newPassword === "string") {
          const result = await checkPassword(newPassword, { breachCheck: env.PASSWORD_BREACH_CHECK });
          if (!result.ok) {
            throw new APIError("BAD_REQUEST", {
              code: `PASSWORD_${result.problem.toUpperCase()}`,
              message: result.message,
            });
          }
        }

        // "Trust this device" would let a later sign-in skip the second factor. Staff must pass it every time.
        if (path.startsWith("/two-factor/verify-") && "trustDevice" in body) body.trustDevice = false;

        // Two-step sign-in is for staff (required) and parents (optional). A learner who lost their
        // authenticator would be locked out with no way for a parent to help, so learners cannot switch it on.
        if (path === "/two-factor/enable") {
          const current = await getSessionFromCtx(ctx);
          const kind = (current?.user as { kind?: unknown } | undefined)?.kind;
          if (kind !== "staff" && kind !== "parent") {
            throw new APIError("FORBIDDEN", {
              code: "TWO_FACTOR_NOT_AVAILABLE",
              message: "Two-step sign-in isn't available for this account.",
            });
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        const path = ctx.path ?? "";
        const returned: unknown = ctx.context.returned;

        if (SIGN_IN_PATHS.has(path)) {
          const target = await findSignInTarget(path, bodyOf(ctx));
          if (target) {
            const failed = returned instanceof APIError;
            if (failed && returned.statusCode === 401) {
              await recordFailedSignIn(db, target.id, new Date());
            } else if (!failed && (target.failedSigninCount > 0 || target.lockedUntil !== null)) {
              // The password was right (a 2FA challenge may still follow).
              await clearFailedSignIns(db, target.id);
            }
          }
        }

        hidePlaceholderEmail(returned);
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Kept on `globalThis` so dev hot reload does not build a second instance. */
const globalForAuth = globalThis as typeof globalThis & { __platformAuth?: Auth };

/** The lazily created Better Auth instance. Nothing reads the environment until the first call. */
export function getAuth(): Auth {
  return (globalForAuth.__platformAuth ??= createAuth());
}

/** `auth.api.getSession(...)`, `auth.handler(request)`: a lazy proxy over `getAuth()`. */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const real = getAuth();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
