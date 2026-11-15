// CONTRACT — owner: parents slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type ParentControls = {
  /** null means no cap. */
  dailyMinutesCap: number | null;
  /** Minutes since midnight, UK time. Equal values mean no quiet hours. */
  quietStartMin: number;
  quietEndMin: number;
  blockedCategories: string[];
  blockedCourseIds: string[];
  requireApprovalForPro: boolean;
  paused: boolean;
  pausedReason: string | null;
};

/** Effective controls for a learner, with site defaults applied when a parent has set nothing. adult_18 learners with no parent link get no caps. */
export async function getControls(_ctx: Ctx, _learnerId: string): Promise<ParentControls> {
  return notImplemented("parentControls.getControls");
}
