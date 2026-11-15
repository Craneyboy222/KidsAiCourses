// CONTRACT — owner: Coach slice (read by the parent dashboard). See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

/** What a parent may see of Coach use: a count and topics, never transcripts (spec 3.6). */
export type CoachSummary = { messagesThisWeek: number; messagesTotal: number; topics: string[]; lastUsedAt: Date | null };

export async function getCoachSummaryForParent(_ctx: Ctx, _learnerId: string): Promise<CoachSummary> {
  return notImplemented("coachSummary.getCoachSummaryForParent");
}
