import { completeDueDeletions, purgeExpiredExports, runExport } from "@/server/services/data-request";
import { defineJob } from "./define";

/**
 * Data-rights jobs (spec 3.6 and Section 9). Both are idempotent: an export that is already
 * built is skipped, and a deletion is claimed before any work is done on it.
 */

/**
 * The same name as `EXPORT_EVENT` in the service (a test keeps the two in step). Written out here
 * because the service imports `enqueue`, which imports the registry, which imports this file: a
 * constant read from the service while this module loads would not exist yet.
 */
export const DATA_EXPORT_EVENT = "data/export.requested";

/** Builds the ZIP for one data-download request and tells the person who asked. Started by `requestExport`. */
export const dataExport = defineJob({
  name: "data.export",
  event: DATA_EXPORT_EVENT,
  run: async (ctx, payload: { requestId?: string }) => {
    const result = await runExport(ctx, typeof payload?.requestId === "string" ? payload.requestId : "");
    // Counts and ids only: this summary is stored and shown in Studio.
    return { requestId: result.requestId, status: result.status, files: result.files ?? 0, bytes: result.bytes ?? 0 };
  },
});

/**
 * Completes deletions whose 14-day undo window has ended, and removes download files whose
 * seven days are up. Hourly, so "14 days" never stretches to 15.
 */
export const dataDeleteDue = defineJob({
  name: "data.delete_due",
  schedule: "20 * * * *",
  run: async (ctx) => {
    const deletions = await completeDueDeletions(ctx);
    const exports = await purgeExpiredExports(ctx);
    return { ...deletions, ...exports };
  },
});
