import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps, ts } from "./_columns";
import { jobRunStatusEnum } from "./enums";

/** Operations (spec 6.3: every job is idempotent, observable and cost-tracked). */

export const jobRun = pgTable(
  "job_run",
  {
    id: id(),
    /** Registered job name, e.g. `retention.sweep`, `radar.fetch.hacker_news`. */
    job: text("job").notNull(),
    status: jobRunStatusEnum("status").notNull().default("running"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    attempt: integer("attempt").notNull().default(1),
    costPence: integer("cost_pence").notNull().default(0),
    /** Counts and ids only. No personal data and no learner free text. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    /** A second run with the same key is skipped. */
    idempotencyKey: text("idempotency_key"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("job_run_idempotency_uq").on(t.idempotencyKey),
    index("job_run_job_started_idx").on(t.job, t.startedAt),
    index("job_run_status_idx").on(t.status),
    check("job_run_cost_nonneg", sql`${t.costPence} >= 0`),
  ],
);

/**
 * Anonymous daily counters, e.g. `signup.under13_blocked`. This table must never hold personal
 * data: a row is a key, a London date and a number, nothing else. No ids, no IPs, no user agents.
 */
export const metricCounter = pgTable(
  "metric_counter",
  {
    id: id(),
    key: text("key").notNull(),
    /** `yyyy-MM-dd` in Europe/London. */
    day: date("day", { mode: "string" }).notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("metric_counter_key_day_uq").on(t.key, t.day),
    check("metric_counter_count_nonneg", sql`${t.count} >= 0`),
  ],
);
