// CONTRACT — owner: Studio safety slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type SafeguardingSeverity = "critical" | "high" | "medium" | "low";
export type SafeguardingTrigger = "crisis_classifier" | "abuse_disclosure" | "exploitation" | "grooming" | "danger_report" | "moderator_escalation" | "illegal_content" | "other";

/**
 * Opens a safeguarding case and alerts the DSL at once for critical and high severity
 * (email, and SMS only if an approved provider is configured). Never waits for a human
 * and never throws back to the learner: on failure it logs and still returns.
 * `summary` is a short, factual, non-identifying line; detail goes into encrypted notes.
 * May be called by the system actor and by any signed-in actor's request.
 */
export async function openSafeguardingCase(_ctx: Ctx, _input: { learnerId?: string | null; severity: SafeguardingSeverity; trigger: SafeguardingTrigger; summary: string; sourceType: string; sourceId?: string | null; detail?: string; isTest?: boolean }): Promise<{ caseId: string }> {
  return notImplemented("safeguarding.openSafeguardingCase");
}
/** Number of open safety notices a parent should see for a child (counts only; never case detail). */
export async function countSafetyNoticesForLearner(_ctx: Ctx, _learnerId: string): Promise<number> {
  return notImplemented("safeguarding.countSafetyNoticesForLearner");
}
