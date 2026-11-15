// CONTRACT — owner: learning slice (read by the parent dashboard). See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type ProgressSummary = {
  inProgress: { courseId: string; courseSlug: string; title: string; percent: number; lastActiveAt: Date | null }[];
  completed: { courseId: string; courseSlug: string; title: string; completedAt: Date }[];
  minutesThisWeek: number;
  minutesToday: number;
};

export async function getProgressSummary(_ctx: Ctx, _learnerId: string): Promise<ProgressSummary> {
  return notImplemented("progressSummary.getProgressSummary");
}
