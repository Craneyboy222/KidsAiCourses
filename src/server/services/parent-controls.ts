// CONTRACT — owner: parents slice. See _contract.ts.
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { cleanPauseReason, controlsInputSchema, type ControlsInput } from "@/lib/parents/controls-rules";
import { appErrorCode } from "@/lib/parents/error-code";
import { revokeAllSessions } from "@/server/auth/accounts";
import { audit } from "@/server/audit";
import { actorUserId, assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, family, familyMember, learnerProfile, parentControl, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { notify } from "@/server/notifications";
import { effectiveQuietWindow } from "@/server/notifications/quiet-hours";
import { getSetting } from "@/server/settings/store";
import { ageFromBirth, safetyBandForAge, stricterBand } from "./age";
import { CONSENT_HOLD, missingRequiredConsents } from "./consent";
import { LIVE_COURSE_STATUSES } from "./course-store";
import { getLearnerSummary, isIndependentLearner, type LearnerSummary } from "./family";

export type ParentControls = {
  /** null means no cap. */
  dailyMinutesCap: number | null;
  /** Minutes since midnight, UK time. Equal values mean no quiet hours. */
  quietStartMin: number;
  quietEndMin: number;
  blockedCategories: string[];
  blockedCourseIds: string[];
  requireApprovalForPro: boolean;
  paused: boolean;
  pausedReason: string | null;
};

/** No limits of any kind: what an 18-year-old who runs their own account gets. */
export const NO_CONTROLS: ParentControls = {
  dailyMinutesCap: null,
  quietStartMin: 0,
  quietEndMin: 0,
  blockedCategories: [],
  blockedCourseIds: [],
  requireApprovalForPro: false,
  paused: false,
  pausedReason: null,
};

/** `user.status_reason` written when a parent's pause is what holds the account. */
export const PARENT_PAUSE_REASON = "paused_by_parent";
const CONSENT_HOLD_REASONS: ReadonlySet<string> = new Set(Object.values(CONSENT_HOLD));

type QuietDefault = { start: string; end: string };

/**
 * What applies to a learner whose parent has set nothing: the site's default quiet hours, and no
 * other limit. The default comes from the `site.default_quiet_hours` setting, the same one the
 * notification rules read, so "quiet" always means the same window.
 */
export function siteDefaultControls(quietDefault: QuietDefault): ParentControls {
  const window = effectiveQuietWindow(null, quietDefault);
  return { ...NO_CONTROLS, quietStartMin: window?.startMin ?? 0, quietEndMin: window?.endMin ?? 0 };
}

type ControlRow = {
  dailyMinutesCap: number | null;
  quietStartMin: number | null;
  quietEndMin: number | null;
  blockedCategories: string[];
  blockedCourseIds: string[];
  requireApprovalForPro: boolean;
  paused: boolean;
  pausedReason: string | null;
};

/** A parent's saved row, with the site default filling in quiet hours they have never chosen. Pure. */
export function controlsFromRow(row: ControlRow, quietDefault: QuietDefault): ParentControls {
  const window = effectiveQuietWindow(row, quietDefault);
  return {
    dailyMinutesCap: row.dailyMinutesCap !== null && row.dailyMinutesCap >= 0 ? row.dailyMinutesCap : null,
    quietStartMin: window?.startMin ?? 0,
    quietEndMin: window?.endMin ?? 0,
    blockedCategories: [...row.blockedCategories],
    blockedCourseIds: [...row.blockedCourseIds],
    requireApprovalForPro: row.requireApprovalForPro,
    paused: row.paused,
    pausedReason: row.paused ? row.pausedReason : null,
  };
}

/**
 * Who may read a learner's controls: the learner (they are told what is set on their account), a
 * parent or carer in the same family, staff, and background jobs. Callers have usually checked
 * already; this is the floor under them, so an id from a URL can never read another family's settings.
 */
function assertMayRead(ctx: Pick<Ctx, "actor">, learnerId: string, familyId: string | null): void {
  const { actor } = ctx;
  if (actor.type === "system") return;
  if (actor.type === "staff" && actor.twoFactorVerified) return;
  if (actor.type === "learner" && actor.userId === learnerId) return;
  if (actor.type === "parent" && familyId !== null && actor.familyId === familyId) return;
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  throw new AppError("forbidden", "You don't have permission to do that.");
}

type Loaded = { controls: ParentControls; familyId: string | null; customised: boolean; hasParentLink: boolean; updatedAt: Date | null };

async function loadControls(ctx: Pick<Ctx, "db" | "now" | "actor">, learnerId: string): Promise<Loaded> {
  const [row] = await ctx.db
    .select({
      kind: user.kind,
      familyId: familyMember.familyId,
      ownerUserId: family.ownerUserId,
      birthYear: learnerProfile.birthYear,
      birthMonth: learnerProfile.birthMonth,
      storedBand: learnerProfile.safetyBand,
      controlId: parentControl.id,
      dailyMinutesCap: parentControl.dailyMinutesCap,
      quietStartMin: parentControl.quietStartMin,
      quietEndMin: parentControl.quietEndMin,
      blockedCategories: parentControl.blockedCategories,
      blockedCourseIds: parentControl.blockedCourseIds,
      requireApprovalForPro: parentControl.requireApprovalForPro,
      paused: parentControl.paused,
      pausedReason: parentControl.pausedReason,
      updatedAt: parentControl.updatedAt,
    })
    .from(user)
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .leftJoin(family, eq(family.id, familyMember.familyId))
    .leftJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    // Only a row written for the family the learner is in now: limits never follow them out of it.
    .leftJoin(parentControl, and(eq(parentControl.learnerId, user.id), eq(parentControl.familyId, familyMember.familyId)))
    .where(eq(user.id, learnerId))
    .limit(1);
  const familyId = row?.familyId ?? null;
  assertMayRead(ctx, learnerId, familyId);

  // A parent link is a family that somebody else owns. No family, or a family of their own, is none.
  const hasParentLink = familyId !== null && row?.ownerUserId !== learnerId;
  let adult = false;
  if (row && row.birthYear !== null && row.birthMonth !== null && row.storedBand !== null) {
    const live = safetyBandForAge(ageFromBirth(row.birthYear, row.birthMonth, ctx.now));
    // The stricter of the live and stored bands, as everywhere else: nobody is treated as older than they are.
    adult = live !== null && stricterBand(live, row.storedBand) === "adult_18";
  }
  if (adult && !hasParentLink) return { controls: { ...NO_CONTROLS }, familyId, customised: false, hasParentLink, updatedAt: null };

  const quietDefault = await getSetting(ctx, "site.default_quiet_hours");
  if (!row || row.controlId === null) return { controls: siteDefaultControls(quietDefault), familyId, customised: false, hasParentLink, updatedAt: null };
  return {
    controls: controlsFromRow(
      {
        dailyMinutesCap: row.dailyMinutesCap,
        quietStartMin: row.quietStartMin,
        quietEndMin: row.quietEndMin,
        blockedCategories: row.blockedCategories ?? [],
        blockedCourseIds: row.blockedCourseIds ?? [],
        requireApprovalForPro: row.requireApprovalForPro ?? false,
        paused: row.paused ?? false,
        pausedReason: row.pausedReason,
      },
      quietDefault,
    ),
    familyId,
    customised: true,
    hasParentLink,
    updatedAt: row.updatedAt,
  };
}

/** Effective controls for a learner, with site defaults applied when a parent has set nothing. adult_18 learners with no parent link get no caps. */
export async function getControls(ctx: Ctx, learnerId: string): Promise<ParentControls> {
  return (await loadControls(ctx, learnerId)).controls;
}

// ── The parent's side ───────────────────────────────────────────────────────

export type ControlsView = {
  learner: LearnerSummary;
  controls: ParentControls;
  /** False while the site defaults apply because nothing has been saved for this child. */
  customised: boolean;
  /** True for an 18-year-old who runs their own account: shown, but no longer a parent's to change. */
  independent: boolean;
  updatedAt: Date | null;
};

type ControlAction = "family.controls.read" | "family.controls.update" | "family.child.pause";

/**
 * Loads the child and checks the actor against the family the child is really in. A child in
 * another family, and an id that is nobody's, give the same "not found": nothing is confirmed.
 */
async function childFor(ctx: Ctx, learnerId: string, action: ControlAction): Promise<LearnerSummary & { familyId: string }> {
  if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  let learner: LearnerSummary | null = null;
  try {
    learner = await getLearnerSummary(ctx, learnerId);
  } catch (error) {
    if (appErrorCode(error) !== "not_found") throw error;
  }
  const notFound = new AppError("not_found", "That child could not be found in your family.");
  if (ctx.actor.type === "parent" && (!learner || learner.familyId !== ctx.actor.familyId)) throw notFound;
  if (!learner || !learner.familyId) throw notFound;
  assertCan(ctx.actor, action, { learnerId, familyId: learner.familyId });
  return { ...learner, familyId: learner.familyId };
}

/** Everything the controls screen needs for one child. */
export async function getControlsForParent(ctx: Ctx, learnerId: string): Promise<ControlsView> {
  const learner = await childFor(ctx, learnerId, "family.controls.read");
  const [loaded, independent] = await Promise.all([loadControls(ctx, learnerId), isIndependentLearner(ctx, learnerId)]);
  return { learner, controls: loaded.controls, customised: loaded.customised, independent, updatedAt: loaded.updatedAt };
}

async function assertStillManaged(ctx: Ctx, learner: LearnerSummary): Promise<void> {
  if (await isIndependentLearner(ctx, learner.learnerId)) {
    throw new AppError("forbidden", `${learner.nickname} is 18 and runs their own account now, so these settings are no longer yours to change.`);
  }
  if (learner.status === "pending_deletion") {
    throw new AppError("conflict", `${learner.nickname}'s account is set to be deleted. You can undo that from your Privacy page.`);
  }
}

export type BlockableCourse = { id: string; title: string; category: string | null; difficulty: "starter" | "builder" | "pro" | null };

/** Live courses this child is old enough to see: the ones it makes sense to offer for blocking. */
export async function listBlockableCourses(ctx: Ctx, learnerId: string): Promise<BlockableCourse[]> {
  const learner = await childFor(ctx, learnerId, "family.controls.read");
  return ctx.db
    .select({ id: course.id, title: course.title, category: course.category, difficulty: course.difficulty })
    .from(course)
    .where(and(inArray(course.status, [...LIVE_COURSE_STATUSES]), isNull(course.takenDownAt), lte(course.minAge, learner.age)))
    .orderBy(asc(course.title));
}

/**
 * Saves a parent's limits for one child. Takes effect on the child's next request: nothing here
 * is cached. A pause is not touched (see `pauseLearner` and `resumeLearner`).
 */
export async function updateControls(ctx: Ctx, learnerId: string, input: ControlsInput): Promise<ParentControls> {
  const learner = await childFor(ctx, learnerId, "family.controls.update");
  await assertStillManaged(ctx, learner);
  const parsed = controlsInputSchema.parse(input);

  if (parsed.blockedCourseIds.length > 0) {
    const known = await ctx.db.select({ id: course.id }).from(course).where(inArray(course.id, parsed.blockedCourseIds));
    if (known.length !== parsed.blockedCourseIds.length) {
      throw new AppError("invalid_input", "One of those courses couldn't be found. Refresh the page and try again.", {
        fieldErrors: { blockedCourseIds: ["One of those courses couldn't be found. Refresh the page and try again."] },
      });
    }
  }

  const before = (await loadControls(ctx, learnerId)).controls;
  const values = {
    dailyMinutesCap: parsed.dailyMinutesCap,
    quietStartMin: parsed.quietStartMin,
    quietEndMin: parsed.quietEndMin,
    blockedCategories: parsed.blockedCategories,
    blockedCourseIds: parsed.blockedCourseIds,
    requireApprovalForPro: parsed.requireApprovalForPro,
    updatedBy: actorUserId(ctx.actor),
    updatedAt: ctx.now,
  };
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(parentControl)
      .values({ learnerId, familyId: learner.familyId, ...values, createdAt: ctx.now })
      // One row per learner. A row left from an earlier family is taken over, not kept.
      .onConflictDoUpdate({ target: parentControl.learnerId, set: { familyId: learner.familyId, ...values } });
    const changed = (["dailyMinutesCap", "quietStartMin", "quietEndMin", "blockedCategories", "blockedCourseIds", "requireApprovalForPro"] as const).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(parsed[key]),
    );
    await audit(
      ctx,
      {
        action: "family.controls.update",
        targetType: "user",
        targetId: learnerId,
        meta: {
          familyId: learner.familyId,
          changed,
          dailyMinutesCap: parsed.dailyMinutesCap,
          quietStartMin: parsed.quietStartMin,
          quietEndMin: parsed.quietEndMin,
          blockedCategories: parsed.blockedCategories,
          blockedCourseCount: parsed.blockedCourseIds.length,
          requireApprovalForPro: parsed.requireApprovalForPro,
        },
      },
      tx,
    );
  });
  return (await loadControls(ctx, learnerId)).controls;
}

export type PauseResult = { learnerId: string; paused: boolean; status: LearnerSummary["status"]; waitingForConsent: boolean };

/** Tells the child in the app. Never fails the parent's change. */
async function tellChild(ctx: Ctx, learnerId: string, input: { type: string; title: string; body: string }): Promise<void> {
  try {
    await notify(ctx, { userId: learnerId, ...input, href: "/settings", channels: ["in_app"], dedupeKey: `${input.type}:${learnerId}:${ctx.now.getTime()}` });
  } catch (error) {
    logWarn("parent_controls.notify_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Pauses a child's account (spec 3.6: "Pause immediately ends learner sessions"). The child is
 * signed out everywhere at once. They can still sign in, where they see that the account is paused
 * and the parent's reason, but nothing can be learnt, saved or sent until it is resumed.
 */
export async function pauseLearner(ctx: Ctx, learnerId: string, input: { reason?: string | null } = {}): Promise<PauseResult> {
  const learner = await childFor(ctx, learnerId, "family.child.pause");
  await assertStillManaged(ctx, learner);
  const reason = cleanPauseReason(input.reason);
  if (!reason.ok) throw new AppError("invalid_input", reason.message, { fieldErrors: { reason: [reason.message] } });

  const status = await ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ status: user.status }).from(user).where(eq(user.id, learnerId)).for("update");
    if (!target) throw new AppError("not_found", "That child could not be found in your family.");
    const values = { paused: true, pausedReason: reason.value, pausedAt: ctx.now, updatedBy: actorUserId(ctx.actor), updatedAt: ctx.now };
    await tx
      .insert(parentControl)
      .values({ learnerId, familyId: learner.familyId, ...values, createdAt: ctx.now })
      .onConflictDoUpdate({ target: parentControl.learnerId, set: { familyId: learner.familyId, ...values } });
    let next = target.status;
    // An account already held for another reason (permissions not finished) keeps that reason:
    // the pause is on the controls row and applies as soon as the other hold is lifted.
    if (target.status === "active") {
      await tx.update(user).set({ status: "paused", statusReason: PARENT_PAUSE_REASON, updatedAt: ctx.now }).where(eq(user.id, learnerId));
      next = "paused";
    }
    await revokeAllSessions(tx, learnerId);
    await audit(ctx, { action: "family.child.pause", targetType: "user", targetId: learnerId, meta: { familyId: learner.familyId, withReason: reason.value !== null } }, tx);
    return next;
  });

  await tellChild(ctx, learnerId, {
    type: "account.paused_by_parent",
    title: "Your account is paused",
    body: `A parent or carer has paused your account for now. Everything you've made is safe.${reason.value ? ` Their note: "${reason.value}"` : ""} Talk to them about when it will be switched back on.`,
  });
  return { learnerId, paused: true, status, waitingForConsent: false };
}

/**
 * Lifts a parent's pause. The account becomes active again unless something else is holding it:
 * permissions that are still needed keep it held until the consent centre is complete.
 */
export async function resumeLearner(ctx: Ctx, learnerId: string): Promise<PauseResult> {
  const learner = await childFor(ctx, learnerId, "family.child.pause");
  await assertStillManaged(ctx, learner);

  const outcome = await ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ status: user.status, statusReason: user.statusReason }).from(user).where(eq(user.id, learnerId)).for("update");
    if (!target) throw new AppError("not_found", "That child could not be found in your family.");
    const cleared = await tx
      .update(parentControl)
      .set({ paused: false, pausedReason: null, pausedAt: null, updatedBy: actorUserId(ctx.actor), updatedAt: ctx.now })
      .where(and(eq(parentControl.learnerId, learnerId), eq(parentControl.paused, true)))
      .returning({ id: parentControl.id });

    let status = target.status;
    let waitingForConsent = false;
    const heldByParent = target.status === "paused" && (target.statusReason === null || target.statusReason === PARENT_PAUSE_REASON);
    if (heldByParent) {
      const missing = await missingRequiredConsents({ db: tx }, learnerId);
      if (missing.length > 0) {
        // Never switch an account on without the permissions it needs.
        await tx.update(user).set({ statusReason: CONSENT_HOLD.required, updatedAt: ctx.now }).where(eq(user.id, learnerId));
        waitingForConsent = true;
      } else {
        await tx.update(user).set({ status: "active", statusReason: null, updatedAt: ctx.now }).where(eq(user.id, learnerId));
        status = "active";
      }
    } else if (target.status === "paused" && CONSENT_HOLD_REASONS.has(target.statusReason ?? "")) {
      waitingForConsent = true;
    }
    if (cleared.length > 0 || heldByParent) {
      await audit(ctx, { action: "family.child.resume", targetType: "user", targetId: learnerId, meta: { familyId: learner.familyId, status, waitingForConsent } }, tx);
    }
    return { status, waitingForConsent, changed: cleared.length > 0 || heldByParent };
  });

  if (outcome.changed && outcome.status === "active") {
    await tellChild(ctx, learnerId, { type: "account.resumed_by_parent", title: "Your account is back on", body: "A parent or carer has switched your account back on. Everything is where you left it." });
  }
  return { learnerId, paused: false, status: outcome.status, waitingForConsent: outcome.waitingForConsent };
}
