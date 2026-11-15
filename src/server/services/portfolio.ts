// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type ProjectView = {
  id: string;
  learnerId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  title: string;
  status: "awaiting_review" | "accepted" | "needs_changes";
  submittedAt: Date;
  acceptedAt: Date | null;
  artefactCount: number;
};

/** Accepted projects for the learner and their linked parents. Pending items are included only when the viewer is the submitter. */
export async function listProjects(_ctx: Ctx, _learnerId: string): Promise<ProjectView[]> {
  return notImplemented("portfolio.listProjects");
}
