import { and, eq, lt, notLike, sql } from "drizzle-orm";
import { actorUserId } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { sign } from "@/server/crypto";
import { db as rootDb, rateLimitBucket, type Db } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * Rate limiting on Postgres (`rate_limit_bucket`), so it works the same on every server instance
 * with no extra service.
 *
 *   await rateLimit(ctx, "children.add", { limit: 10, windowSec: 3600 });
 *
 * Fixed windows: time is cut into slices of `windowSec`, and each caller gets `limit` attempts
 * per slice. One atomic upsert counts the attempt, so parallel requests cannot slip past.
 */
export type RateLimitOptions = {
  limit: number;
  windowSec: number;
  /**
   * What to count against. Default: the signed-in user, else the caller's IP address (hashed),
   * else one shared "anonymous" bucket. Pass your own for per-family or per-code limits.
   * Never put a raw IP address or anything personal in a key: use `hashIp`.
   */
  key?: string;
};

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

const LIMITER_PREFIX = "rl:";
const CONCURRENCY_PREFIX = "concurrency:";
/** Buckets are kept a little past the end of their window so that clean-up never races a live one. */
const EXPIRY_GRACE_MS = 60_000;

/** A keyed hash of an IP address: stable for counting, useless for finding out who it was. */
export function hashIp(ip: string): string {
  return sign(`ip:${ip.trim().toLowerCase()}`).slice(0, 32);
}

/** The bucket a call counts against. Exported for tests. */
export function rateLimitKey(ctx: Pick<Ctx, "actor" | "ip">, name: string, key?: string): string {
  if (key !== undefined && key !== "") return `${LIMITER_PREFIX}${name}:${key}`;
  const userId = actorUserId(ctx.actor);
  if (userId) return `${LIMITER_PREFIX}${name}:user:${userId}`;
  if (ctx.ip) return `${LIMITER_PREFIX}${name}:ip:${hashIp(ctx.ip)}`;
  return `${LIMITER_PREFIX}${name}:anonymous`;
}

/** Pure: the window that `now` falls in. */
export function windowFor(now: Date, windowSec: number): { start: Date; end: Date } {
  const windowMs = windowSec * 1000;
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
  return { start: new Date(startMs), end: new Date(startMs + windowMs) };
}

/** "about 20 seconds", "about 3 minutes", "about 2 hours". */
export function describeWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `about ${s} second${s === 1 ? "" : "s"}`;
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Counts one attempt and says whether it is within the limit. Does not throw.
 * Note that it does count: call it once per attempt, not to peek.
 */
export async function checkRateLimit(
  ctx: Pick<Ctx, "db" | "actor" | "ip" | "now">,
  name: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSec } = options;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowSec) || windowSec <= 0) {
    throw new Error(
      `rateLimit("${name}"): limit must be a whole number of at least 1 and windowSec must be positive`,
    );
  }
  const key = rateLimitKey(ctx, name, options.key);
  const { start, end } = windowFor(ctx.now, windowSec);
  const rows = await ctx.db
    .insert(rateLimitBucket)
    .values({
      key,
      windowStart: start,
      count: 1,
      expiresAt: new Date(end.getTime() + EXPIRY_GRACE_MS),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: [rateLimitBucket.key, rateLimitBucket.windowStart],
      set: { count: sql`${rateLimitBucket.count} + 1`, updatedAt: ctx.now },
    })
    .returning({ count: rateLimitBucket.count });
  const count = rows[0]?.count ?? limit + 1;
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((end.getTime() - ctx.now.getTime()) / 1000)),
  };
}

/** Counts one attempt and throws `AppError("rate_limited")`, with how long to wait, when over the limit. */
export async function rateLimit(
  ctx: Pick<Ctx, "db" | "actor" | "ip" | "now">,
  name: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(ctx, name, options);
  if (!result.allowed) {
    throw new AppError(
      "rate_limited",
      `That's a lot in a short time. Give it ${describeWait(result.retryAfterSec)}, then try again.`,
      {
        detail: { name, retryAfterSec: result.retryAfterSec },
      },
    );
  }
  return result;
}

// ── Global concurrency cap ──────────────────────────────────────────────────

/**
 * A cap on how many things run at once across every server instance (used by the AI proxy).
 *
 * Each of the `limit` slots is a row in `rate_limit_bucket` (key `concurrency:<name>`,
 * `window_start` = the slot number as seconds after the epoch, `count` = times used). A slot is
 * free when its `expires_at` has passed. Taking one is a single statement that locks a free row
 * with SKIP LOCKED, so parallel callers each get a different slot and never more than `limit`
 * in total. If a holder crashes without releasing, its slot frees itself when the lease runs out.
 */
export type ConcurrencyLease = { name: string; slot: number; leaseUntil: Date };

export type ConcurrencyOptions = {
  /** How long a slot may be held before it is treated as abandoned. Default 120 seconds. */
  leaseSec?: number;
  /** The clock, for tests. Default: now. */
  now?: Date;
  db?: Db;
};

export const DEFAULT_LEASE_SEC = 120;

async function takeSlot(
  db: Db,
  key: string,
  limit: number,
  nowIso: string,
  leaseUntilIso: string,
): Promise<number | null> {
  const rows = await db.execute<{ slot: number }>(sql`
    WITH free AS (
      SELECT id FROM rate_limit_bucket
      WHERE key = ${key}
        AND window_start < to_timestamp(${limit}::int)
        AND expires_at <= ${nowIso}::timestamptz
      ORDER BY window_start
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE rate_limit_bucket b
    SET expires_at = ${leaseUntilIso}::timestamptz, count = b.count + 1, updated_at = ${nowIso}::timestamptz
    FROM free
    WHERE b.id = free.id
    RETURNING extract(epoch FROM b.window_start)::int AS slot`);
  const slot = rows[0]?.slot;
  return slot === undefined ? null : Number(slot);
}

/** Creates any missing slot rows (already free). Returns how many were added. */
async function ensureSlots(db: Db, key: string, limit: number): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO rate_limit_bucket (key, window_start, count, expires_at)
    SELECT ${key}, to_timestamp(g), 0, to_timestamp(0)
    FROM generate_series(0, ${limit}::int - 1) AS g
    ON CONFLICT (key, window_start) DO NOTHING
    RETURNING id`);
  return rows.length;
}

/** Takes a slot, or returns `null` when all `limit` are in use. Always pair with `releaseConcurrency` in a `finally`. */
export async function acquireConcurrency(
  name: string,
  limit: number,
  options: ConcurrencyOptions = {},
): Promise<ConcurrencyLease | null> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error(`acquireConcurrency("${name}"): limit must be a whole number of at least 1`);
  const db = options.db ?? rootDb;
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseSec ?? DEFAULT_LEASE_SEC) * 1000);
  const key = `${CONCURRENCY_PREFIX}${name}`;
  const nowIso = now.toISOString();
  const leaseIso = leaseUntil.toISOString();

  let slot = await takeSlot(db, key, limit, nowIso, leaseIso);
  if (slot === null) {
    // Either every slot is busy, or the slot rows do not exist yet (first use, a raised limit, or
    // another caller creating them at this moment). Make sure they exist, then try once more.
    await ensureSlots(db, key, limit);
    slot = await takeSlot(db, key, limit, nowIso, leaseIso);
  }
  return slot === null ? null : { name, slot, leaseUntil };
}

/** Gives the slot back. Safe to call twice, and a no-op if the lease already ran out and someone else holds the slot. */
export async function releaseConcurrency(
  lease: ConcurrencyLease,
  options: Pick<ConcurrencyOptions, "db"> = {},
): Promise<void> {
  const db = options.db ?? rootDb;
  await db.execute(sql`
    UPDATE rate_limit_bucket
    SET expires_at = to_timestamp(0), updated_at = now()
    WHERE key = ${`${CONCURRENCY_PREFIX}${lease.name}`}
      AND window_start = to_timestamp(${lease.slot}::int)
      AND expires_at = ${lease.leaseUntil.toISOString()}::timestamptz`);
}

/** Runs `fn` inside a slot. Throws `AppError("rate_limited")` when the cap is reached. */
export async function withConcurrency<T>(
  name: string,
  limit: number,
  fn: () => Promise<T>,
  options: ConcurrencyOptions = {},
): Promise<T> {
  const lease = await acquireConcurrency(name, limit, options);
  if (!lease) {
    throw new AppError("rate_limited", "It's really busy right now. Wait a few seconds, then try again.", {
      detail: { name, limit },
    });
  }
  try {
    return await fn();
  } finally {
    await releaseConcurrency(lease, options);
  }
}

/** Deletes finished rate-limit windows. Concurrency slots are left alone. Used by the `ratelimit.cleanup` job. */
export async function deleteExpiredRateLimitBuckets(ctx: Pick<Ctx, "db" | "now">): Promise<number> {
  const deleted = await ctx.db
    .delete(rateLimitBucket)
    .where(
      and(lt(rateLimitBucket.expiresAt, ctx.now), notLike(rateLimitBucket.key, `${CONCURRENCY_PREFIX}%`)),
    )
    .returning({ id: rateLimitBucket.id });
  return deleted.length;
}

/** For tests and Studio diagnostics: how many slots are held right now. */
export async function concurrencyInUse(
  name: string,
  options: Pick<ConcurrencyOptions, "db" | "now"> = {},
): Promise<number> {
  const db = options.db ?? rootDb;
  const now = options.now ?? new Date();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rateLimitBucket)
    .where(
      and(
        eq(rateLimitBucket.key, `${CONCURRENCY_PREFIX}${name}`),
        sql`${rateLimitBucket.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    );
  return rows[0]?.n ?? 0;
}
