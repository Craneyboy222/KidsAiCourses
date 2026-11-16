import { reconcileBilling } from "@/server/services/billing";
import { defineJob } from "./define";

/**
 * Billing housekeeping (spec 3.7). Access is always worked out live from `subscription`, so this
 * job is never what opens or closes a course. It catches up what happens with the passing of
 * time rather than with a webhook: a payment grace period running out, a cancelled plan reaching
 * its end date, a plan we gave at no charge coming to an end. It then updates the `family.plan`
 * cache and tells the family, once. Idempotent: a second run finds nothing left to do.
 */
export const billingReconcile = defineJob({
  name: "billing.reconcile",
  schedule: "20 4 * * *",
  run: async (ctx) => reconcileBilling(ctx),
});
