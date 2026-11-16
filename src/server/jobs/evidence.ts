import { cleanUpAbandonedUploads } from "@/server/services/submission";
import { defineJob } from "./define";

/** Upload links that were handed out and never completed are removed, with anything that reached storage. */
export const evidenceCleanupAbandoned = defineJob({
  name: "evidence.cleanup_abandoned",
  schedule: "40 3 * * *",
  run: async (ctx) => cleanUpAbandonedUploads(ctx),
});
