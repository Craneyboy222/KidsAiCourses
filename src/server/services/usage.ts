// CONTRACT — owner: learning slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type LearningAllowed =
  | { allowed: true; minutesLeftToday: number | null }
  | { allowed: false; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active"; message: string };

/**
 * The single check for "may this learner learn right now?": account active, required consents
 * granted, not paused, inside the daily cap, outside quiet hours (spec 3.2, 3.6).
 * Used by the player, autosave, Coach and submissions. The cap is a hard stop, but work is saved first.
 */
export async function checkLearningAllowed(_ctx: Ctx, _learnerId: string): Promise<LearningAllowed> {
  return notImplemented("usage.checkLearningAllowed");
}
/** Adds active seconds to today's total (UK date). Returns the same shape as checkLearningAllowed after adding. */
export async function recordHeartbeat(_ctx: Ctx, _learnerId: string, _seconds: number): Promise<LearningAllowed> {
  return notImplemented("usage.recordHeartbeat");
}
export async function getUsageByDay(_ctx: Ctx, _learnerId: string, _days: number): Promise<{ date: string; seconds: number }[]> {
  return notImplemented("usage.getUsageByDay");
}
