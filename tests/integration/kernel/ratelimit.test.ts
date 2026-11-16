import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimitBucket } from "@/server/db";
import { AppError } from "@/server/errors";
import { runJob } from "@/server/jobs";
import {
  acquireConcurrency,
  checkRateLimit,
  concurrencyInUse,
  deleteExpiredRateLimitBuckets,
  rateLimit,
  releaseConcurrency,
  withConcurrency,
} from "@/server/ratelimit";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createLearner } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

const at = (iso: string) => new Date(iso);

describe("rateLimit", () => {
  it("lets exactly `limit` of 50 parallel calls through", async () => {
    const { actor } = await createLearner();
    const ctx = testCtx(actor, { now: at("2026-11-16T12:00:10Z") });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => checkRateLimit(ctx, "coach.chat", { limit: 10, windowSec: 60 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(40);
    // One row, and every attempt was counted: nothing was lost to a race.
    const rows = await db.select().from(rateLimitBucket);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: `rl:coach.chat:user:${actor.userId}`, count: 50 });
    // `remaining` counted down without repeats among the calls that got through.
    expect(
      results
        .filter((r) => r.allowed)
        .map((r) => r.remaining)
        .sort((a, b) => a - b),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("the throwing form also lets exactly `limit` through, and the rest get a friendly error", async () => {
    const ctx = testCtx(undefined, { now: at("2026-11-16T12:00:10Z") });
    const settled = await Promise.allSettled(
      Array.from({ length: 50 }, () => rateLimit(ctx, "signup", { limit: 10, windowSec: 60 })),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(10);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected).toHaveLength(40);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect(r.reason).toMatchObject({ code: "rate_limited", status: 429 });
    }
  });

  it("says how long to wait", async () => {
    const ctx = testCtx(undefined, { now: at("2026-11-16T12:00:40Z") });
    await rateLimit(ctx, "invite.check", { limit: 1, windowSec: 60 });
    await expect(rateLimit(ctx, "invite.check", { limit: 1, windowSec: 60 })).rejects.toThrow(
      "Give it about 20 seconds, then try again.",
    );
    const hourly = testCtx(undefined, { now: at("2026-11-16T12:10:00Z") });
    await rateLimit(hourly, "children.add", { limit: 1, windowSec: 3600 });
    await expect(rateLimit(hourly, "children.add", { limit: 1, windowSec: 3600 })).rejects.toThrow(
      /about 50 minutes/,
    );
    expect(await checkRateLimit(hourly, "children.add", { limit: 1, windowSec: 3600 })).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 3000,
    });
  });

  it("starts afresh in the next window", async () => {
    const options = { limit: 2, windowSec: 60 };
    const first = testCtx(undefined, { now: at("2026-11-16T12:00:59Z") });
    await rateLimit(first, "x", options);
    await rateLimit(first, "x", options);
    await expect(rateLimit(first, "x", options)).rejects.toMatchObject({ code: "rate_limited" });
    const next = testCtx(undefined, { now: at("2026-11-16T12:01:00Z") });
    expect(await rateLimit(next, "x", options)).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
  });

  it("counts each user, each IP address and each limiter name separately", async () => {
    const a = await createLearner();
    const b = await createLearner();
    const options = { limit: 1, windowSec: 60 };
    const now = at("2026-11-16T12:00:00Z");
    await rateLimit(testCtx(a.actor, { now }), "x", options);
    await rateLimit(testCtx(b.actor, { now }), "x", options);
    await rateLimit(testCtx(a.actor, { now }), "y", options);
    await expect(rateLimit(testCtx(a.actor, { now }), "x", options)).rejects.toMatchObject({
      code: "rate_limited",
    });

    await rateLimit(testCtx(undefined, { now, ip: "198.51.100.1" }), "x", options);
    await rateLimit(testCtx(undefined, { now, ip: "198.51.100.2" }), "x", options);
    await expect(
      rateLimit(testCtx(undefined, { now, ip: "198.51.100.1" }), "x", options),
    ).rejects.toMatchObject({ code: "rate_limited" });

    // A signed-in user is counted by account, wherever they connect from.
    await expect(
      rateLimit(testCtx(a.actor, { now, ip: "198.51.100.77" }), "x", options),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("never stores a raw IP address", async () => {
    await rateLimit(testCtx(undefined, { ip: "198.51.100.23" }), "signup", { limit: 5, windowSec: 60 });
    const rows = await db.select().from(rateLimitBucket);
    expect(rows[0]?.key).toMatch(/^rl:signup:ip:/);
    expect(JSON.stringify(rows)).not.toContain("198.51.100.23");
  });

  it("a custom key shares one bucket across callers (per family, say)", async () => {
    const a = await createLearner();
    const b = await createLearner();
    const options = { limit: 2, windowSec: 60, key: "family:f-1" };
    const now = at("2026-11-16T12:00:00Z");
    await rateLimit(testCtx(a.actor, { now }), "coach.chat", options);
    await rateLimit(testCtx(b.actor, { now }), "coach.chat", options);
    await expect(rateLimit(testCtx(a.actor, { now }), "coach.chat", options)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("the clean-up job deletes finished windows and leaves live ones and concurrency slots", async () => {
    await rateLimit(testCtx(undefined, { now: at("2026-11-16T10:00:00Z") }), "old", {
      limit: 5,
      windowSec: 60,
    });
    await rateLimit(testCtx(undefined, { now: at("2026-11-16T12:00:30Z") }), "live", {
      limit: 5,
      windowSec: 60,
    });
    const lease = await acquireConcurrency("ai", 2, { now: at("2026-11-16T12:00:30Z") });
    expect(lease).not.toBeNull();

    const result = await runJob("ratelimit.cleanup", undefined, { now: at("2026-11-16T12:00:45Z") });
    expect(result).toMatchObject({ status: "succeeded", summary: { deleted: 1 } });
    const keys = (await db.select().from(rateLimitBucket))
      .map((r) => r.key.split(":").slice(0, 2).join(":"))
      .sort();
    expect(keys).toEqual(["concurrency:ai", "concurrency:ai", "rl:live"]);
    expect(await deleteExpiredRateLimitBuckets({ db, now: at("2026-11-16T12:00:45Z") })).toBe(0);
  });
});

describe("global concurrency cap", () => {
  it("lets exactly 10 of 50 parallel callers through with a limit of 10", async () => {
    const leases = await Promise.all(Array.from({ length: 50 }, () => acquireConcurrency("ai.chat", 10)));
    const held = leases.filter((l) => l !== null);
    expect(held).toHaveLength(10);
    expect(new Set(held.map((l) => l.slot)).size).toBe(10);
    expect(await concurrencyInUse("ai.chat")).toBe(10);
    expect(await acquireConcurrency("ai.chat", 10)).toBeNull();
  });

  it("does the same again once slots exist, and frees a slot on release", async () => {
    await Promise.all(
      (await Promise.all(Array.from({ length: 10 }, () => acquireConcurrency("ai.chat", 10)))).map((l) =>
        l ? releaseConcurrency(l) : null,
      ),
    );
    expect(await concurrencyInUse("ai.chat")).toBe(0);

    const leases = await Promise.all(Array.from({ length: 50 }, () => acquireConcurrency("ai.chat", 10)));
    const held = leases.filter((l) => l !== null);
    expect(held).toHaveLength(10);

    const first = held[0];
    if (!first) throw new Error("no lease");
    await releaseConcurrency(first);
    expect(await concurrencyInUse("ai.chat")).toBe(9);
    const again = await acquireConcurrency("ai.chat", 10);
    expect(again?.slot).toBe(first.slot);
    expect(await acquireConcurrency("ai.chat", 10)).toBeNull();
    // Releasing twice is harmless and cannot free the slot's new holder.
    await releaseConcurrency(first);
    expect(await concurrencyInUse("ai.chat")).toBe(10);
  });

  it("a holder that never releases loses its slot when the lease runs out", async () => {
    const t0 = at("2026-11-16T12:00:00Z");
    const crashed = await acquireConcurrency("ai.draft", 1, { now: t0, leaseSec: 60 });
    expect(crashed).not.toBeNull();
    expect(
      await acquireConcurrency("ai.draft", 1, { now: new Date(t0.getTime() + 59_000), leaseSec: 60 }),
    ).toBeNull();
    const next = await acquireConcurrency("ai.draft", 1, {
      now: new Date(t0.getTime() + 60_000),
      leaseSec: 60,
    });
    expect(next).toMatchObject({ slot: 0 });
    // The crashed holder waking up late cannot release the new holder's slot.
    if (crashed) await releaseConcurrency(crashed);
    expect(await concurrencyInUse("ai.draft", { now: new Date(t0.getTime() + 61_000) })).toBe(1);
  });

  it("caps are separate per name, and a lower limit applies at once", async () => {
    const a = await acquireConcurrency("one", 1);
    const b = await acquireConcurrency("two", 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    await Promise.all(Array.from({ length: 5 }, () => acquireConcurrency("shrink", 5)));
    expect(await concurrencyInUse("shrink")).toBe(5);
    const rows = await db
      .select()
      .from(rateLimitBucket)
      .where(like(rateLimitBucket.key, "concurrency:shrink"));
    for (const row of rows)
      await db
        .update(rateLimitBucket)
        .set({ expiresAt: new Date(0) })
        .where(eq(rateLimitBucket.id, row.id));
    const afterShrink = await Promise.all(Array.from({ length: 5 }, () => acquireConcurrency("shrink", 2)));
    expect(afterShrink.filter((l) => l !== null)).toHaveLength(2);
  });

  it("withConcurrency runs inside a slot, releases it afterwards and says so when busy", async () => {
    let inside = 0;
    const result = await withConcurrency("job", 1, async () => {
      inside = await concurrencyInUse("job");
      await expect(withConcurrency("job", 1, async () => "nested")).rejects.toMatchObject({
        code: "rate_limited",
      });
      return "done";
    });
    expect(result).toBe("done");
    expect(inside).toBe(1);
    expect(await concurrencyInUse("job")).toBe(0);
    await expect(
      withConcurrency("job", 1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await concurrencyInUse("job")).toBe(0);
  });
});
