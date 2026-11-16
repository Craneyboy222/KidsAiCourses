import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { normaliseUsername, setAccountPassword } from "@/server/auth/accounts";
import { assertPasswordAllowed } from "@/server/auth/password";
import { audit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import { newCode, sign } from "@/server/crypto";
import { inviteCode, user, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";

/**
 * One-time invite codes (spec 3.1): a parent adds a child without choosing their password, and
 * gives them a code. The child enters the code with their username and picks their own password.
 *
 * - Eight characters from an alphabet with no look-alikes (no 0/O, 1/I/L), shown as `ABCD-EFGH`.
 * - Stored only as a keyed hash (HMAC with the server secret), never in the clear.
 * - Valid for 72 hours, and for one use.
 * - A code is tied to one learner. It must be entered with that learner's username, so a guessed
 *   code is useless by itself, and wrong tries are counted against the code: after five it is
 *   switched off and the parent makes a new one.
 * - Making a new code switches off any earlier unused one for the same learner.
 */

export const INVITE_CODE_LENGTH = 8;
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_TTL_HOURS = 72;
export const INVITE_TTL_MS = INVITE_TTL_HOURS * 60 * 60 * 1000;
export const INVITE_MAX_FAILED_ATTEMPTS = 5;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Upper-cases and drops spaces and hyphens, so `abcd-efgh`, `ABCD EFGH` and `ABCDEFGH` are the same code. */
export function normaliseInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/** True when the text could be a code at all: the right length and only characters we issue. */
export function isInviteCodeShape(raw: string): boolean {
  const code = normaliseInviteCode(raw);
  return code.length === INVITE_CODE_LENGTH && Array.from(code).every((c) => INVITE_CODE_ALPHABET.includes(c));
}

/** `ABCDEFGH` → `ABCD-EFGH`, easier to read out and type. */
export function formatInviteCode(code: string): string {
  const clean = normaliseInviteCode(code);
  const half = Math.ceil(clean.length / 2);
  return `${clean.slice(0, half)}-${clean.slice(half)}`;
}

export function inviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

/** How hard a code is to guess, in bits: log2(alphabet size ^ length). About 39.6 for 31^8. */
export function inviteCodeEntropyBits(): number {
  return INVITE_CODE_LENGTH * Math.log2(INVITE_CODE_ALPHABET.length);
}

/** The keyed hash stored in `invite_code.code_hash`. */
export function hashInviteCode(raw: string): string {
  return sign(`invite:${normaliseInviteCode(raw)}`);
}

export type InviteState = "usable" | "used" | "revoked" | "expired";

export function inviteState(
  row: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date; failedAttempts: number },
  now: Date,
): InviteState {
  if (row.usedAt) return "used";
  if (row.revokedAt || row.failedAttempts >= INVITE_MAX_FAILED_ATTEMPTS) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

// ── Messages ────────────────────────────────────────────────────────────────

const NO_MATCH = "That code and username don't match. Check both, then try again.";
const EXPIRED = "That code has run out. Codes last 72 hours. Ask your parent or carer to make a new one.";
const SWITCHED_OFF =
  "There were too many wrong tries, so that code has been switched off. Ask your parent or carer to make a new one.";
const USED = "That code has already been used. If you've forgotten your password, ask your parent or carer to reset it.";

const noMatch = () =>
  new AppError("invalid_input", NO_MATCH, { fieldErrors: { code: ["Check the code and your username."] } });

// ── Database ────────────────────────────────────────────────────────────────

export type IssuedInvite = {
  /** The code itself. Shown once, to the parent; it cannot be read back later. */
  code: string;
  /** `ABCD-EFGH` */
  formatted: string;
  expiresAt: Date;
};

/**
 * Makes a new code for a learner and switches off any earlier unused one.
 * The caller must already have checked that the actor may do this for this learner.
 * Pass a transaction as `db` to create the code alongside other rows.
 */
export async function createInviteCode(
  ctx: Pick<Ctx, "now">,
  input: { learnerId: string; familyId: string; createdBy: string | null },
  db: Db,
): Promise<IssuedInvite> {
  await db
    .update(inviteCode)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(inviteCode.learnerId, input.learnerId), isNull(inviteCode.usedAt), isNull(inviteCode.revokedAt)));
  const code = newCode(INVITE_CODE_LENGTH);
  const expiresAt = inviteExpiresAt(ctx.now);
  await db.insert(inviteCode).values({
    familyId: input.familyId,
    learnerId: input.learnerId,
    codeHash: hashInviteCode(code),
    expiresAt,
    createdBy: input.createdBy,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  return { code, formatted: formatInviteCode(code), expiresAt };
}

/** Switches off every unused code for a learner, for example when the parent sets a password instead. */
export async function revokeInviteCodes(ctx: Pick<Ctx, "now">, learnerId: string, db: Db): Promise<void> {
  await db
    .update(inviteCode)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(inviteCode.learnerId, learnerId), isNull(inviteCode.usedAt), isNull(inviteCode.revokedAt)));
}

type InviteCtx = Pick<Ctx, "db" | "now" | "actor" | "ip" | "requestId">;

/**
 * Checks a code against the learner it was made for, counting the try. Throws a friendly
 * `AppError` unless the code is right and still usable. Nothing is used up.
 */
export async function verifyInviteCode(
  ctx: InviteCtx,
  input: { username: string; code: string },
): Promise<{ inviteId: string; learnerId: string; familyId: string }> {
  // Per caller, on top of the per-code count below.
  await rateLimit(ctx, "invite.verify", { limit: 20, windowSec: 15 * 60 });

  if (!isInviteCodeShape(input.code)) {
    throw new AppError("invalid_input", "That doesn't look like one of our codes. They have 8 letters and numbers, like ABCD-EFGH.", {
      fieldErrors: { code: ["Codes have 8 letters and numbers."] },
    });
  }
  const username = normaliseUsername(input.username);
  const rows = await ctx.db
    .select({
      id: inviteCode.id,
      learnerId: inviteCode.learnerId,
      familyId: inviteCode.familyId,
      codeHash: inviteCode.codeHash,
      expiresAt: inviteCode.expiresAt,
      usedAt: inviteCode.usedAt,
      revokedAt: inviteCode.revokedAt,
      failedAttempts: inviteCode.failedAttempts,
    })
    .from(inviteCode)
    .innerJoin(user, eq(user.id, inviteCode.learnerId))
    .where(and(eq(user.username, username), eq(user.kind, "learner")))
    .orderBy(desc(inviteCode.createdAt))
    .limit(1);
  const invite = rows[0];
  // Same answer whether the username is unknown or has no code: never confirm that a username exists.
  if (!invite) throw noMatch();

  if (invite.codeHash !== hashInviteCode(input.code)) {
    if (inviteState(invite, ctx.now) !== "usable") throw noMatch();
    const updated = await ctx.db
      .update(inviteCode)
      .set({
        failedAttempts: sql`${inviteCode.failedAttempts} + 1`,
        revokedAt: sql`CASE WHEN ${inviteCode.failedAttempts} + 1 >= ${INVITE_MAX_FAILED_ATTEMPTS} THEN ${ctx.now.toISOString()}::timestamptz ELSE ${inviteCode.revokedAt} END`,
        updatedAt: ctx.now,
      })
      .where(eq(inviteCode.id, invite.id))
      .returning({ failedAttempts: inviteCode.failedAttempts });
    if ((updated[0]?.failedAttempts ?? 0) >= INVITE_MAX_FAILED_ATTEMPTS) {
      throw new AppError("rate_limited", SWITCHED_OFF, { detail: { inviteId: invite.id } });
    }
    throw noMatch();
  }

  // The code is right, so it is safe to say exactly what is wrong with it.
  switch (inviteState(invite, ctx.now)) {
    case "used":
      throw new AppError("conflict", USED);
    case "revoked":
      throw new AppError("conflict", SWITCHED_OFF);
    case "expired":
      throw new AppError("conflict", EXPIRED);
    case "usable":
      return { inviteId: invite.id, learnerId: invite.learnerId, familyId: invite.familyId };
  }
}

/**
 * The child's side of the invite: checks the code, sets the password they chose and uses the code
 * up, all or nothing. A password that breaks the rules does not use up the code or count as a wrong try.
 */
export async function redeemInviteCode(
  ctx: InviteCtx,
  input: { username: string; code: string; password: string },
): Promise<{ learnerId: string }> {
  const verified = await verifyInviteCode(ctx, input);
  const username = normaliseUsername(input.username);
  await assertPasswordAllowed(input.password, { username });

  await ctx.db.transaction(async (tx) => {
    // Claim the code first. Only one of two parallel requests can win this update.
    const claimed = await tx
      .update(inviteCode)
      .set({ usedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(inviteCode.id, verified.inviteId), isNull(inviteCode.usedAt), isNull(inviteCode.revokedAt)))
      .returning({ id: inviteCode.id });
    if (claimed.length === 0) throw new AppError("conflict", USED);
    await setAccountPassword(tx, verified.learnerId, input.password);
    await audit(
      ctx,
      { action: "invite.redeem", targetType: "user", targetId: verified.learnerId, meta: { inviteId: verified.inviteId } },
      tx,
    );
  });
  return { learnerId: verified.learnerId };
}

/**
 * For the page a code link opens: is this code worth typing a username for? Says only `usable`,
 * `expired` or `unknown`, never who the code is for. Rate limited, and it never counts as a try.
 */
export async function peekInviteCode(ctx: InviteCtx, code: string): Promise<"usable" | "expired" | "unknown"> {
  if (!isInviteCodeShape(code)) return "unknown";
  await rateLimit(ctx, "invite.peek", { limit: 30, windowSec: 15 * 60 });
  const rows = await ctx.db
    .select({
      expiresAt: inviteCode.expiresAt,
      usedAt: inviteCode.usedAt,
      revokedAt: inviteCode.revokedAt,
      failedAttempts: inviteCode.failedAttempts,
    })
    .from(inviteCode)
    .where(eq(inviteCode.codeHash, hashInviteCode(code)))
    .limit(1);
  const row = rows[0];
  if (!row) return "unknown";
  const state = inviteState(row, ctx.now);
  return state === "usable" ? "usable" : state === "expired" ? "expired" : "unknown";
}
