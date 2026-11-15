import { eq, sql } from "drizzle-orm";
import type { UserKind } from "@/server/authz/actor";
import type { Db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { logWarn } from "@/server/log";

/**
 * Brief account lockout after repeated failed sign-ins (spec 3.1).
 *
 * Five failures inside fifteen minutes lock sign-in for fifteen minutes. The lock is the
 * `user.locked_until` timestamp, not `status = 'locked'`: it lifts by itself, it does not end a
 * session that is already signed in (so a stranger who knows a username cannot kick a learner out
 * mid-lesson), and it never overwrites a deliberate pause or lock set by a parent or staff.
 */

export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export type FailedSignInResult = {
  failedCount: number;
  /** True only for the attempt that caused the lock. */
  lockedNow: boolean;
  lockedUntil: Date | null;
};

/** True while sign-in is refused. */
export function isLockedOut(row: { lockedUntil: Date | null }, now: Date): boolean {
  return row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime();
}

/**
 * Counts one failed sign-in and locks the account when the limit is reached. A single UPDATE, so
 * parallel attempts cannot lose a count. Returns `null` when the user does not exist.
 */
export async function recordFailedSignIn(
  db: Db,
  userId: string,
  now: Date,
): Promise<FailedSignInResult | null> {
  const nowIso = now.toISOString();
  const windowFloorIso = new Date(now.getTime() - LOCKOUT_WINDOW_MS).toISOString();
  const lockUntilIso = new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString();

  // "A new window starts" when there is none, or the current one began more than 15 minutes ago.
  const startsNewWindow = sql`(${user.failedSigninWindowStartedAt} IS NULL OR ${user.failedSigninWindowStartedAt} < ${windowFloorIso}::timestamptz)`;
  const nextCount = sql`(CASE WHEN ${startsNewWindow} THEN 1 ELSE ${user.failedSigninCount} + 1 END)`;

  const rows = await db
    .update(user)
    .set({
      failedSigninCount: sql`${nextCount}`,
      failedSigninWindowStartedAt: sql`CASE WHEN ${startsNewWindow} THEN ${nowIso}::timestamptz ELSE ${user.failedSigninWindowStartedAt} END`,
      lockedUntil: sql`CASE WHEN ${nextCount} >= ${LOCKOUT_MAX_FAILURES} THEN ${lockUntilIso}::timestamptz ELSE ${user.lockedUntil} END`,
    })
    .where(eq(user.id, userId))
    .returning({
      kind: user.kind,
      failedCount: user.failedSigninCount,
      lockedUntil: user.lockedUntil,
    });

  const row = rows[0];
  if (!row) return null;

  // The attempt that reaches the limit is the one that sets locked_until to exactly now + 15 minutes.
  const lockedNow =
    row.failedCount >= LOCKOUT_MAX_FAILURES &&
    row.lockedUntil !== null &&
    row.lockedUntil.getTime() === new Date(lockUntilIso).getTime();

  if (lockedNow && row.lockedUntil) {
    try {
      await notifyParentOfLockedAccount({ userId, kind: row.kind, lockedUntil: row.lockedUntil });
    } catch (error) {
      // A failed notice must never turn a wrong password into a server error.
      logWarn("auth.lockout.notify_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { failedCount: row.failedCount, lockedNow, lockedUntil: row.lockedUntil };
}

/** Called after a successful sign-in, and when a parent or staff member resets the password. */
export async function clearFailedSignIns(db: Db, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ failedSigninCount: 0, failedSigninWindowStartedAt: null, lockedUntil: null })
    .where(eq(user.id, userId));
}

// ── Hook for the notifications system ───────────────────────────────────────

export type AccountLockedEvent = { userId: string; kind: UserKind; lockedUntil: Date };
export type AccountLockedHandler = (event: AccountLockedEvent) => Promise<void>;

const globalForLockout = globalThis as typeof globalThis & {
  __platformAccountLockedHandler?: AccountLockedHandler;
};

/**
 * HOOK — NOT YET WIRED. Spec 3.1: "Repeated failed sign-ins briefly lock the account and notify
 * the parent." The notifications system registers its handler here with
 * `setAccountLockedHandler(...)`: for a learner it should send the linked parents an immediate
 * safety notice; for a parent or staff account, email the account holder.
 * Until a handler is registered this does nothing.
 */
export async function notifyParentOfLockedAccount(event: AccountLockedEvent): Promise<void> {
  await globalForLockout.__platformAccountLockedHandler?.(event);
}

export function setAccountLockedHandler(handler: AccountLockedHandler | undefined): void {
  globalForLockout.__platformAccountLockedHandler = handler;
}
