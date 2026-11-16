// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "@/server/context";
import { course, unlockRequest } from "@/server/db";
import { LIVE_COURSE_STATUSES } from "./course-store";
import { approvalFactsFor, assertMayAskAbout, courseVersionFor, loadCourseTools, toToolFacts, toolsOnHold } from "./course-tools";
import { canAccessCourse } from "./entitlements";
import { getLearnerSummary } from "./family";
import { getControls } from "./parent-controls";
import { decideStart, type RequiredToolFacts } from "./start-rules";
import { checkLearningAllowed } from "./usage";

export type StartBlocker =
  | { code: "course_unavailable"; message: string }
  | { code: "age_restricted"; message: string }
  | { code: "parent_blocked"; message: string }
  | { code: "not_allowed_now"; message: string; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active" }
  | { code: "entitlement_required"; message: string; ask: "unlock_paid_course" }
  | { code: "pro_approval_required"; message: string; ask: "unlock_pro_course" }
  | { code: "tool_blocked"; message: string; toolSlug: string; toolName: string }
  | { code: "tool_approval_required"; message: string; toolSlug: string; toolName: string; policy: "parent_consent_required" | "parent_operated"; status: "none" | "pending" | "declined" | "revoked"; ask: "tool_approval" }
  | { code: "tool_on_hold"; message: string; toolSlug: string; toolName: string };

export type StartDecision = { allowed: boolean; blockers: StartBlocker[] };

/**
 * Every reason a learner may not start or continue a course, in one place (spec 3.2, 3.3, Section 7):
 * the course is published and not taken down; `minAge` (hard, whatever the pathway); parent blocks on the
 * course or its category; account state, consent, cap and quiet hours; plan entitlement; Pro approval;
 * and for every required tool: approved in the Register and not blocked for this learner, a valid parent
 * approval where the policy needs one, `minAge` compatible with the tool, and no open age-policy change event.
 * A blocked main tool is satisfied by an approved fallback.
 * The same function gates direct links, enrolment, every step load and autosave.
 *
 * A `needs_review` course is still available. A course the learner is too young for, or that a
 * parent has blocked, reports only that: nothing else about it is revealed. The decision itself is
 * `decideStart` in `start-rules.ts`; this function gathers the facts.
 */
export async function checkStart(ctx: Ctx, learnerId: string, courseId: string): Promise<StartDecision> {
  await assertMayAskAbout(ctx, learnerId);

  const [row] = await ctx.db
    .select({ id: course.id, status: course.status, takenDownAt: course.takenDownAt, publishedVersionId: course.publishedVersionId, minAge: course.minAge, category: course.category, isFree: course.isFree, difficulty: course.difficulty })
    .from(course)
    .where(eq(course.id, courseId))
    .limit(1);
  const live = row !== undefined && (LIVE_COURSE_STATUSES as readonly string[]).includes(row.status) && row.takenDownAt === null && row.publishedVersionId !== null;
  const empty = { learnerAge: 0, parentBlocked: false, notAllowedNow: null, entitled: true, proApprovalMissing: false, tools: [], approvals: {} };
  if (!row || !live) return decideStart({ ...empty, course: null });

  const summary = await getLearnerSummary(ctx, learnerId);
  const controls = await getControls(ctx, learnerId);
  const parentBlocked = controls.blockedCourseIds.includes(row.id) || (row.category !== null && controls.blockedCategories.includes(row.category));
  const courseFacts = { live: true, minAge: row.minAge };
  // Stop here for a hidden course: no need to look anything else up, and nothing else to give away.
  if (summary.age < row.minAge || parentBlocked) return decideStart({ ...empty, course: courseFacts, learnerAge: summary.age, parentBlocked });

  const [allowed, entitled, versionId] = await Promise.all([
    checkLearningAllowed(ctx, learnerId),
    row.isFree ? Promise.resolve(true) : canAccessCourse(ctx, learnerId, { id: row.id, isFree: row.isFree }),
    courseVersionFor(ctx, learnerId, row),
  ]);

  let proApprovalMissing = false;
  if (row.difficulty === "pro" && controls.requireApprovalForPro) {
    const [approved] = await ctx.db
      .select({ id: unlockRequest.id })
      .from(unlockRequest)
      .where(and(eq(unlockRequest.learnerId, learnerId), eq(unlockRequest.courseId, row.id), eq(unlockRequest.kind, "pro_course"), eq(unlockRequest.status, "approved")))
      .limit(1);
    proApprovalMissing = !approved;
  }

  const entries = versionId ? (await loadCourseTools(ctx, versionId)).filter((entry) => entry.required) : [];
  const rows = entries.flatMap((entry) => (entry.fallback ? [entry.tool, entry.fallback] : [entry.tool]));
  const [held, approvals] = await Promise.all([toolsOnHold(ctx, rows.map((entry) => entry.id)), approvalFactsFor(ctx, learnerId, row.id, rows)]);
  const tools: RequiredToolFacts[] = entries.map((entry) => ({
    tool: toToolFacts(entry.tool, held.has(entry.tool.id)),
    fallback: entry.fallback ? toToolFacts(entry.fallback, held.has(entry.fallback.id)) : null,
  }));

  return decideStart({
    course: courseFacts,
    learnerAge: summary.age,
    parentBlocked,
    notAllowedNow: allowed.allowed ? null : { reason: allowed.reason, message: allowed.message },
    entitled,
    proApprovalMissing,
    tools,
    approvals,
  });
}
