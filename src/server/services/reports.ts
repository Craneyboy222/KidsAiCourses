// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import { and, desc, eq, inArray } from "drizzle-orm";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, report, reviewTask, tool } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { notifyStaffWithRole } from "@/server/notifications";
import { enqueueModeration, type ModerationSeverity } from "./moderation";
import { raiseSafeguarding } from "./safeguarding-bridge";

export type ReportReason = "someone_in_danger" | "inappropriate" | "bullying" | "wrong_or_broken" | "guide_mismatch" | "privacy" | "other";
export type ReportTarget = { type: "step" | "course" | "project" | "ai_output" | "guide" | "other"; id: string; courseId?: string; stepKey?: string; toolSlug?: string };

export const REPORT_REASONS: readonly ReportReason[] = ["someone_in_danger", "inappropriate", "bullying", "wrong_or_broken", "guide_mismatch", "privacy", "other"];
export const REPORT_TARGET_TYPES: readonly ReportTarget["type"][] = ["step", "course", "project", "ai_output", "guide", "other"];
export const MAX_REPORT_NOTE = 1000;

type ReportRow = typeof report.$inferSelect;

/** How each reason is stored. The reason exactly as it was chosen is kept in `context.reportedAs`. */
const STORED_REASON: Record<ReportReason, ReportRow["reason"]> = {
  someone_in_danger: "someone_in_danger",
  inappropriate: "unsafe_or_upsetting",
  bullying: "unsafe_or_upsetting",
  wrong_or_broken: "wrong_or_broken",
  guide_mismatch: "guide_mismatch",
  privacy: "privacy",
  other: "other",
};
/** `other` has no stored target type: it is filed against the course (or nothing) and marked in `context.targetType`. */
const STORED_TARGET: Record<ReportTarget["type"], ReportRow["targetType"]> = { step: "step", course: "course", project: "project", ai_output: "ai_output", guide: "tool_guide", other: "course" };

const QUEUE_SEVERITY: Record<Exclude<ReportReason, "someone_in_danger" | "guide_mismatch">, ModerationSeverity> = { inappropriate: "high", bullying: "high", privacy: "high", wrong_or_broken: "normal", other: "normal" };

const TARGET_WORDS: Record<ReportTarget["type"], string> = { step: "A step", course: "A course", project: "A project", ai_output: "A Coach reply", guide: "A setup guide", other: "Something else" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function reporterResource(ctx: Ctx): { userId: string; resource: { learnerId?: string; familyId?: string } } {
  const { actor } = ctx;
  if (actor.type === "learner") return { userId: actor.userId, resource: { learnerId: actor.userId } };
  if (actor.type === "parent") return { userId: actor.userId, resource: { familyId: actor.familyId } };
  if (actor.type === "staff") return { userId: actor.userId, resource: {} };
  throw new AppError("unauthenticated", "Please sign in to send a report.");
}

/**
 * Spec 3.10: a Report control on every step, course, project and AI output.
 * `someone_in_danger` opens a critical safeguarding case immediately; `guide_mismatch` creates a guide-review task for editors;
 * everything else goes to the moderation queue. The reporter always gets a calm confirmation and, for danger, the fixed crisis signposting.
 *
 * The report itself is saved first, so it survives whatever happens next. A danger report never
 * waits for a person and never shows the reporter an error once it is saved. The reporter's own
 * words stay in the report (and, for danger, in the case's encrypted notes): they are never copied
 * into a queue summary, a task or a notification.
 */
export async function createReport(ctx: Ctx, input: { reason: ReportReason; target: ReportTarget; note?: string }): Promise<{ reportId: string; showCrisisScript: boolean }> {
  const reporter = reporterResource(ctx);
  assertCan(ctx.actor, "report.create", reporter.resource);
  if (!REPORT_REASONS.includes(input.reason) || !REPORT_TARGET_TYPES.includes(input.target.type)) throw new AppError("invalid_input", "Choose the reason that fits best, then send your report again.");
  const note = (input.note ?? "").trim().slice(0, MAX_REPORT_NOTE);
  const courseId = input.target.courseId && UUID.test(input.target.courseId) ? input.target.courseId : null;
  const stepKey = input.target.stepKey && KEY.test(input.target.stepKey) ? input.target.stepKey : null;
  const toolSlug = input.target.toolSlug && SLUG.test(input.target.toolSlug) ? input.target.toolSlug : null;
  const learnerId = ctx.actor.type === "learner" ? ctx.actor.userId : null;

  const [row] = await ctx.db
    .insert(report)
    .values({
      reporterId: reporter.userId,
      targetType: STORED_TARGET[input.target.type],
      targetId: UUID.test(input.target.id) ? input.target.id : null,
      context: { targetType: input.target.type, targetRef: input.target.id.slice(0, 100), reportedAs: input.reason, ...(courseId ? { courseId } : {}), ...(stepKey ? { stepKey } : {}), ...(toolSlug ? { toolSlug } : {}) },
      reason: STORED_REASON[input.reason],
      detail: note || null,
      status: "open",
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: report.id });
  if (!row) throw new AppError("internal", "Your report didn't send. Nothing was lost. Try again in a moment.");

  if (input.reason === "someone_in_danger") {
    // Straight to the safeguarding lead. Nothing here may stop the reporter seeing where to get help.
    const opened = await raiseSafeguarding(ctx, { learnerId, severity: "critical", trigger: "danger_report", summary: "A \"Someone is in danger\" report was sent.", sourceType: "report", sourceId: row.id, detail: note || undefined }, { subjectType: "report", subjectId: row.id });
    if (opened.caseId) {
      await ctx.db.update(report).set({ safeguardingCaseId: opened.caseId, status: "triaged", updatedAt: ctx.now }).where(eq(report.id, row.id)).catch((error: unknown) => logError("report.case_link_failed", error, { reportId: row.id }));
    }
    return { reportId: row.id, showCrisisScript: true };
  }

  try {
    if (input.reason === "guide_mismatch") await createGuideReviewTask(ctx, { reportId: row.id, courseId, toolSlug, stepKey, guideKey: input.target.type === "guide" && KEY.test(input.target.id) ? input.target.id : null });
    else await enqueueModeration(ctx, { subjectType: "report", subjectId: row.id, learnerId, source: "report", severity: QUEUE_SEVERITY[input.reason], reason: `Report (${input.reason.replace(/_/g, " ")}) about ${TARGET_WORDS[input.target.type].toLowerCase()}.`, flags: { reportedAs: input.reason, targetType: input.target.type } });
  } catch (error) {
    // The report is saved and open, so staff still see it in the reports list.
    logError("report.routing_failed", error, { reportId: row.id, reason: input.reason });
  }
  return { reportId: row.id, showCrisisScript: false };
}

/** One open guide-review task per course, tool and guide: a second report of the same mismatch does not make a second task. */
async function createGuideReviewTask(ctx: Ctx, input: { reportId: string; courseId: string | null; toolSlug: string | null; stepKey: string | null; guideKey: string | null }): Promise<void> {
  const [target] = input.courseId ? await ctx.db.select({ id: course.id, title: course.title, publishedVersionId: course.publishedVersionId }).from(course).where(eq(course.id, input.courseId)).limit(1) : [];
  const [register] = input.toolSlug ? await ctx.db.select({ id: tool.id, name: tool.name }).from(tool).where(eq(tool.slug, input.toolSlug)).limit(1) : [];
  const open = await ctx.db
    .select({ id: reviewTask.id, courseId: reviewTask.courseId, toolId: reviewTask.toolId, toolGuideKey: reviewTask.toolGuideKey })
    .from(reviewTask)
    .where(and(eq(reviewTask.kind, "guide_review"), inArray(reviewTask.status, ["open", "in_progress"])));
  if (open.some((task) => task.courseId === (target?.id ?? null) && task.toolId === (register?.id ?? null) && task.toolGuideKey === input.guideKey)) return;

  const subject = register ? `${register.name} setup guide` : "a setup guide";
  const [task] = await ctx.db
    .insert(reviewTask)
    .values({
      kind: "guide_review",
      status: "open",
      title: `Check ${subject}${target ? ` in "${target.title}"` : ""}`.slice(0, 200),
      detail: `A learner reported that what they see no longer matches the guide${input.stepKey ? ` (step ${input.stepKey})` : ""}. Check the guide against the live tool, update it or mark it stale, then close this task. The reporter's note, if any, is on the report.`,
      courseId: target?.id ?? null,
      courseVersionId: target?.publishedVersionId ?? null,
      toolId: register?.id ?? null,
      toolGuideKey: input.guideKey,
      reportId: input.reportId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: reviewTask.id });
  if (task) {
    await notifyStaffWithRole(ctx, "editor", { type: "review.guide_mismatch", title: "A setup guide may be out of date", body: `A learner reported that ${subject} no longer matches the tool.`, href: "/studio/review", dedupeKey: `guide-review:${task.id}` });
  }
}

/** A reporter's own reports, newest first, with where each one has got to. Nobody can read another person's. */
export async function listOwnReports(ctx: Ctx, userId: string): Promise<{ id: string; reason: ReportReason; targetLabel: string; status: string; createdAt: Date }[]> {
  const reporter = reporterResource(ctx);
  if (reporter.userId !== userId) throw new AppError("forbidden", "You can only see reports you sent yourself.");
  if (ctx.actor.type !== "staff") assertCan(ctx.actor, "report.read_own", reporter.resource);
  const rows = await ctx.db.select({ id: report.id, reason: report.reason, context: report.context, status: report.status, createdAt: report.createdAt }).from(report).where(eq(report.reporterId, userId)).orderBy(desc(report.createdAt)).limit(100);

  const courseIds = [...new Set(rows.flatMap((row) => (typeof row.context.courseId === "string" && UUID.test(row.context.courseId) ? [row.context.courseId] : [])))];
  const titles = new Map((courseIds.length > 0 ? await ctx.db.select({ id: course.id, title: course.title }).from(course).where(inArray(course.id, courseIds)) : []).map((entry) => [entry.id, entry.title]));

  return rows.map((row) => {
    const chosen = REPORT_REASONS.find((reason) => reason === row.context.reportedAs);
    const type = REPORT_TARGET_TYPES.find((entry) => entry === row.context.targetType) ?? "other";
    const title = typeof row.context.courseId === "string" ? titles.get(row.context.courseId) : undefined;
    return {
      id: row.id,
      reason: chosen ?? (row.reason === "unsafe_or_upsetting" ? "inappropriate" : row.reason === "ai_said_something_wrong" ? "wrong_or_broken" : row.reason),
      targetLabel: title && type !== "course" ? `${TARGET_WORDS[type]} in "${title}"` : title ? `The course "${title}"` : TARGET_WORDS[type],
      status: row.status,
      createdAt: row.createdAt,
    };
  });
}

/** What each status means, in words for the person who sent the report. */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Received. A person on our team will look at it.",
  triaged: "Being looked at by our team.",
  resolved: "Looked at, and we've acted on it. Thank you.",
  dismissed: "Looked at. We didn't need to change anything this time.",
};
