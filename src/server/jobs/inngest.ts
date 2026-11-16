import { randomUUID } from "node:crypto";
import { Inngest, type InngestFunction } from "inngest";
import { env } from "@/env";
import { logError, logWarn } from "@/server/log";
import { runJob, type JobDefinition } from "./define";
import { JOBS, jobsForEvent } from "./registry";

/**
 * Scheduling and retries for the jobs in `registry.ts`.
 *
 * With Inngest configured (`INNGEST_EVENT_KEY`, or `INNGEST_DEV=true` for the local dev server)
 * every job is an Inngest function: scheduled jobs on their cron (UK time), event jobs when
 * `enqueue()` sends their event, each retried with Inngest's exponential backoff.
 *
 * Without Inngest, `enqueue()` runs the job in this process instead, just after the current
 * tick, so local development and tests need no extra service. Tests wait with `flushJobs()`.
 * Scheduled jobs then rely on the cron fallback, `POST /api/jobs/<name>` with `CRON_SECRET`.
 */
export const INNGEST_APP_ID = "platform";
export const DEFAULT_JOB_RETRIES = 4;

type Retries = NonNullable<InngestFunction.Options["retries"]>;

const globalForJobs = globalThis as typeof globalThis & {
  __platformInngest?: Inngest;
  __platformInlineJobs?: { pending: Set<Promise<void>>; failures: InlineFailure[]; ran: number };
};

/** True when events should go to Inngest rather than run in this process. */
export function inngestConfigured(): boolean {
  return Boolean(env.INNGEST_EVENT_KEY) || env.INNGEST_DEV;
}

/** The Inngest client, created on first use so that importing this file reads no environment. */
export function getInngest(): Inngest {
  return (globalForJobs.__platformInngest ??= new Inngest({
    id: INNGEST_APP_ID,
    ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
    ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
    ...(env.INNGEST_DEV ? { isDev: true } : {}),
  }));
}

/** `retention.sweep` → `retention-sweep`: Inngest function ids must stay stable between deployments. */
export const inngestFunctionId = (jobName: string) => jobName.replace(/[^a-z0-9]+/g, "-");

/** The triggers Inngest is given for a job. Exported for tests. */
export function inngestTriggers(
  job: Pick<JobDefinition<never>, "schedule" | "event">,
): Array<{ cron: string } | { event: string }> {
  const triggers: Array<{ cron: string } | { event: string }> = [];
  // Inngest reads a leading TZ= as the time zone, so 03:15 stays 03:15 across the clock changes.
  if (job.schedule) triggers.push({ cron: `TZ=${env.TZ_DISPLAY} ${job.schedule.trim()}` });
  if (job.event) triggers.push({ event: job.event });
  return triggers;
}

/** One Inngest function per registered job. */
export function buildInngestFunctions(): InngestFunction.Any[] {
  const client = getInngest();
  return JOBS.filter((job) => job.schedule || job.event).map((job) =>
    client.createFunction(
      {
        id: inngestFunctionId(job.name),
        name: job.name,
        triggers: inngestTriggers(job),
        // Inngest waits longer after each failure (exponential backoff with jitter).
        retries: (job.retries ?? DEFAULT_JOB_RETRIES) as Retries,
      },
      async ({ event, runId }) => {
        const scheduled = event.name === "inngest/scheduled.timer";
        // A retry of the same run, or a second delivery of the same event, reuses the key:
        // `runJob` then re-runs a failed attempt and skips one that already succeeded.
        const idempotencyKey =
          scheduled || !event.id ? `${job.name}:run:${runId}` : `${job.name}:evt:${event.id}`;
        return runJob(job as JobDefinition<unknown>, scheduled ? undefined : (event.data as unknown), {
          idempotencyKey,
        });
      },
    ),
  );
}

// ── In-process queue (no Inngest) ───────────────────────────────────────────

export type InlineFailure = { job: string; error: string };
const inline = (globalForJobs.__platformInlineJobs ??= {
  pending: new Set<Promise<void>>(),
  failures: [],
  ran: 0,
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Extra attempts in this process: enough to ride out a blip, not enough to hold a request up. */
const INLINE_MAX_RETRIES = 2;
const inlineBackoffMs = () => (env.APP_ENV === "test" ? 1 : 250);

async function runInline(
  job: JobDefinition<unknown>,
  payload: unknown,
  idempotencyKey: string,
): Promise<void> {
  const retries = Math.min(job.retries ?? DEFAULT_JOB_RETRIES, INLINE_MAX_RETRIES);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runJob(job, payload, { idempotencyKey });
      inline.ran += 1;
      return;
    } catch (error) {
      if (attempt >= retries) {
        // `runJob` has already recorded the failure in `job_run` and logged it.
        inline.failures.push({
          job: job.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      await sleep(inlineBackoffMs() * 2 ** attempt);
    }
  }
}

export type EnqueueResult = { mode: "inngest" | "inline" | "inline_awaited" | "no_listener"; jobs: string[] };

/**
 * Asks for the job(s) listening to `event` to run in the background.
 *
 * `payload` must be plain JSON (ids and small values, never learner free text): it travels
 * through Inngest in production, and is copied the same way locally so both behave alike.
 * `idempotencyKey` makes a repeat of the same request a no-op.
 */
export async function enqueue(
  event: string,
  payload: Record<string, unknown> = {},
  options: { idempotencyKey?: string } = {},
): Promise<EnqueueResult> {
  const listeners = jobsForEvent(event);
  const jobs = listeners.map((job) => job.name);

  if (inngestConfigured()) {
    await getInngest().send({
      name: event,
      data: payload,
      ...(options.idempotencyKey ? { id: options.idempotencyKey } : {}),
    });
    return { mode: "inngest", jobs };
  }

  if (listeners.length === 0) {
    logWarn("jobs.enqueue.no_listener", { event });
    return { mode: "no_listener", jobs };
  }

  const copy = JSON.parse(JSON.stringify(payload)) as unknown;
  const keyFor = (job: JobDefinition<unknown>) =>
    `${job.name}:${options.idempotencyKey ? `evt:${options.idempotencyKey}` : `inline:${randomUUID()}`}`;

  if (env.APP_ENV === "production" || env.APP_ENV === "preview") {
    // A serverless function may be frozen the moment it responds, so "later" might never come.
    // Without Inngest, do the work now and make the caller wait for it.
    logWarn("jobs.enqueue.no_inngest", { event });
    for (const job of listeners) await runInline(job, copy, keyFor(job));
    return { mode: "inline_awaited", jobs };
  }

  for (const job of listeners) {
    const key = keyFor(job);
    const task: Promise<void> = sleep(0)
      .then(() => runInline(job, copy, key))
      .catch((error: unknown) => logError("jobs.inline.unexpected", error, { job: job.name }))
      .finally(() => inline.pending.delete(task));
    inline.pending.add(task);
  }
  return { mode: "inline", jobs };
}

/**
 * Waits until every job queued in this process has finished, including jobs queued by those
 * jobs. For tests: `await enqueue(...); const { failed } = await flushJobs();`
 */
export async function flushJobs(): Promise<{ ran: number; failed: InlineFailure[] }> {
  while (inline.pending.size > 0) await Promise.allSettled([...inline.pending]);
  const result = { ran: inline.ran, failed: inline.failures.splice(0) };
  inline.ran = 0;
  return result;
}
