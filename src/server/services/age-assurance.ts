// CONTRACT — owner: accounts slice (the payments slice calls recordAgeAssurance). See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type AgeAssuranceMethod = "card_authorisation" | "paid_subscription" | "parent_email";

/**
 * Spec 3.1: a 13–15-year-old may not use Coach until their parent has completed a £0 card
 * authorisation or holds an active paid subscription; 16–17 need parent email verification and
 * consent; 18 needs nothing more. The mode comes from the `safety.age_assurance_mode` setting.
 */
export async function isAgeAssuranceSatisfied(_ctx: Ctx, _learnerId: string): Promise<boolean> {
  return notImplemented("ageAssurance.isAgeAssuranceSatisfied");
}
export async function recordAgeAssurance(_ctx: Ctx, _familyId: string, _method: AgeAssuranceMethod): Promise<void> {
  return notImplemented("ageAssurance.recordAgeAssurance");
}
