import { and, eq, like, lte, or } from "drizzle-orm";
import { env } from "@/env";
import { formatDate } from "@/lib/dates";
import { normaliseEmail } from "@/server/auth/accounts";
import { isLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import { assertPasswordAllowed } from "@/server/auth/password";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { hashToken, newToken, sign } from "@/server/crypto";
import { auditLog, consentRecord, creditLedger, parentLinkRequest, rateLimitBucket, user, withAppendOnlyMaintenance, type Db } from "@/server/db";
import { sendEmail } from "@/server/email";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { rateLimit } from "@/server/ratelimit";
import { getSetting } from "@/server/settings";
import { ADULT_AGE } from "./age";
import { assertOldEnough, assertSignupOpen, assertUsernameAllowed, insertLearner, type Birth } from "./signup";

/**
 * Teen-first sign-up (spec 3.1, Section 4).
 *
 * A teenager gives a birth month and year, picks a username and password, and gives a parent's
 * email address. The account is `pending_parent`: locked, with no Coach, no saved work and no
 * certificate (the authz matrix refuses those for any status but `active`). The parent is emailed
 * a link that works for 7 days. If nobody approves in that time the account is deleted with
 * everything attached to it, and the teen is told this before they sign up.
 *
 * Because the account may be deleted without trace, nothing about a pending teen is written to
 * the audit log: an audit row would outlive them.
 */

export const PENDING_TEEN_DAYS = 7;
export const PENDING_TEEN_MS = PENDING_TEEN_DAYS * 24 * 60 * 60 * 1000;
/** The first email plus two reminders the teen can ask for. */
export const MAX_APPROVAL_EMAILS = 3;

export type TeenSignupInput = Birth & { username: string; password: string; parentEmail: string };
export type TeenSignupResult = { learnerId: string; username: string; expiresAt: Date };

export function approvalUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/approve/${token}`;
}

async function sendApprovalEmail(ctx: Pick<Ctx, "db" | "now">, input: { parentEmail: string; username: string; token: string; expiresAt: Date }): Promise<void> {
  await sendEmail(ctx, {
    to: input.parentEmail,
    template: "parent_approval_request",
    // The teen has given no nickname or real name: the username (already checked for personal details) stands in.
    data: { nickname: input.username, url: approvalUrl(input.token), expiresOn: formatDate(input.expiresAt) },
  });
}

/**
 * Removes a pending teen completely: the user row (profile, link request, sessions, password,
 * notifications and any trial progress go with it by cascade), rate-limit counters keyed by their
 * id, and any append-only rows that mention them. Runs in the caller's maintenance transaction.
 */
async function eraseUser(tx: Db, userId: string): Promise<boolean> {
  // Lock the row and look again: a parent may have approved the account a moment ago, and an
  // approved learner's consent and audit records must never be touched from here.
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.kind, "learner"), eq(user.status, "pending_parent")))
    .for("update");
  if (rows.length === 0) return false;
  await tx.delete(auditLog).where(or(eq(auditLog.actorId, userId), eq(auditLog.targetId, userId)));
  await tx.delete(consentRecord).where(eq(consentRecord.learnerId, userId));
  await tx.delete(creditLedger).where(eq(creditLedger.learnerId, userId));
  await tx.delete(rateLimitBucket).where(like(rateLimitBucket.key, `%:user:${userId}`));
  await tx.delete(user).where(and(eq(user.id, userId), eq(user.kind, "learner"), eq(user.status, "pending_parent")));
  return true;
}

/**
 * Deletes one pending teen and everything about them. Does nothing, and returns false, if the
 * account is no longer pending.
 */
export async function erasePendingTeen(ctx: Pick<Ctx, "db">, learnerId: string): Promise<boolean> {
  return withAppendOnlyMaintenance(ctx.db, "account_deletion", (tx) => eraseUser(tx, learnerId));
}

/**
 * Creates the pending account and emails the parent. If the email cannot be sent, the account is
 * removed again and the teen is asked to check the address, so that nothing is left waiting for
 * an approval that can never come.
 */
export async function signUpTeen(ctx: Ctx, input: TeenSignupInput): Promise<TeenSignupResult> {
  const birth = { birthYear: input.birthYear, birthMonth: input.birthMonth };
  // First, before anything typed into the form is looked at. Under 13: counted, then stopped.
  const age = await assertOldEnough(ctx, birth);
  await assertSignupOpen(ctx);
  if (age.age >= ADULT_AGE && (await getSetting(ctx, "site.adult_self_serve"))) {
    throw new AppError("invalid_input", "You're 18 or over, so you can sign up with your own email address. Go back to the start and we'll take you there.");
  }

  const parentEmail = normaliseEmail(input.parentEmail);
  if (isLearnerPlaceholderEmail(parentEmail) || parentEmail.endsWith(".invalid")) {
    throw new AppError("invalid_input", "That email address can't be used. Check your parent or carer's address and try again.", {
      fieldErrors: { parentEmail: ["Check the address."] },
    });
  }
  const username = await assertUsernameAllowed(ctx.db, input.username, { birthYear: input.birthYear });
  await assertPasswordAllowed(input.password, { username });
  // No more than three requests a day to one address, whoever sends them. The key is a keyed hash, not the address.
  await rateLimit(ctx, "signup.teen.parent_email", { limit: 3, windowSec: 24 * 60 * 60, key: sign(`parent-email:${parentEmail}`).slice(0, 32) });

  const token = newToken();
  const expiresAt = new Date(ctx.now.getTime() + PENDING_TEEN_MS);
  const learnerId = await ctx.db.transaction(async (tx) => {
    const learner = await insertLearner(ctx, tx, { nickname: username, username, birth, age, password: input.password, status: "pending_parent" });
    await tx.insert(parentLinkRequest).values({
      learnerId: learner.id,
      parentEmail,
      tokenHash: hashToken(token),
      status: "pending",
      expiresAt,
      lastSentAt: ctx.now,
      sendCount: 1,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return learner.id;
  });

  try {
    await sendApprovalEmail(ctx, { parentEmail, username, token, expiresAt });
  } catch (error) {
    await erasePendingTeen(ctx, learnerId);
    logWarn("signup.teen.approval_email_failed", { error: error instanceof Error ? error.message : String(error) });
    throw new AppError("invalid_input", "We couldn't send an email to that address, so we haven't created your account. Check your parent or carer's email address and try again.", {
      fieldErrors: { parentEmail: ["Check the address."] },
    });
  }
  return { learnerId, username, expiresAt };
}

export type PendingTeenStatus = {
  pending: boolean;
  /** When the account will be deleted if nobody approves it. */
  expiresAt: Date | null;
  emailsSent: number;
  canResend: boolean;
};

/** For the waiting page of a signed-in teen. Never returns the parent's address. */
export async function getPendingTeenStatus(ctx: Ctx): Promise<PendingTeenStatus> {
  if (ctx.actor.type !== "learner" || ctx.actor.status !== "pending_parent") {
    return { pending: false, expiresAt: null, emailsSent: 0, canResend: false };
  }
  const rows = await ctx.db
    .select({ expiresAt: parentLinkRequest.expiresAt, sendCount: parentLinkRequest.sendCount })
    .from(parentLinkRequest)
    .where(and(eq(parentLinkRequest.learnerId, ctx.actor.userId), eq(parentLinkRequest.status, "pending")))
    .limit(1);
  const request = rows[0];
  if (!request) return { pending: true, expiresAt: null, emailsSent: 0, canResend: false };
  return { pending: true, expiresAt: request.expiresAt, emailsSent: request.sendCount, canResend: request.sendCount < MAX_APPROVAL_EMAILS && request.expiresAt > ctx.now };
}

/**
 * The teen asks for the email to be sent again. A new link replaces the old one; the 7-day
 * deadline does not move.
 */
export async function resendParentApproval(ctx: Ctx): Promise<{ emailsSent: number }> {
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "Sign in with your username to do that.");
  assertCan(ctx.actor, "learner.parent_link.resend", { learnerId: ctx.actor.userId });
  if (ctx.actor.status !== "pending_parent") throw new AppError("conflict", "Your account has already been approved, so there's nothing to send.");
  const learnerId = ctx.actor.userId;
  const rows = await ctx.db
    .select({ id: parentLinkRequest.id, parentEmail: parentLinkRequest.parentEmail, expiresAt: parentLinkRequest.expiresAt, sendCount: parentLinkRequest.sendCount, username: user.username })
    .from(parentLinkRequest)
    .innerJoin(user, eq(user.id, parentLinkRequest.learnerId))
    .where(and(eq(parentLinkRequest.learnerId, learnerId), eq(parentLinkRequest.status, "pending")))
    .limit(1);
  const request = rows[0];
  if (!request || request.expiresAt <= ctx.now) {
    throw new AppError("conflict", "The request to your parent or carer has run out. You'll need to sign up again.");
  }
  if (request.sendCount >= MAX_APPROVAL_EMAILS) {
    throw new AppError("rate_limited", "We've already sent the email three times. Ask your parent or carer to check their inbox and junk folder.");
  }
  const token = newToken();
  await ctx.db
    .update(parentLinkRequest)
    .set({ tokenHash: hashToken(token), lastSentAt: ctx.now, sendCount: request.sendCount + 1, updatedAt: ctx.now })
    .where(eq(parentLinkRequest.id, request.id));
  await sendApprovalEmail(ctx, { parentEmail: request.parentEmail, username: request.username ?? "", token, expiresAt: request.expiresAt });
  return { emailsSent: request.sendCount + 1 };
}

/**
 * The daily clean-up (job `accounts.purge_pending`): every teen account still waiting for a
 * parent 7 days after it was created is deleted, with everything about it. Keeps nothing, and
 * reports only how many.
 */
export async function purgePendingTeens(ctx: Pick<Ctx, "db" | "now">): Promise<{ purged: number }> {
  const cutoff = new Date(ctx.now.getTime() - PENDING_TEEN_MS);
  // Due when the emailed link has run out, or (should a request row ever be missing) 7 days after sign-up.
  const rows = await ctx.db
    .select({ id: user.id })
    .from(user)
    .leftJoin(parentLinkRequest, eq(parentLinkRequest.learnerId, user.id))
    .where(
      and(
        eq(user.kind, "learner"),
        eq(user.status, "pending_parent"),
        or(lte(user.createdAt, cutoff), lte(parentLinkRequest.expiresAt, ctx.now)),
      ),
    );
  const due = [...new Set(rows.map((row) => row.id))];
  let purged = 0;
  for (const id of due) if (await erasePendingTeen(ctx, id)) purged += 1;
  return { purged };
}
