// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import { and, desc, eq } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, learnerProfile, tool, toolApproval, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { notify, notifyParentsOfLearner } from "@/server/notifications";
import { LIVE_COURSE_STATUSES } from "./course-store";
import { assertMayAskAbout, courseVersionFor, loadCourseTools } from "./course-tools";
import { getFamilyIdForLearner, getLearnerSummary } from "./family";
import { getControls } from "./parent-controls";
import { approvalIsValid } from "./start-rules";
import type { ToolRow } from "./tools";

export type ToolApprovalView = {
  id: string;
  learnerId: string;
  learnerNickname: string;
  courseId: string;
  courseTitle: string;
  toolSlug: string;
  toolName: string;
  policy: "parent_consent_required" | "parent_operated";
  status: "pending" | "approved" | "declined" | "revoked";
  requestedAt: Date;
  decidedAt: Date | null;
};

type ApprovalPolicy = ToolApprovalView["policy"];
const NOT_FOUND = "That request could not be found. It may have been removed.";
const COURSE_NOT_FOUND = "That course could not be found. It may have been moved or removed.";

const needsParent = (policy: ToolRow["under18Policy"]): policy is ApprovalPolicy => policy === "parent_consent_required" || policy === "parent_operated";

const viewColumns = {
  id: toolApproval.id,
  learnerId: toolApproval.learnerId,
  familyId: toolApproval.familyId,
  learnerNickname: learnerProfile.nickname,
  courseId: toolApproval.courseId,
  courseTitle: course.title,
  toolSlug: tool.slug,
  toolName: tool.name,
  toolPolicy: tool.under18Policy,
  policyAtDecision: toolApproval.policyAtDecision,
  status: toolApproval.status,
  requestedAt: toolApproval.requestedAt,
  decidedAt: toolApproval.decidedAt,
};

type ViewRow = {
  id: string;
  learnerId: string;
  familyId: string;
  learnerNickname: string;
  courseId: string;
  courseTitle: string;
  toolSlug: string;
  toolName: string;
  toolPolicy: ToolRow["under18Policy"];
  policyAtDecision: ToolRow["under18Policy"];
  status: ToolApprovalView["status"];
  requestedAt: Date;
  decidedAt: Date | null;
};

function toView(row: ViewRow): ToolApprovalView {
  // The Register's policy today; if the tool no longer needs a parent, the policy the parent decided under.
  const policy: ApprovalPolicy = needsParent(row.toolPolicy) ? row.toolPolicy : needsParent(row.policyAtDecision) ? row.policyAtDecision : "parent_consent_required";
  return {
    id: row.id,
    learnerId: row.learnerId,
    learnerNickname: row.learnerNickname,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    toolSlug: row.toolSlug,
    toolName: row.toolName,
    policy,
    status: row.status,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
  };
}

const selectViews = (db: Db) =>
  db
    .select(viewColumns)
    .from(toolApproval)
    .innerJoin(tool, eq(tool.id, toolApproval.toolId))
    .innerJoin(course, eq(course.id, toolApproval.courseId))
    .innerJoin(learnerProfile, eq(learnerProfile.userId, toolApproval.learnerId));

async function readView(db: Db, approvalId: string): Promise<ViewRow | null> {
  const [row] = await selectViews(db).where(eq(toolApproval.id, approvalId)).limit(1);
  return row ?? null;
}

async function requireView(db: Db, approvalId: string): Promise<ToolApprovalView> {
  const row = await readView(db, approvalId);
  if (!row) throw new AppError("not_found", NOT_FOUND);
  return toView(row);
}

/**
 * The tool, checked against the course: it must be in the Register as approved, need a parent, and
 * be one this course uses (as a main tool or a fallback) in the version the learner is on.
 */
async function resolveCourseTool(ctx: Ctx, input: { learnerId: string; courseId: string; toolSlug: string }): Promise<{ tool: ToolRow; policy: ApprovalPolicy; courseTitle: string }> {
  const [target] = await ctx.db
    .select({ id: course.id, title: course.title, status: course.status, takenDownAt: course.takenDownAt, publishedVersionId: course.publishedVersionId, minAge: course.minAge, category: course.category })
    .from(course)
    .where(eq(course.id, input.courseId))
    .limit(1);
  const live = target !== undefined && (LIVE_COURSE_STATUSES as readonly string[]).includes(target.status) && target.takenDownAt === null && target.publishedVersionId !== null;
  if (!target || !live) throw new AppError("not_found", COURSE_NOT_FOUND);

  // A course the learner may not see answers exactly like one that does not exist.
  const [summary, controls] = await Promise.all([getLearnerSummary(ctx, input.learnerId), getControls(ctx, input.learnerId)]);
  const hidden = summary.age < target.minAge || controls.blockedCourseIds.includes(target.id) || (target.category !== null && controls.blockedCategories.includes(target.category));
  if (hidden) throw new AppError("not_found", COURSE_NOT_FOUND);

  const versionId = await courseVersionFor(ctx, input.learnerId, target);
  const entries = versionId ? await loadCourseTools(ctx, versionId) : [];
  const row = entries.flatMap((entry) => (entry.fallback ? [entry.tool, entry.fallback] : [entry.tool])).find((entry) => entry.slug === input.toolSlug);
  if (!row) throw new AppError("not_found", "That tool isn't part of this course.");
  if (row.status !== "approved" || row.under18Policy === null || row.under18Policy === "blocked") {
    throw new AppError("tool_blocked", `${row.name} isn't available to use at the moment, so there is nothing to approve.`);
  }
  if (!needsParent(row.under18Policy)) throw new AppError("conflict", `${row.name} doesn't need a parent's approval. You can go ahead.`);
  return { tool: row, policy: row.under18Policy, courseTitle: target.title };
}

/** Learner asks a parent to approve a tool for a course. Notifies the parents. Idempotent while one is pending. */
export async function requestToolApproval(ctx: Ctx, input: { learnerId: string; courseId: string; toolSlug: string }): Promise<ToolApprovalView> {
  assertCan(ctx.actor, "learner.tool_approval.request", { learnerId: input.learnerId });
  const familyId = await getFamilyIdForLearner(ctx, input.learnerId);
  if (!familyId) throw new AppError("conflict", "There isn't a parent or carer linked to your account yet, so there is nobody to ask.");
  const resolved = await resolveCourseTool(ctx, input);

  const outcome = await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(toolApproval)
      .values({ learnerId: input.learnerId, familyId, toolId: resolved.tool.id, courseId: input.courseId, status: "pending", requestedAt: ctx.now, createdAt: ctx.now, updatedAt: ctx.now })
      .onConflictDoNothing({ target: [toolApproval.learnerId, toolApproval.toolId, toolApproval.courseId] })
      .returning({ id: toolApproval.id });
    const [fresh] = inserted;
    if (fresh) {
      await audit(ctx, { action: "tool_approval.request", targetType: "tool_approval", targetId: fresh.id, meta: { toolSlug: resolved.tool.slug, courseId: input.courseId } }, tx);
      return { id: fresh.id, notify: true };
    }
    const [existing] = await tx
      .select({ id: toolApproval.id, status: toolApproval.status })
      .from(toolApproval)
      .where(and(eq(toolApproval.learnerId, input.learnerId), eq(toolApproval.toolId, resolved.tool.id), eq(toolApproval.courseId, input.courseId)))
      .for("update");
    if (!existing) throw new AppError("internal", "We couldn't send that request. Nothing was lost. Try again in a moment.");
    // Still waiting, or already answered with a yes: asking again changes nothing and sends nothing.
    if (existing.status === "pending" || existing.status === "approved") return { id: existing.id, notify: false };
    // Declined or switched off earlier: the learner may ask again, and the parent decides afresh.
    await tx
      .update(toolApproval)
      .set({ status: "pending", familyId, requestedAt: ctx.now, decidedAt: null, decidedBy: null, revokedAt: null, revokedBy: null, parentOperatedConfirmed: false, policyAtDecision: null, updatedAt: ctx.now })
      .where(eq(toolApproval.id, existing.id));
    await audit(ctx, { action: "tool_approval.request", targetType: "tool_approval", targetId: existing.id, meta: { toolSlug: resolved.tool.slug, courseId: input.courseId, again: true } }, tx);
    return { id: existing.id, notify: true };
  });

  const view = await requireView(ctx.db, outcome.id);
  if (outcome.notify) {
    await notifyParentsOfLearner(ctx, input.learnerId, {
      type: "approval.tool_requested",
      title: `${view.learnerNickname} needs your approval to use ${view.toolName}`,
      body: `${view.learnerNickname} would like to start "${view.courseTitle}". It uses ${view.toolName}, which needs a parent or carer's say-so first.`,
      href: "/parent/approvals",
      emailTemplate: "tool_approval_request",
      emailData: { childName: view.learnerNickname, toolName: view.toolName, courseTitle: view.courseTitle, url: `${env.NEXT_PUBLIC_APP_URL}/parent/approvals` },
      dedupeKey: `tool-approval:${view.id}:${ctx.now.getTime()}`,
    });
  }
  return view;
}

export async function listToolApprovals(ctx: Ctx, familyId: string, opts?: { status?: "pending" }): Promise<ToolApprovalView[]> {
  assertCan(ctx.actor, "family.read", { familyId });
  const rows = await selectViews(ctx.db)
    .where(and(eq(toolApproval.familyId, familyId), opts?.status ? eq(toolApproval.status, opts.status) : undefined))
    .orderBy(desc(toolApproval.requestedAt));
  return rows.map(toView);
}

/** A learner's approvals for one course, for "Tools you'll need". The learner, their parents and staff may read them. */
export async function listToolApprovalsForCourse(ctx: Ctx, input: { learnerId: string; courseId: string }): Promise<ToolApprovalView[]> {
  await assertMayAskAbout(ctx, input.learnerId);
  const rows = await selectViews(ctx.db).where(and(eq(toolApproval.learnerId, input.learnerId), eq(toolApproval.courseId, input.courseId)));
  return rows.map(toView);
}

async function tellLearner(ctx: Ctx, view: ToolApprovalView, outcome: "approved" | "declined" | "revoked"): Promise<void> {
  const copy = {
    approved: { title: `You can use ${view.toolName}`, body: `Your parent or carer said yes to ${view.toolName} for "${view.courseTitle}".` },
    declined: { title: `${view.toolName} wasn't approved`, body: `Your parent or carer said no to ${view.toolName} for "${view.courseTitle}". Have a chat with them if you'd like to know why.` },
    revoked: { title: `${view.toolName} has been switched off`, body: `Your parent or carer has switched off ${view.toolName} for "${view.courseTitle}". Everything you've done is saved.` },
  }[outcome];
  await notify(ctx, { userId: view.learnerId, type: `approval.tool_${outcome}`, ...copy, channels: ["in_app"], dedupeKey: `tool-approval:${view.id}:${outcome}:${ctx.now.getTime()}` });
}

const actorId = (ctx: Ctx): string | null => (ctx.actor.type === "parent" ? ctx.actor.userId : null);

/**
 * A parent's consent can only come from a parent or carer in the learner's own family: never
 * from staff, a job or the learner. Anyone else, including a parent from another family, gets the
 * same "not found" as for a request that does not exist.
 */
function assertParentOf(ctx: Ctx, familyId: string | null, notFoundMessage: string): void {
  const { actor } = ctx;
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  if (actor.type !== "parent" || familyId === null || actor.familyId !== familyId) throw new AppError("not_found", notFoundMessage);
  // The right parent on a paused account is told why, rather than "not found".
  assertCan(actor, "family.tool_approval.decide", { familyId });
}

/** Parent decision. For `parent_operated` tools approval also records that the parent will set up and run the account. */
export async function decideToolApproval(ctx: Ctx, approvalId: string, decision: "approve" | "decline", opts?: { parentWillOperate?: boolean }): Promise<ToolApprovalView> {
  const changed = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(toolApproval).where(eq(toolApproval.id, approvalId)).for("update");
    // Another family's request answers exactly like one that does not exist.
    assertParentOf(ctx, row?.familyId ?? null, NOT_FOUND);
    if (!row) throw new AppError("not_found", NOT_FOUND);
    const [register] = await tx.select().from(tool).where(eq(tool.id, row.toolId)).limit(1);
    if (!register) throw new AppError("not_found", NOT_FOUND);

    if (decision === "decline") {
      if (row.status === "declined" || row.status === "revoked") return false;
      if (row.status === "approved") throw new AppError("conflict", "You've already approved this. To change your mind, remove the approval instead.");
      await tx.update(toolApproval).set({ status: "declined", decidedAt: ctx.now, decidedBy: actorId(ctx), policyAtDecision: register.under18Policy, parentOperatedConfirmed: false, updatedAt: ctx.now }).where(eq(toolApproval.id, row.id));
      await audit(ctx, { action: "tool_approval.decline", targetType: "tool_approval", targetId: row.id, meta: { toolSlug: register.slug, learnerId: row.learnerId, courseId: row.courseId } }, tx);
      return true;
    }

    if (register.status !== "approved" || !needsParent(register.under18Policy)) {
      if (register.status === "approved" && register.under18Policy === "allowed") throw new AppError("conflict", `${register.name} no longer needs a parent's approval, so there is nothing to decide.`);
      throw new AppError("tool_blocked", `${register.name} isn't available to use at the moment, so it can't be approved.`);
    }
    const operated = register.under18Policy === "parent_operated";
    if (operated && opts?.parentWillOperate !== true) {
      throw new AppError("invalid_input", `${register.name} doesn't allow accounts for under-18s. Tick the box to confirm that you will set up the account and stay in charge of it.`, {
        fieldErrors: { parentWillOperate: ["Tick the box to confirm you'll set up and run the account yourself."] },
      });
    }
    if (row.status === "approved" && approvalIsValid(register.under18Policy, { status: "approved", parentOperatedConfirmed: row.parentOperatedConfirmed })) return false;
    await tx
      .update(toolApproval)
      .set({ status: "approved", decidedAt: ctx.now, decidedBy: actorId(ctx), policyAtDecision: register.under18Policy, parentOperatedConfirmed: operated, revokedAt: null, revokedBy: null, updatedAt: ctx.now })
      .where(eq(toolApproval.id, row.id));
    await audit(ctx, { action: "tool_approval.approve", targetType: "tool_approval", targetId: row.id, meta: { toolSlug: register.slug, learnerId: row.learnerId, courseId: row.courseId, policy: register.under18Policy, parentWillOperate: operated } }, tx);
    return true;
  });

  const view = await requireView(ctx.db, approvalId);
  if (changed) await tellLearner(ctx, view, decision === "approve" ? "approved" : "declined");
  return view;
}


/**
 * A parent's decision made from the course page, before or without a request from the learner:
 * creates the record if there is none, then decides it exactly as `decideToolApproval` does.
 */
export async function setToolApproval(ctx: Ctx, input: { learnerId: string; courseId: string; toolSlug: string; decision: "approve" | "decline"; parentWillOperate?: boolean }): Promise<ToolApprovalView> {
  const familyId = await getFamilyIdForLearner(ctx, input.learnerId);
  assertParentOf(ctx, familyId, "That learner could not be found.");
  if (!familyId) throw new AppError("not_found", "That learner could not be found.");
  const resolved = await resolveCourseTool(ctx, input);
  await ctx.db
    .insert(toolApproval)
    .values({ learnerId: input.learnerId, familyId, toolId: resolved.tool.id, courseId: input.courseId, status: "pending", requestedAt: ctx.now, createdAt: ctx.now, updatedAt: ctx.now })
    .onConflictDoNothing({ target: [toolApproval.learnerId, toolApproval.toolId, toolApproval.courseId] });
  const [row] = await ctx.db
    .select({ id: toolApproval.id })
    .from(toolApproval)
    .where(and(eq(toolApproval.learnerId, input.learnerId), eq(toolApproval.toolId, resolved.tool.id), eq(toolApproval.courseId, input.courseId)))
    .limit(1);
  if (!row) throw new AppError("internal", "We couldn't save that. Nothing was lost. Try again in a moment.");
  return decideToolApproval(ctx, row.id, input.decision, { parentWillOperate: input.parentWillOperate });
}

/** Revocation blocks further setup steps (spec 3.3). */
export async function revokeToolApproval(ctx: Ctx, approvalId: string): Promise<ToolApprovalView> {
  const changed = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(toolApproval).where(eq(toolApproval.id, approvalId)).for("update");
    assertParentOf(ctx, row?.familyId ?? null, NOT_FOUND);
    if (!row) throw new AppError("not_found", NOT_FOUND);
    if (row.status === "revoked") return false;
    if (row.status !== "approved") throw new AppError("conflict", "There is no approval to remove. You can decline the request instead.");
    await tx.update(toolApproval).set({ status: "revoked", revokedAt: ctx.now, revokedBy: actorId(ctx), parentOperatedConfirmed: false, updatedAt: ctx.now }).where(eq(toolApproval.id, row.id));
    await audit(ctx, { action: "tool_approval.revoke", targetType: "tool_approval", targetId: row.id, meta: { learnerId: row.learnerId, courseId: row.courseId, toolId: row.toolId } }, tx);
    return true;
  });
  const view = await requireView(ctx.db, approvalId);
  if (changed) await tellLearner(ctx, view, "revoked");
  return view;
}

/** True only for an approval that covers the tool's policy as it stands in the Register today. */
export async function hasToolApproval(ctx: Ctx, input: { learnerId: string; courseId: string; toolSlug: string }): Promise<boolean> {
  await assertMayAskAbout(ctx, input.learnerId);
  const [row] = await ctx.db
    .select({ status: toolApproval.status, parentOperatedConfirmed: toolApproval.parentOperatedConfirmed, policy: tool.under18Policy, toolStatus: tool.status })
    .from(toolApproval)
    .innerJoin(tool, eq(tool.id, toolApproval.toolId))
    .where(and(eq(toolApproval.learnerId, input.learnerId), eq(toolApproval.courseId, input.courseId), eq(tool.slug, input.toolSlug)))
    .limit(1);
  if (!row || row.toolStatus !== "approved") return false;
  return approvalIsValid(row.policy, { status: row.status, parentOperatedConfirmed: row.parentOperatedConfirmed });
}
