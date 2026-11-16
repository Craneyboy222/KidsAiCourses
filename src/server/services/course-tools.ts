import { and, eq, inArray, or } from "drizzle-orm";
import type { Ctx } from "@/server/context";
import { courseTool, enrolment, tool, toolApproval, toolChangeEvent } from "@/server/db";
import { AppError, type ErrorCode } from "@/server/errors";
import { getFamilyIdForLearner } from "./family";
import { checkStart, type StartBlocker, type StartDecision } from "./start-gate";
import type { ApprovalFacts, ToolFacts } from "./start-rules";
import type { ToolRow } from "./tools";

/**
 * Reading helpers shared by the start gate, tool approvals, "Tools you'll need" and submissions:
 * which tools a course version uses, which are on hold, and what a parent has approved.
 */

/**
 * Who may ask about a learner: the learner (even while paused: that is the answer they need), a
 * parent or carer in the same family, staff with a verified second factor, and background jobs.
 * The family is looked up from the learner, never taken from the request.
 */
export async function assertMayAskAbout(ctx: Ctx, learnerId: string): Promise<void> {
  const { actor } = ctx;
  if (actor.type === "system") return;
  if (actor.type === "learner" && actor.userId === learnerId) return;
  if (actor.type === "staff" && actor.twoFactorVerified) return;
  if (actor.type === "parent" && (await getFamilyIdForLearner(ctx, learnerId)) === actor.familyId) return;
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  throw new AppError("forbidden", "You don't have permission to do that.");
}

export type CourseToolEntry = { tool: ToolRow; fallback: ToolRow | null; required: boolean; purpose: string };

/** The tools one course version uses, with their fallbacks, read fresh from the Register. */
export async function loadCourseTools(ctx: Pick<Ctx, "db">, courseVersionId: string): Promise<CourseToolEntry[]> {
  const rows = await ctx.db
    .select({ toolId: courseTool.toolId, fallbackToolId: courseTool.fallbackToolId, required: courseTool.required, purpose: courseTool.purpose, position: courseTool.position })
    .from(courseTool)
    .where(eq(courseTool.courseVersionId, courseVersionId))
    .orderBy(courseTool.position);
  const ids = [...new Set(rows.flatMap((row) => (row.fallbackToolId ? [row.toolId, row.fallbackToolId] : [row.toolId])))];
  if (ids.length === 0) return [];
  const tools = new Map((await ctx.db.select().from(tool).where(inArray(tool.id, ids))).map((row) => [row.id, row]));
  const entries: CourseToolEntry[] = [];
  for (const row of rows) {
    const main = tools.get(row.toolId);
    if (!main) continue;
    entries.push({ tool: main, fallback: row.fallbackToolId ? (tools.get(row.fallbackToolId) ?? null) : null, required: row.required, purpose: row.purpose });
  }
  return entries;
}

/** Ids of tools with an open change event that tightens, or may tighten, the age policy: Start waits for a person to triage it. */
export async function toolsOnHold(ctx: Pick<Ctx, "db">, toolIds: readonly string[]): Promise<Set<string>> {
  if (toolIds.length === 0) return new Set();
  const rows = await ctx.db
    .select({ toolId: toolChangeEvent.toolId })
    .from(toolChangeEvent)
    .where(and(inArray(toolChangeEvent.toolId, [...toolIds]), eq(toolChangeEvent.status, "open"), or(eq(toolChangeEvent.impact, "age_policy"), eq(toolChangeEvent.blocksStart, true))));
  return new Set(rows.map((row) => row.toolId));
}

export const toToolFacts = (row: ToolRow, onHold: boolean): ToolFacts => ({ slug: row.slug, name: row.name, status: row.status, under18Policy: row.under18Policy, minAge: row.minAge, onHold });

/** The version a learner is on: the one they started, or the live one if they have not started. */
export async function courseVersionFor(ctx: Pick<Ctx, "db">, learnerId: string, target: { id: string; publishedVersionId: string | null }): Promise<string | null> {
  const [mine] = await ctx.db.select({ versionId: enrolment.courseVersionId }).from(enrolment).where(and(eq(enrolment.learnerId, learnerId), eq(enrolment.courseId, target.id))).limit(1);
  return mine?.versionId ?? target.publishedVersionId;
}

/** The parent's approvals for this learner and course, by tool slug. */
export async function approvalFactsFor(ctx: Pick<Ctx, "db">, learnerId: string, courseId: string, tools: readonly ToolRow[]): Promise<Record<string, ApprovalFacts | undefined>> {
  if (tools.length === 0) return {};
  const slugById = new Map(tools.map((row) => [row.id, row.slug]));
  const rows = await ctx.db
    .select({ toolId: toolApproval.toolId, status: toolApproval.status, parentOperatedConfirmed: toolApproval.parentOperatedConfirmed })
    .from(toolApproval)
    .where(and(eq(toolApproval.learnerId, learnerId), eq(toolApproval.courseId, courseId), inArray(toolApproval.toolId, [...slugById.keys()])));
  const facts: Record<string, ApprovalFacts | undefined> = {};
  for (const row of rows) {
    const slug = slugById.get(row.toolId);
    if (slug) facts[slug] = { status: row.status, parentOperatedConfirmed: row.parentOperatedConfirmed };
  }
  return facts;
}

const NOW_CODES: Record<Extract<StartBlocker, { code: "not_allowed_now" }>["reason"], ErrorCode> = {
  paused: "paused",
  time_cap: "time_cap_reached",
  quiet_hours: "quiet_hours",
  consent: "consent_required",
  not_active: "paused",
};

/** The error for a closed gate, or null when the learner may carry on. A hidden or missing course is always "not found". */
export function startError(decision: StartDecision): AppError | null {
  const [first] = decision.blockers;
  if (decision.allowed && !first) return null;
  if (!first) return new AppError("forbidden", "You can't open this course at the moment.");
  const codes = decision.blockers.map((blocker) => blocker.code);
  if (codes.some((code) => code === "course_unavailable" || code === "age_restricted" || code === "parent_blocked")) {
    return new AppError("not_found", "That course could not be found. It may have been moved or removed.", { detail: { blockers: codes } });
  }
  switch (first.code) {
    case "not_allowed_now":
      return new AppError(NOW_CODES[first.reason], first.message);
    case "entitlement_required":
      // 403, not the default 402: nothing a learner sees should hint at paying.
      return new AppError("entitlement_required", first.message, { status: 403 });
    case "pro_approval_required":
    case "tool_approval_required":
      return new AppError("parent_approval_required", first.message);
    case "tool_blocked":
    case "tool_on_hold":
      return new AppError("tool_blocked", first.message);
    default:
      return new AppError("forbidden", first.message);
  }
}

/** Throws unless the learner may start or carry on with the course right now. */
export async function assertStartAllowed(ctx: Ctx, learnerId: string, courseId: string): Promise<void> {
  const error = startError(await checkStart(ctx, learnerId, courseId));
  if (error) throw error;
}
