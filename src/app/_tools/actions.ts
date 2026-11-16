"use server";

import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner, requireParent } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { decideToolApproval, requestToolApproval, revokeToolApproval, setToolApproval, type ToolApprovalView } from "@/server/services/tool-approval";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/);

const askSchema = z.object({ courseId: z.uuid(), toolSlug: slug });

/** A learner asks a parent or carer to approve a tool for a course (spec 3.3). */
export async function askToolApprovalAction(_prev: ActionState<ToolApprovalView>, formData: FormData): Promise<ActionState<ToolApprovalView>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const input = askSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "tool_approval.request", { limit: 10, windowSec: 3600 });
    return requestToolApproval(ctx, { learnerId: ctx.actor.userId, courseId: input.courseId, toolSlug: input.toolSlug });
  });
}

const decideSchema = z.object({
  approvalId: z.uuid().optional(),
  learnerId: z.uuid().optional(),
  courseId: z.uuid().optional(),
  toolSlug: slug.optional(),
  decision: z.enum(["approve", "decline"]),
  parentWillOperate: z.literal("on").optional(),
});

/**
 * A parent's decision, from the approvals inbox (by request id) or from "Tools you'll need" on a
 * course page (by child, course and tool, when the child has not asked yet).
 */
export async function decideToolApprovalAction(_prev: ActionState<ToolApprovalView>, formData: FormData): Promise<ActionState<ToolApprovalView>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const input = decideSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "tool_approval.decide", { limit: 60, windowSec: 3600 });
    const parentWillOperate = input.parentWillOperate === "on";
    if (input.approvalId) return decideToolApproval(ctx, input.approvalId, input.decision, { parentWillOperate });
    if (!input.learnerId || !input.courseId || !input.toolSlug) throw new z.ZodError([]);
    return setToolApproval(ctx, { learnerId: input.learnerId, courseId: input.courseId, toolSlug: input.toolSlug, decision: input.decision, parentWillOperate });
  });
}

const revokeSchema = z.object({ approvalId: z.uuid() });

/** A parent removes an approval they gave. The course is blocked again for that child at once. */
export async function revokeToolApprovalAction(_prev: ActionState<ToolApprovalView>, formData: FormData): Promise<ActionState<ToolApprovalView>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const input = revokeSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "tool_approval.decide", { limit: 60, windowSec: 3600 });
    return revokeToolApproval(ctx, input.approvalId);
  });
}
