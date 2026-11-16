import { accountsPurgePending, accountsRecalculateBands } from "./accounts";
import type { JobDefinition } from "./define";
import { notificationsRelease, rateLimitCleanup, sessionsCleanup } from "./housekeeping";
import { publishJobs } from "@/server/services/publish";

/**
 * Every background job in the product. Inngest (`inngest.ts`), the cron fallback route
 * (`/api/jobs/[name]`) and `enqueue()` all read this list, so a job that is not here never runs.
 *
 * HOW TO ADD A JOB
 *
 * 1. In your own file under `src/server/jobs/` (for example `retention.ts`), define it:
 *
 *      import { defineJob } from "./define";
 *
 *      export const retentionSweep = defineJob({
 *        name: "retention.sweep",          // area.verb, unique
 *        schedule: "15 3 * * *",           // optional: cron, Europe/London time
 *        event: "retention/sweep",         // optional: started by enqueue("retention/sweep", payload)
 *        run: async (ctx, payload: { dryRun?: boolean }) => {
 *          // ctx.actor is the system actor for this job; use ctx.db and ctx.now.
 *          return { deleted: 0 };          // counts and ids only: stored in job_run.summary
 *        },
 *      });
 *
 * 2. Import it here and add it to `JOBS` below, on its own line (keeps merges simple).
 *
 * 3. Make it idempotent: running it twice must be harmless. If one piece of work must happen
 *    exactly once, pass an idempotency key: `enqueue("export/requested", { id }, { idempotencyKey: `export:${id}` })`.
 *
 * Your job file may import your services, and those services may import `enqueue` from
 * `@/server/jobs`. That import loop is safe, because nothing under `src/server/jobs` reads this
 * list while modules are loading. Keep it that way: no top-level code that uses `JOBS`.
 *
 * To start a job from a service: `await enqueue("your/event", payload)` from `@/server/jobs`.
 * In tests: call your function directly, or `await runJob(retentionSweep, payload)`, or
 * `await enqueue(...)` followed by `await flushJobs()`.
 */
export const JOBS: JobDefinition<never>[] = [
  // kernel
  notificationsRelease,
  rateLimitCleanup,
  sessionsCleanup,
  // accounts
  accountsPurgePending as JobDefinition<never>,
  accountsRecalculateBands as JobDefinition<never>,
  // publishing
  ...(publishJobs as JobDefinition<never>[]),
];

function assertUnique(jobs: JobDefinition<never>[]): void {
  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.name)) throw new Error(`Two jobs are both called "${job.name}"`);
    seen.add(job.name);
  }
}
assertUnique(JOBS);

export function getJob(name: string): JobDefinition<unknown> | undefined {
  return JOBS.find((job) => job.name === name) as JobDefinition<unknown> | undefined;
}

export function jobsForEvent(event: string): JobDefinition<unknown>[] {
  return JOBS.filter((job) => job.event === event) as JobDefinition<unknown>[];
}
