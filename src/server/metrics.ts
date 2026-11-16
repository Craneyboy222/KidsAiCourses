import { and, eq, gte, lte, sql } from "drizzle-orm";
import { londonDateKey } from "@/lib/dates";
import type { Ctx } from "@/server/context";
import { metricCounter } from "@/server/db";

/**
 * Anonymous daily counters (`metric_counter`): a key, a UK date and a number. Nothing else.
 *
 * This exists so that we can count things about people we must not keep anything about, above
 * all the under-13 block: when someone under 13 tries to sign up we store nothing at all about
 * them, and add one to today's total.
 *
 * To keep it that way, `incrementCounter` takes no free text. The key must be one of
 * `METRIC_KEYS`, and there is deliberately no parameter that could carry an id, an IP address,
 * a user agent or anything else about a person. Add a key here when you need a new counter.
 */
export const METRIC_KEYS = ["signup.under13_blocked", "signup.closed_attempt"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const KNOWN: ReadonlySet<string> = new Set(METRIC_KEYS);

/** Adds `by` (default 1) to the counter for today in UK time. */
export async function incrementCounter(ctx: Pick<Ctx, "db" | "now">, key: MetricKey, by = 1): Promise<void> {
  // Checked at run time as well as by the type, in case a caller casts its way past the compiler.
  if (!KNOWN.has(key)) throw new Error("incrementCounter: unknown metric key. Add it to METRIC_KEYS.");
  if (!Number.isInteger(by) || by < 1 || by > 1_000_000)
    throw new Error("incrementCounter: `by` must be a whole number from 1 to 1,000,000");
  const day = londonDateKey(ctx.now);
  await ctx.db
    .insert(metricCounter)
    .values({ key, day, count: by, createdAt: ctx.now, updatedAt: ctx.now })
    .onConflictDoUpdate({
      target: [metricCounter.key, metricCounter.day],
      set: { count: sql`${metricCounter.count} + ${by}`, updatedAt: ctx.now },
    });
}

/** Daily totals for a counter between two UK dates (`yyyy-MM-dd`, inclusive), oldest first. */
export async function readCounter(
  ctx: Pick<Ctx, "db">,
  key: MetricKey,
  range: { from: string; to: string },
): Promise<Array<{ day: string; count: number }>> {
  return ctx.db
    .select({ day: metricCounter.day, count: metricCounter.count })
    .from(metricCounter)
    .where(
      and(eq(metricCounter.key, key), gte(metricCounter.day, range.from), lte(metricCounter.day, range.to)),
    )
    .orderBy(metricCounter.day);
}
