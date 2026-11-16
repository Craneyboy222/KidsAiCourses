import { runRetentionSweep, type SweepOptions } from "@/server/services/retention";
import { defineJob } from "./define";

/**
 * The nightly retention sweep (spec Section 9: "configurable in `retention_policy`, enforced
 * nightly"). Applies every policy in batches and writes the counts to `job_run.summary`.
 *
 * Idempotent: what was deleted is gone, so a second run finds nothing more to do. A run that
 * stops at its batch limit says `moreToDo: true` and the next night carries on.
 *
 * Payload (all optional, for a manual run through `/api/jobs/retention.sweep`):
 *   `dryRun`           count what is due, change nothing;
 *   `includeAuditLog`  also delete audit-log rows past their period (off by default, ⚖️);
 *   `batchSize`, `maxBatches`.
 */
export const retentionSweep = defineJob({
  name: "retention.sweep",
  // 03:15 UK time: quiet hours, and after the hourly deletion job has had its run.
  schedule: "15 3 * * *",
  event: "retention/sweep",
  run: async (ctx, payload: SweepOptions | undefined) => {
    const given = payload ?? {};
    const summary = await runRetentionSweep(ctx, {
      dryRun: given.dryRun === true,
      includeAuditLog: given.includeAuditLog === true,
      ...(typeof given.batchSize === "number" ? { batchSize: given.batchSize } : {}),
      ...(typeof given.maxBatches === "number" ? { maxBatches: given.maxBatches } : {}),
    });
    // Counts only: this summary is stored and shown in Studio.
    return { ...summary };
  },
});
