import { eq } from "drizzle-orm";
import type { Ctx } from "@/server/context";
import { course } from "@/server/db";
import { AppError, type ErrorCode } from "@/server/errors";
import { LIVE_COURSE_STATUSES } from "./course-store";
import { canAccessCourse } from "./entitlements";
import { getLearnerSummary } from "./family";
import { getControls } from "./parent-controls";
import { checkStart, type StartBlocker, type StartDecision } from "./start-gate";
import { checkLearningAllowed, type LearningAllowed } from "./usage";

/**
 * The gate every learning request passes (brief: "Start and every step load, autosave and quiz
 * attempt run `checkStart` and `checkLearningAllowed` on the server; a direct link is refused the
 * same way as the button"). Pages render it; services assert it.
 */
export type LearningGate = { decision: StartDecision; allowed: LearningAllowed };

/**
 * The floor under the start gate: the four checks this slice can make from its own data, made
 * every time whatever `checkStart` answers. The course is live; the learner is old enough
 * (`minAge` is hard, whatever the pathway); no parent block on the course or its category; and a
 * paid course is covered by the family's plan. Tool policy, tool approvals and Pro approval are the
 * start gate's alone.
 */
async function floorBlockers(ctx: Ctx, learnerId: string, courseId: string): Promise<StartBlocker[]> {
  const [row] = await ctx.db
    .select({ id: course.id, status: course.status, takenDownAt: course.takenDownAt, publishedVersionId: course.publishedVersionId, minAge: course.minAge, category: course.category, isFree: course.isFree })
    .from(course)
    .where(eq(course.id, courseId))
    .limit(1);
  const live = row !== undefined && (LIVE_COURSE_STATUSES as readonly string[]).includes(row.status) && row.takenDownAt === null && row.publishedVersionId !== null;
  if (!row || !live) return [{ code: "course_unavailable", message: "This course isn't available at the moment." }];

  const blockers: StartBlocker[] = [];
  const [summary, controls] = await Promise.all([getLearnerSummary(ctx, learnerId), getControls(ctx, learnerId)]);
  if (summary.age < row.minAge) blockers.push({ code: "age_restricted", message: "This course isn't available for your age group yet." });
  if (controls.blockedCourseIds.includes(row.id) || (row.category !== null && controls.blockedCategories.includes(row.category))) {
    blockers.push({ code: "parent_blocked", message: "This course isn't available on your account." });
  }
  if (blockers.length === 0 && !row.isFree && !(await canAccessCourse(ctx, learnerId, { id: row.id, isFree: row.isFree }))) {
    blockers.push({ code: "entitlement_required", message: "This course needs a parent or carer to unlock it.", ask: "unlock_paid_course" });
  }
  return blockers;
}

export async function getLearningGate(ctx: Ctx, learnerId: string, courseId: string): Promise<LearningGate> {
  const [decision, allowed, floor] = await Promise.all([checkStart(ctx, learnerId, courseId), checkLearningAllowed(ctx, learnerId), floorBlockers(ctx, learnerId, courseId)]);
  // One blocker per reason: the start gate's wording wins where both report the same thing.
  const seen = new Set(decision.blockers.map((blocker) => blocker.code));
  const blockers = [...decision.blockers, ...floor.filter((blocker) => !seen.has(blocker.code))];
  return { decision: { allowed: decision.allowed && blockers.length === 0, blockers }, allowed };
}

export const gateOpen = (gate: LearningGate): boolean => gate.decision.allowed && gate.decision.blockers.length === 0 && gate.allowed.allowed;

const has = (gate: LearningGate, code: StartBlocker["code"]): boolean => gate.decision.blockers.some((blocker) => blocker.code === code);

/**
 * Blockers a learner must never be able to tell apart from "no such course": the age gate and a
 * parent's block (spec 3.2: "never sees or can open … including via a direct link"; "hidden").
 */
export const gateHidden = (gate: LearningGate): boolean => has(gate, "age_restricted") || has(gate, "parent_blocked");

/** The course has been taken down or unpublished. */
export const gateUnavailable = (gate: LearningGate): boolean => has(gate, "course_unavailable");

type TimeReason = "time_cap" | "quiet_hours";
const isTimeReason = (reason: string): reason is TimeReason => reason === "time_cap" || reason === "quiet_hours";

/**
 * Set when the ONLY thing in the way is the clock: the daily cap or quiet hours. Those are the
 * stops that can arrive in the middle of a sentence, so work in hand is saved before stopping.
 */
export function timeStop(gate: LearningGate): { reason: TimeReason; message: string } | null {
  if (gateOpen(gate)) return null;
  let stop: { reason: TimeReason; message: string } | null = null;
  for (const blocker of gate.decision.blockers) {
    if (blocker.code !== "not_allowed_now" || !isTimeReason(blocker.reason)) return null;
    stop ??= { reason: blocker.reason, message: blocker.message };
  }
  if (!gate.allowed.allowed) {
    if (!isTimeReason(gate.allowed.reason)) return null;
    // Our own wording wins: it names the time quiet hours end.
    stop = { reason: gate.allowed.reason, message: gate.allowed.message };
  }
  return stop;
}

const NOW_CODES: Record<Extract<LearningAllowed, { allowed: false }>["reason"], ErrorCode> = {
  paused: "paused",
  time_cap: "time_cap_reached",
  quiet_hours: "quiet_hours",
  consent: "consent_required",
  not_active: "paused",
};

const NOT_FOUND = "That course could not be found. It may have been moved or removed.";

/** The error for a closed gate, or null when the learner may carry on. */
export function gateError(gate: LearningGate): AppError | null {
  if (gateOpen(gate)) return null;
  // Hidden and unavailable courses answer exactly like a course that does not exist.
  if (gateHidden(gate) || gateUnavailable(gate)) return new AppError("not_found", NOT_FOUND, { detail: { blockers: gate.decision.blockers.map((blocker) => blocker.code) } });
  if (!gate.allowed.allowed) return new AppError(NOW_CODES[gate.allowed.reason], gate.allowed.message);
  const [blocker] = gate.decision.blockers;
  if (!blocker) return new AppError("forbidden", "You can't open this course at the moment.");
  switch (blocker.code) {
    case "not_allowed_now":
      return new AppError(NOW_CODES[blocker.reason], blocker.message);
    case "entitlement_required":
      // 403, not the default 402: nothing a learner sees should hint at paying.
      return new AppError("entitlement_required", blocker.message, { status: 403 });
    case "pro_approval_required":
    case "tool_approval_required":
      return new AppError("parent_approval_required", blocker.message);
    case "tool_blocked":
    case "tool_on_hold":
      return new AppError("tool_blocked", blocker.message);
    default:
      return new AppError("forbidden", blocker.message);
  }
}

export async function assertLearningGate(ctx: Ctx, learnerId: string, courseId: string): Promise<LearningGate> {
  const gate = await getLearningGate(ctx, learnerId, courseId);
  const error = gateError(gate);
  if (error) throw error;
  return gate;
}
