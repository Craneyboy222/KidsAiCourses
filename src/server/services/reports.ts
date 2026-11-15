// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type ReportReason = "someone_in_danger" | "inappropriate" | "bullying" | "wrong_or_broken" | "guide_mismatch" | "privacy" | "other";
export type ReportTarget = { type: "step" | "course" | "project" | "ai_output" | "guide" | "other"; id: string; courseId?: string; stepKey?: string; toolSlug?: string };

/**
 * Spec 3.10: a Report control on every step, course, project and AI output.
 * `someone_in_danger` opens a critical safeguarding case immediately; `guide_mismatch` creates a guide-review task for editors;
 * everything else goes to the moderation queue. The reporter always gets a calm confirmation and, for danger, the fixed crisis signposting.
 */
export async function createReport(_ctx: Ctx, _input: { reason: ReportReason; target: ReportTarget; note?: string }): Promise<{ reportId: string; showCrisisScript: boolean }> {
  return notImplemented("reports.createReport");
}
export async function listOwnReports(_ctx: Ctx, _userId: string): Promise<{ id: string; reason: ReportReason; targetLabel: string; status: string; createdAt: Date }[]> {
  return notImplemented("reports.listOwnReports");
}
