// CONTRACT — owner: payments slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type Entitlement = {
  planKey: string; // "free" | "family" | …  (plans are data)
  fullCatalogue: boolean;
  seats: number;
  coachCreditsPerLearnerPerMonth: number;
  /** Subscription state as last reported by a verified Stripe webhook. */
  status: "none" | "trialing" | "active" | "past_due" | "cancelled";
  periodKey: string; // credit period, e.g. "2026-11" or the subscription anniversary key
};

/** Stripe webhooks are the source of truth (spec 3.7). Never trust anything from the browser. */
export async function getEntitlementForLearner(_ctx: Ctx, _learnerId: string): Promise<Entitlement> {
  return notImplemented("entitlements.getEntitlementForLearner");
}
export async function getEntitlementForFamily(_ctx: Ctx, _familyId: string): Promise<Entitlement> {
  return notImplemented("entitlements.getEntitlementForFamily");
}
/** Free courses are open to everyone; paid courses need the full catalogue. Checked on every gated route. */
export async function canAccessCourse(_ctx: Ctx, _learnerId: string, _course: { id: string; isFree: boolean }): Promise<boolean> {
  return notImplemented("entitlements.canAccessCourse");
}
