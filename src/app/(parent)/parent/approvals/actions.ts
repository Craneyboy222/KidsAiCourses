"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { text, ticked } from "@/app/(auth)/_lib/form";
import { runAction, type ActionState } from "@/server/action";
import { requireParent } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { decideApproval, revokeApproval } from "@/server/services/approvals";

const decisionSchema = z.object({
  source: z.enum(["tool", "unlock"]),
  id: z.uuid("That request could not be found."),
  decision: z.enum(["approve", "decline"]),
});

export type ApprovalOutcome = { status: "pending" | "approved" | "declined" | "revoked"; learnerNickname: string; courseTitle: string; toolName: string | null; nextHref: string | null };

/**
 * A parent's yes or no to one request. The service finds the request by id, checks it belongs to
 * this parent's family (another family's answers "not found"), records it and tells the child.
 */
export async function decideApprovalAction(_prev: ActionState<ApprovalOutcome>, formData: FormData): Promise<ActionState<ApprovalOutcome>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const input = decisionSchema.parse({ source: text(formData, "source"), id: text(formData, "id"), decision: text(formData, "decision") });
    await rateLimit(ctx, "approvals.decide", { limit: 60, windowSec: 60 * 60 });
    const result = await decideApproval(ctx, { ...input, parentWillOperate: ticked(formData, "parentWillOperate") });
    revalidatePath("/parent", "layout");
    return { status: result.status, learnerNickname: result.learnerNickname, courseTitle: result.courseTitle, toolName: result.toolName, nextHref: result.nextHref };
  });
}

/** Takes back an approval given earlier. The child is told, and the tool's setup steps are blocked again. */
export async function revokeApprovalAction(_prev: ActionState<ApprovalOutcome>, formData: FormData): Promise<ActionState<ApprovalOutcome>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const id = z.uuid("That request could not be found.").parse(text(formData, "id"));
    await rateLimit(ctx, "approvals.decide", { limit: 60, windowSec: 60 * 60 });
    const result = await revokeApproval(ctx, id);
    revalidatePath("/parent", "layout");
    return { status: result.status, learnerNickname: result.learnerNickname, courseTitle: result.courseTitle, toolName: result.toolName, nextHref: null };
  });
}
