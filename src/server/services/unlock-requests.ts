// CONTRACT — owner: payments slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type UnlockRequestView = {
  id: string;
  learnerId: string;
  learnerNickname: string;
  kind: "paid_course" | "pro_course";
  courseId: string;
  courseTitle: string;
  status: "pending" | "approved" | "declined";
  createdAt: Date;
};

/** "Ask a parent to unlock": the only thing an under-18 can do about locked content. Notifies the parents. Idempotent while one is pending. */
export async function requestUnlock(_ctx: Ctx, _input: { learnerId: string; courseId: string; kind: "paid_course" | "pro_course" }): Promise<UnlockRequestView> {
  return notImplemented("unlockRequests.requestUnlock");
}
export async function listUnlockRequests(_ctx: Ctx, _familyId: string, _opts?: { status?: "pending" }): Promise<UnlockRequestView[]> {
  return notImplemented("unlockRequests.listUnlockRequests");
}
/** Approving a paid-course request does not grant access by itself: it takes the parent to the plan choice. Approving a Pro-course request does. */
export async function decideUnlockRequest(_ctx: Ctx, _requestId: string, _decision: "approve" | "decline"): Promise<UnlockRequestView> {
  return notImplemented("unlockRequests.decideUnlockRequest");
}
