// CONTRACT — owner: learning slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type EnrolmentView = {
  id: string;
  learnerId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseVersionId: string;
  status: "active" | "completed" | "withdrawn";
  currentStepKey: string | null;
  completedSteps: number;
  totalSteps: number;
  startedAt: Date;
  completedAt: Date | null;
};

export async function getEnrolment(_ctx: Ctx, _learnerId: string, _courseId: string): Promise<EnrolmentView | null> {
  return notImplemented("enrolment.getEnrolment");
}
export async function getEnrolmentById(_ctx: Ctx, _enrolmentId: string): Promise<EnrolmentView | null> {
  return notImplemented("enrolment.getEnrolmentById");
}
export async function listEnrolments(_ctx: Ctx, _learnerId: string): Promise<EnrolmentView[]> {
  return notImplemented("enrolment.listEnrolments");
}
/**
 * Called by the submissions slice when evidence for an `upload` or `submit` step changes state.
 * `submitted` completes rules `evidence_submitted` and `submit`; `accepted` completes `upload_approved`;
 * `rejected` reopens the step. Marks the course completed when every required step is done.
 */
export async function recordEvidenceOutcome(_ctx: Ctx, _input: { enrolmentId: string; stepId: string; outcome: "submitted" | "accepted" | "rejected" }): Promise<EnrolmentView> {
  return notImplemented("enrolment.recordEvidenceOutcome");
}
