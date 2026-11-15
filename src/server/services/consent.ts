// CONTRACT — owner: accounts slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

/** Spec 3.6. Keys stay open text in the database; these are the launch set. */
export const REQUIRED_CONSENT_KEYS = ["account_learning_data", "ai_processing", "third_party_tools"] as const;
export const OPTIONAL_CONSENT_KEYS = ["tutor_history_retention", "product_improvement_analytics"] as const;
export type ConsentKey = (typeof REQUIRED_CONSENT_KEYS)[number] | (typeof OPTIONAL_CONSENT_KEYS)[number];

/** True when the latest record for this learner and key (at the current definition version) is a grant. */
export async function hasConsent(_ctx: Ctx, _learnerId: string, _key: ConsentKey): Promise<boolean> {
  return notImplemented("consent.hasConsent");
}
/** Required consents that are not currently granted. Empty means the learner may use the product. */
export async function missingRequiredConsents(_ctx: Ctx, _learnerId: string): Promise<ConsentKey[]> {
  return notImplemented("consent.missingRequiredConsents");
}
