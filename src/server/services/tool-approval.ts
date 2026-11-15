// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

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

/** Learner asks a parent to approve a tool for a course. Notifies the parents. Idempotent while one is pending. */
export async function requestToolApproval(_ctx: Ctx, _input: { learnerId: string; courseId: string; toolSlug: string }): Promise<ToolApprovalView> {
  return notImplemented("toolApproval.requestToolApproval");
}
export async function listToolApprovals(_ctx: Ctx, _familyId: string, _opts?: { status?: "pending" }): Promise<ToolApprovalView[]> {
  return notImplemented("toolApproval.listToolApprovals");
}
/** Parent decision. For `parent_operated` tools approval also records that the parent will set up and run the account. */
export async function decideToolApproval(_ctx: Ctx, _approvalId: string, _decision: "approve" | "decline", _opts?: { parentWillOperate?: boolean }): Promise<ToolApprovalView> {
  return notImplemented("toolApproval.decideToolApproval");
}
/** Revocation blocks further setup steps (spec 3.3). */
export async function revokeToolApproval(_ctx: Ctx, _approvalId: string): Promise<ToolApprovalView> {
  return notImplemented("toolApproval.revokeToolApproval");
}
export async function hasToolApproval(_ctx: Ctx, _input: { learnerId: string; courseId: string; toolSlug: string }): Promise<boolean> {
  return notImplemented("toolApproval.hasToolApproval");
}
