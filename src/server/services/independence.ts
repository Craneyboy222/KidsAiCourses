import { and, eq, notInArray, sql } from "drizzle-orm";
import { env } from "@/env";
import { normaliseEmail } from "@/server/auth/accounts";
import { isLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import { audit } from "@/server/audit";
import { assertCan, type LearnerActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { hashToken, newToken } from "@/server/crypto";
import { family, familyMember, learnerProfile, parentControl, user, verification, type Db } from "@/server/db";
import { registerEmailTemplate, sendEmail } from "@/server/email";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { notify } from "@/server/notifications";
import { rateLimit } from "@/server/ratelimit";
import { CONSENT_HOLD, REQUIRED_CONSENT_KEYS, applyConsentChoices, listConsentDefinitions } from "./consent";
import { listParentUserIds } from "./family";
import { revokeInviteCodes } from "./invite";

/**
 * Account independence at 18 (spec 2 and 3.1: "at 18 the learner is offered account independence";
 * "`adult_18` can hold their own account and pay; parent link optional").
 *
 * Two steps, and nothing changes until the second:
 *
 *   1. `requestIndependence`: the learner gives their own email address. We email a link to it.
 *      The address is held in a short-lived `verification` row, not on the account, so a typing
 *      mistake cannot lock them out.
 *   2. `confirmIndependence`: with the link, the learner gives the required consents in their own
 *      name and chooses what happens to the parent link. Their email goes on the account, already
 *      proved. From then on they reset their own password, and a parent can no longer reset it,
 *      remove them or change their consents.
 *
 * The parent link. An account belongs to one family (`family_member` is unique per user), so:
 *   - `remove`: the learner becomes the owner of a new single-seat family on the Free plan and
 *     leaves the parent's family. The parent no longer sees anything.
 *   - `keep`: the learner stays in the parent's family for now (the parent's plan still covers
 *     them and the parent still sees progress). They can remove the link later with
 *     `removeParentLink`, which does the same as `remove`.
 */

export const INDEPENDENCE_LINK_HOURS = 24;
const identifierFor = (userId: string) => `independence:${userId}`;

registerEmailTemplate("independence_confirm_email", {
  audience: "adult_learner",
  category: "transactional",
  description: "Sent to the address an 18-year-old gives when taking over their own account.",
  subject: "Confirm your email to take over your account",
  body: `
You asked to run your own {{brandName}} account using this email address.

[Confirm and continue]({{url}})

The link works for 24 hours, and you need to be signed in to use it. Nothing about your account changes until you finish the next page.

If this wasn't you, ignore this email and nothing will happen.
`,
});

export type IndependenceState = {
  /** 18 or over. Under-18s cannot use any of this. */
  eligible: boolean;
  /** Already runs their own account (has their own confirmed email address). */
  independent: boolean;
  /** Owns the family they are in: a single-seat family of their own. */
  ownsFamily: boolean;
  /** Still in a parent's family. */
  parentLinked: boolean;
  /** A confirmation email has been sent and has not run out. */
  awaitingEmail: boolean;
};

function adultLearner(ctx: Ctx): LearnerActor {
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That page is for learner accounts.");
  assertCan(ctx.actor, "learner.independence.manage", { learnerId: ctx.actor.userId });
  if (ctx.actor.safetyBand !== "adult_18") {
    throw new AppError("age_restricted", "You can take over your own account once you're 18. Until then, your parent or carer looks after it with you.");
  }
  return ctx.actor;
}

async function loadState(ctx: Pick<Ctx, "db" | "now">, learner: LearnerActor, db: Db = ctx.db): Promise<IndependenceState & { familyId: string | null }> {
  const rows = await db
    .select({ email: user.email, emailVerified: user.emailVerified, familyId: familyMember.familyId, ownerUserId: family.ownerUserId })
    .from(user)
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .leftJoin(family, eq(family.id, familyMember.familyId))
    .where(eq(user.id, learner.userId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError("not_found", "We couldn't find your account. Try signing in again.");
  const pending = await db.select({ expiresAt: verification.expiresAt }).from(verification).where(eq(verification.identifier, identifierFor(learner.userId))).limit(1);
  const ownsFamily = row.ownerUserId === learner.userId;
  return {
    eligible: learner.safetyBand === "adult_18",
    independent: !isLearnerPlaceholderEmail(row.email) && row.emailVerified,
    ownsFamily,
    parentLinked: row.familyId !== null && !ownsFamily,
    awaitingEmail: pending[0] !== undefined && pending[0].expiresAt > ctx.now,
    familyId: row.familyId,
  };
}

/** For the independence page. Safe to call for any learner: under-18s just get `eligible: false`. */
export async function getIndependenceState(ctx: Ctx): Promise<IndependenceState> {
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That page is for learner accounts.");
  assertCan(ctx.actor, "learner.independence.manage", { learnerId: ctx.actor.userId });
  const { familyId: _familyId, ...state } = await loadState(ctx, ctx.actor);
  return state;
}

/** Step 1: email a confirmation link to the address the learner gives. Changes nothing on the account. */
export async function requestIndependence(ctx: Ctx, input: { email: string }): Promise<void> {
  const learner = adultLearner(ctx);
  const state = await loadState(ctx, learner);
  if (state.independent) throw new AppError("conflict", "You already run your own account.");
  const email = normaliseEmail(input.email);
  if (isLearnerPlaceholderEmail(email) || email.endsWith(".invalid")) {
    throw new AppError("invalid_input", "That email address can't be used. Try a different one.", { fieldErrors: { email: ["Try a different address."] } });
  }
  await rateLimit(ctx, "independence.request", { limit: 5, windowSec: 60 * 60 });

  const token = newToken();
  const expiresAt = new Date(ctx.now.getTime() + INDEPENDENCE_LINK_HOURS * 60 * 60 * 1000);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifierFor(learner.userId)));
    await tx.insert(verification).values({
      identifier: identifierFor(learner.userId),
      value: JSON.stringify({ email, tokenHash: hashToken(token) }),
      expiresAt,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
  });
  // If the address already belongs to someone else, say nothing here: the confirm step refuses it.
  await sendEmail(ctx, {
    to: email,
    userId: learner.userId,
    template: "independence_confirm_email",
    data: { url: `${env.NEXT_PUBLIC_APP_URL}/settings/independence?token=${encodeURIComponent(token)}` },
  });
}

/** Moves the learner into a new single-seat family that they own. Runs in the caller's transaction. */
async function moveToOwnFamily(ctx: Pick<Ctx, "now">, tx: Db, learnerId: string): Promise<string> {
  const families = await tx.insert(family).values({ ownerUserId: learnerId, plan: "free", createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: family.id });
  const familyId = families[0]?.id;
  if (!familyId) throw new Error("Family insert returned no row");
  const moved = await tx.update(familyMember).set({ familyId, addedBy: null, updatedAt: ctx.now }).where(eq(familyMember.userId, learnerId)).returning({ id: familyMember.id });
  if (moved.length === 0) {
    await tx.insert(familyMember).values({ familyId, userId: learnerId, role: "learner", createdAt: ctx.now, updatedAt: ctx.now });
  }
  // The parent's limits belonged to the link that has just ended, and so did a parent's pause:
  // nobody would be left who could lift it. A hold for consent is not touched here (the consent
  // step that follows decides that), and neither is a lock or ban, which are other statuses.
  const controls = await tx.delete(parentControl).where(eq(parentControl.learnerId, learnerId)).returning({ paused: parentControl.paused });
  if (controls.some((control) => control.paused)) {
    await tx
      .update(user)
      .set({ status: "active", statusReason: null, updatedAt: ctx.now })
      .where(and(eq(user.id, learnerId), eq(user.status, "paused"), notInArray(sql`coalesce(${user.statusReason}, '')`, Object.values(CONSENT_HOLD))));
  }
  await revokeInviteCodes(ctx, learnerId, tx);
  return familyId;
}

async function tellParents(ctx: Ctx, parentIds: string[], nickname: string, linkRemoved: boolean): Promise<void> {
  for (const userId of parentIds) {
    try {
      await notify(ctx, {
        userId,
        type: "account.independence",
        title: `${nickname} now runs their own account`,
        body: linkRemoved
          ? `${nickname} is 18 and has taken over their own account. They have left your family, so you no longer see their progress and they no longer use a place on your plan.`
          : `${nickname} is 18 and has taken over their own account with their own email address. They have chosen to stay linked to your family for now, so you still see their progress. Their password and privacy choices are now theirs to manage.`,
        href: "/parent",
        channels: ["in_app"],
      });
    } catch (error) {
      logWarn("independence.notify_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export type ConfirmIndependenceInput = {
  token: string;
  /** The learner's own consent choices. Every required consent must be true. */
  consents: Record<string, boolean>;
  parentLink: "keep" | "remove";
};

export type ConfirmIndependenceResult = { familyId: string | null; parentLinkRemoved: boolean };

/** Step 2: the learner confirms. Everything happens together or not at all. */
export async function confirmIndependence(ctx: Ctx, input: ConfirmIndependenceInput): Promise<ConfirmIndependenceResult> {
  const learner = adultLearner(ctx);
  const state = await loadState(ctx, learner);
  if (state.independent) throw new AppError("conflict", "You already run your own account.");

  const pendingRows = await ctx.db.select().from(verification).where(eq(verification.identifier, identifierFor(learner.userId))).limit(1);
  const pending = pendingRows[0];
  let parsed: { email?: unknown; tokenHash?: unknown } = {};
  try {
    parsed = pending ? (JSON.parse(pending.value) as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  if (!pending || pending.expiresAt <= ctx.now || typeof parsed.email !== "string" || parsed.tokenHash !== hashToken(input.token)) {
    throw new AppError("invalid_input", "That confirmation link isn't valid or has run out. Enter your email address again and we'll send a new one.");
  }
  const email = parsed.email;

  const definitions = await listConsentDefinitions(ctx);
  const required = new Set<string>([...REQUIRED_CONSENT_KEYS, ...definitions.filter((d) => d.required).map((d) => d.key)]);
  const notGiven = [...required].filter((key) => input.consents[key] !== true);
  if (notGiven.length > 0) {
    throw new AppError("consent_required", "To run your own account we need your own agreement to the required permissions. Tick each one to carry on.", {
      fieldErrors: Object.fromEntries(notGiven.map((key) => [`consent.${key}`, ["Needed to run your account."]])),
    });
  }

  const parentIds = state.parentLinked && state.familyId ? await listParentUserIds(ctx, state.familyId) : [];
  const nicknameRows = await ctx.db.select({ nickname: learnerProfile.nickname }).from(learnerProfile).where(eq(learnerProfile.userId, learner.userId)).limit(1);
  const removeLink = input.parentLink === "remove" || !state.parentLinked;

  let familyId = state.familyId;
  try {
    familyId = await ctx.db.transaction(async (tx) => {
      await tx.update(user).set({ email, emailVerified: true, updatedAt: ctx.now }).where(and(eq(user.id, learner.userId), eq(user.kind, "learner")));
      let ownFamilyId = state.familyId;
      if (removeLink && !state.ownsFamily) ownFamilyId = await moveToOwnFamily(ctx, tx, learner.userId);
      await applyConsentChoices(ctx, tx, {
        learnerId: learner.userId,
        familyId: ownFamilyId,
        actorUserId: learner.userId,
        choices: input.consents,
        method: "independence",
        confirmPause: true,
        reaffirm: true,
      });
      await tx.delete(verification).where(eq(verification.id, pending.id));
      await audit(ctx, { action: "independence.confirm", targetType: "user", targetId: learner.userId, meta: { parentLink: removeLink ? "removed" : "kept" } }, tx);
      return ownFamilyId;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("conflict", "That email address is already used by another account. Enter a different one and we'll send a new link.");
    }
    throw error;
  }

  await tellParents(ctx, parentIds, nicknameRows[0]?.nickname ?? "Your child", removeLink && state.parentLinked);
  return { familyId, parentLinkRemoved: removeLink && state.parentLinked };
}

/** For an independent learner who chose to stay linked: leave the parent's family for a family of their own. */
export async function removeParentLink(ctx: Ctx): Promise<{ familyId: string }> {
  const learner = adultLearner(ctx);
  const state = await loadState(ctx, learner);
  if (!state.independent) throw new AppError("conflict", "Take over your account first. After that you can remove the link to your parent or carer.");
  if (!state.parentLinked || !state.familyId) throw new AppError("conflict", "Your account isn't linked to a parent or carer.");
  const parentIds = await listParentUserIds(ctx, state.familyId);
  const nicknameRows = await ctx.db.select({ nickname: learnerProfile.nickname }).from(learnerProfile).where(eq(learnerProfile.userId, learner.userId)).limit(1);
  const familyId = await ctx.db.transaction(async (tx) => {
    const id = await moveToOwnFamily(ctx, tx, learner.userId);
    await audit(ctx, { action: "independence.remove_parent_link", targetType: "user", targetId: learner.userId }, tx);
    return id;
  });
  await tellParents(ctx, parentIds, nicknameRows[0]?.nickname ?? "Your child", true);
  return { familyId };
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; cause?: unknown };
    if (e.code === "23505") return true;
    current = e.cause;
  }
  return false;
}
