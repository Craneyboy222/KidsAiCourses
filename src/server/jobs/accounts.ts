import { recalculateBands } from "@/server/services/safety-band";
import { purgePendingTeens } from "@/server/services/teen-signup";
import { defineJob } from "./define";

/**
 * Accounts jobs (spec 3.1, retention defaults in Section 9).
 * Both are idempotent: a second run on the same day finds nothing left to do.
 */

/** Deletes teen-first accounts that no parent approved within 7 days. Keeps nothing; reports a count. */
export const accountsPurgePending = defineJob({
  name: "accounts.purge_pending",
  schedule: "40 3 * * *",
  run: async (ctx) => purgePendingTeens(ctx),
});

/** Recomputes every learner's safety band and default pathway, and sends birthday-transition notices. */
export const accountsRecalculateBands = defineJob({
  name: "accounts.recalculate_bands",
  // Just after midnight, UK time, so a band changes on the first day of the month after the birth month.
  schedule: "10 0 * * *",
  run: async (ctx) => recalculateBands(ctx),
});
