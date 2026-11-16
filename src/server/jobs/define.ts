import { and, eq, lt, or, sql } from "drizzle-orm";
import { systemCtx, type Ctx } from "@/server/context";
import { db, jobRun } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError, logInfo } from "@/server/log";

/**
 * Background jobs (docs/ARCHITECTURE.md "Jobs").
 *
 * A job is a plain async function `(ctx, payload) => summary`. `defineJob` gives it a name and
 * says what starts it: a schedule (cron, UK time), an event, or both. `runJob` is the one way a
 * job is executed, whoever asks (Inngest, the cron fallback route, the in-process queue or a
 * test): it runs the function as the `system` actor and records a `job_run` row with the
 * status, how long it took and its summary or error.
 *
 * Jobs must be idempotent. `runJob` helps: a run carries an idempotency key, and a second run
 * with the same key is skipped unless the first one failed.
 */

/** Counts and ids only. Never personal data or learner free text: this is stored and shown in Studio. */
export type JobSummary = Record<string, unknown>;

export type JobDefinition<P = unknown, S extends JobSummary = JobSummary> = {
  /** `area.verb`, unique, e.g. `retention.sweep`. Appears in `job_run.job` and as the audit actor. */
  name: string;
  /** Five-field cron in Europe/London time, e.g. `"15 3 * * *"` for 03:15 every night. */
  schedule?: string;
  /** Event name that triggers the job through `enqueue(event, payload)`, e.g. `"export/requested"`. */
  event?: string;
  /** Extra attempts after a failure (exponential backoff between them). Default 4. */
  retries?: number;
  run: (ctx: Ctx, payload: P) => Promise<S>;
};

const NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const CRON = /^(\S+\s+){4}\S+$/;

export function defineJob<P = unknown, S extends JobSummary = JobSummary>(
  definition: JobDefinition<P, S>,
): JobDefinition<P, S> {
  if (!NAME.test(definition.name))
    throw new Error(`Job name "${definition.name}" must look like area.verb (lower case, dots)`);
  if (definition.schedule !== undefined && !CRON.test(definition.schedule.trim())) {
    throw new Error(
      `Job "${definition.name}": schedule must be a five-field cron expression (it is read as Europe/London time)`,
    );
  }
  if (
    definition.retries !== undefined &&
    (!Number.isInteger(definition.retries) || definition.retries < 0 || definition.retries > 20)
  ) {
    throw new Error(`Job "${definition.name}": retries must be a whole number from 0 to 20`);
  }
  return definition;
}

export type RunJobOptions = {
  /** A second run with the same key is skipped (unless the first failed, when it runs again). Default: a new key per call. */
  idempotencyKey?: string;
  /** The clock handed to the job, for tests. */
  now?: Date;
};

export type JobRunResult =
  | { status: "succeeded"; runId: string; summary: JobSummary; durationMs: number }
  | { status: "skipped"; runId: string | null; reason: "duplicate" };

/** A run still marked `running` after this long is assumed to have died, and may be taken over. */
const STALE_RUN_MS = 60 * 60 * 1000;

async function resolveJob(job: string | JobDefinition<never>): Promise<JobDefinition<unknown>> {
  if (typeof job !== "string") return job as unknown as JobDefinition<unknown>;
  // Imported here because the registry imports this file for `defineJob`.
  const { getJob } = await import("./registry");
  const found = getJob(job);
  if (!found) throw new AppError("not_found", "That job doesn't exist.", { detail: { job } });
  return found;
}

/**
 * Starts the run's `job_run` row. Returns its id, or `null` when another run already holds the
 * key. One statement: the unique index on `idempotency_key` decides between parallel callers.
 */
async function claimRun(name: string, key: string | null, now: Date): Promise<string | null> {
  const inserted = await db
    .insert(jobRun)
    .values({
      job: name,
      status: "running",
      startedAt: now,
      idempotencyKey: key,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: jobRun.idempotencyKey })
    .returning({ id: jobRun.id });
  if (inserted[0]) return inserted[0].id;
  if (key === null) return null;
  // The key exists. Take it over only if that run failed, or has been "running" for implausibly long.
  const retried = await db
    .update(jobRun)
    .set({
      status: "running",
      startedAt: now,
      finishedAt: null,
      error: null,
      attempt: sql`${jobRun.attempt} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobRun.idempotencyKey, key),
        or(
          eq(jobRun.status, "failed"),
          and(eq(jobRun.status, "running"), lt(jobRun.startedAt, new Date(now.getTime() - STALE_RUN_MS))),
        ),
      ),
    )
    .returning({ id: jobRun.id });
  return retried[0]?.id ?? null;
}

/**
 * Runs a job by name (or definition) and records it. Resolves with the result when the job
 * succeeds or is skipped; when the job throws, the failure is recorded and the error is thrown
 * on, so that Inngest retries it and the cron route answers with an error.
 */
export async function runJob<P = unknown>(
  job: string | JobDefinition<P>,
  payload?: P,
  options: RunJobOptions = {},
): Promise<JobRunResult> {
  const definition = await resolveJob(job as string | JobDefinition<never>);
  const ctx = systemCtx(definition.name, options.now ? { now: options.now } : {});
  const key = options.idempotencyKey ?? null;

  const runId = await claimRun(definition.name, key, ctx.now);
  if (!runId) {
    // Leave a trace, so "why didn't it run?" can be answered from the table.
    const skipped = await db
      .insert(jobRun)
      .values({
        job: definition.name,
        status: "skipped",
        startedAt: ctx.now,
        finishedAt: ctx.now,
        summary: { duplicateOf: key },
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: jobRun.id });
    return { status: "skipped", runId: skipped[0]?.id ?? null, reason: "duplicate" };
  }

  const started = performance.now();
  const finishedAt = () => new Date(ctx.now.getTime() + Math.round(performance.now() - started));
  try {
    const summary = (await definition.run(ctx, payload)) ?? {};
    const at = finishedAt();
    await db
      .update(jobRun)
      .set({ status: "succeeded", finishedAt: at, summary, error: null, updatedAt: at })
      .where(eq(jobRun.id, runId));
    const durationMs = at.getTime() - ctx.now.getTime();
    logInfo("job.succeeded", { job: definition.name, runId, durationMs });
    return { status: "succeeded", runId, summary, durationMs };
  } catch (error) {
    const at = finishedAt();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await db
      .update(jobRun)
      .set({ status: "failed", finishedAt: at, error: message, updatedAt: at })
      .where(eq(jobRun.id, runId))
      .catch((recordError: unknown) =>
        logError("job.record_failed", recordError, { job: definition.name, runId }),
      );
    logError("job.failed", error, { job: definition.name, runId });
    throw error;
  }
}
