import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as inngestGET } from "@/app/api/inngest/route";
import { GET as jobGET, POST as jobPOST } from "@/app/api/jobs/[name]/route";
import { env } from "@/env";
import { auditLog, jobRun, session, verification } from "@/server/db";
import { audit } from "@/server/audit";
import { defineJob, enqueue, flushJobs, runJob } from "@/server/jobs";
import { JOBS } from "@/server/jobs/registry";
import { closeDb, db, resetDb } from "../../helpers/db";
import { createParent } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
  await flushJobs();
});
afterAll(async () => {
  // Remove the test-only jobs added to the shared registry below.
  for (const name of ["test.echo", "test.flaky", "test.chain"]) {
    const index = JOBS.findIndex((j) => j.name === name);
    if (index >= 0) JOBS.splice(index, 1);
  }
  await closeDb();
});

const calls: unknown[] = [];
const echo = defineJob({
  name: "test.echo",
  event: "test/echo",
  run: async (ctx, payload: { n?: number } | undefined) => {
    calls.push(payload);
    await audit(ctx, { action: "test.echo.ran" });
    return { n: payload?.n ?? 0, actor: ctx.actor.type };
  },
});
let failuresLeft = 0;
const flaky = defineJob({
  name: "test.flaky",
  event: "test/flaky",
  run: async () => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error("temporary wobble");
    }
    return { ok: true };
  },
});
const chain = defineJob({
  name: "test.chain",
  event: "test/chain",
  run: async () => {
    await enqueue("test/echo", { n: 99 });
    return { chained: true };
  },
});
JOBS.push(echo, flaky, chain);

beforeEach(() => {
  calls.length = 0;
  failuresLeft = 0;
});

const runs = (job?: string) =>
  job
    ? db.select().from(jobRun).where(eq(jobRun.job, job)).orderBy(desc(jobRun.createdAt))
    : db.select().from(jobRun);

describe("runJob", () => {
  it("runs as the system actor and records a job_run row with status, timing and summary", async () => {
    const now = new Date("2026-11-16T03:15:00Z");
    const result = await runJob(echo, { n: 7 }, { now });
    expect(result).toMatchObject({ status: "succeeded", summary: { n: 7, actor: "system" } });
    const [row] = await runs();
    expect(row).toMatchObject({
      job: "test.echo",
      status: "succeeded",
      attempt: 1,
      summary: { n: 7, actor: "system" },
      error: null,
      idempotencyKey: null,
    });
    expect(row?.startedAt).toEqual(now);
    expect(row?.finishedAt?.getTime()).toBeGreaterThanOrEqual(now.getTime());
    if (result.status === "succeeded")
      expect(result.durationMs).toBe((row?.finishedAt?.getTime() ?? 0) - now.getTime());
    // What the job did is attributed to the job in the audit log.
    const [log] = await db.select().from(auditLog);
    expect(log).toMatchObject({ actorType: "system", actorLabel: "test.echo", action: "test.echo.ran" });
    expect(log?.requestId).toMatch(/^job:test\.echo:/);
  });

  it("skips a second run with the same idempotency key, and leaves a trace of the skip", async () => {
    const first = await runJob(echo, { n: 1 }, { idempotencyKey: "export:42" });
    const second = await runJob(echo, { n: 2 }, { idempotencyKey: "export:42" });
    expect(first.status).toBe("succeeded");
    expect(second).toMatchObject({ status: "skipped", reason: "duplicate" });
    expect(calls).toEqual([{ n: 1 }]);
    const rows = await runs();
    expect(rows.map((r) => r.status).sort()).toEqual(["skipped", "succeeded"]);
    expect(rows.find((r) => r.status === "skipped")).toMatchObject({
      job: "test.echo",
      idempotencyKey: null,
      summary: { duplicateOf: "export:42" },
    });
  });

  it("runs once when the same key is used by many callers at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => runJob(echo, { n: 5 }, { idempotencyKey: "same-moment" })),
    );
    expect(results.filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(results.filter((r) => r.status === "skipped")).toHaveLength(11);
    expect(calls).toHaveLength(1);
  });

  it("a different key, or no key, runs again", async () => {
    await runJob(echo, { n: 1 }, { idempotencyKey: "a" });
    await runJob(echo, { n: 2 }, { idempotencyKey: "b" });
    await runJob(echo, { n: 3 });
    await runJob(echo, { n: 4 });
    expect(calls).toHaveLength(4);
  });

  it("records a failure with its error and throws it on; a retry with the same key then runs", async () => {
    failuresLeft = 1;
    await expect(runJob(flaky, undefined, { idempotencyKey: "nightly:2026-11-16" })).rejects.toThrow(
      "temporary wobble",
    );
    let [row] = await runs("test.flaky");
    expect(row).toMatchObject({ status: "failed", error: "temporary wobble", attempt: 1 });
    expect(row?.finishedAt).not.toBeNull();

    const retry = await runJob(flaky, undefined, { idempotencyKey: "nightly:2026-11-16" });
    expect(retry.status).toBe("succeeded");
    const rows = await runs("test.flaky");
    expect(rows).toHaveLength(1);
    [row] = rows;
    expect(row).toMatchObject({ status: "succeeded", attempt: 2, error: null, summary: { ok: true } });

    // Once it has succeeded, the key is spent.
    expect((await runJob(flaky, undefined, { idempotencyKey: "nightly:2026-11-16" })).status).toBe("skipped");
  });

  it("takes over a run that has been 'running' for over an hour, but not a fresh one", async () => {
    const now = new Date("2026-11-16T12:00:00Z");
    await db
      .insert(jobRun)
      .values({
        job: "test.echo",
        status: "running",
        idempotencyKey: "stuck",
        startedAt: new Date(now.getTime() - 30 * 60_000),
      });
    expect((await runJob(echo, {}, { idempotencyKey: "stuck", now })).status).toBe("skipped");
    await db
      .update(jobRun)
      .set({ startedAt: new Date(now.getTime() - 61 * 60_000) })
      .where(eq(jobRun.idempotencyKey, "stuck"));
    expect((await runJob(echo, {}, { idempotencyKey: "stuck", now })).status).toBe("succeeded");
  });

  it("runs a registered job by name, and refuses an unknown name", async () => {
    expect((await runJob("test.echo", { n: 3 })).status).toBe("succeeded");
    await expect(runJob("no.such_job")).rejects.toMatchObject({ code: "not_found" });
    expect(await runs("no.such_job")).toHaveLength(0);
  });
});

describe("enqueue and flushJobs (no Inngest configured)", () => {
  it("runs the job in this process after the current tick, and flushJobs waits for it", async () => {
    const result = await enqueue("test/echo", { n: 11 });
    expect(result).toEqual({ mode: "inline", jobs: ["test.echo"] });
    expect(calls).toEqual([]); // not yet: it runs after the caller carries on
    expect(await flushJobs()).toEqual({ ran: 1, failed: [] });
    expect(calls).toEqual([{ n: 11 }]);
    expect((await runs("test.echo"))[0]?.status).toBe("succeeded");
  });

  it("waits for jobs that were queued by other jobs", async () => {
    await enqueue("test/chain");
    const { ran, failed } = await flushJobs();
    expect(ran).toBe(2);
    expect(failed).toEqual([]);
    expect(calls).toEqual([{ n: 99 }]);
  });

  it("an idempotency key makes a repeated request a no-op", async () => {
    await enqueue("test/echo", { n: 1 }, { idempotencyKey: "certificate:9" });
    await enqueue("test/echo", { n: 1 }, { idempotencyKey: "certificate:9" });
    await flushJobs();
    expect(calls).toHaveLength(1);
  });

  it("retries a failing job with backoff, then reports it if it keeps failing", async () => {
    failuresLeft = 2;
    await enqueue("test/flaky");
    expect(await flushJobs()).toEqual({ ran: 1, failed: [] });
    expect((await runs("test.flaky"))[0]).toMatchObject({ status: "succeeded", attempt: 3 });

    failuresLeft = 10;
    await enqueue("test/flaky");
    const { failed } = await flushJobs();
    expect(failed).toEqual([{ job: "test.flaky", error: "temporary wobble" }]);
    expect((await runs("test.flaky"))[0]).toMatchObject({ status: "failed", attempt: 3 });
  });

  it("passes the payload as plain JSON, as Inngest would", async () => {
    await enqueue("test/echo", { n: 1, when: new Date("2026-11-16T00:00:00Z") as unknown as string });
    await flushJobs();
    expect(calls).toEqual([{ n: 1, when: "2026-11-16T00:00:00.000Z" }]);
  });

  it("an event nobody listens to does nothing", async () => {
    expect(await enqueue("test/nobody")).toEqual({ mode: "no_listener", jobs: [] });
    expect(await flushJobs()).toEqual({ ran: 0, failed: [] });
  });
});

describe("kernel jobs", () => {
  it("sessions.cleanup deletes expired sessions and verification tokens only", async () => {
    const { user } = await createParent();
    const now = new Date("2026-11-16T03:40:00Z");
    const hour = 3_600_000;
    await db.insert(session).values([
      {
        userId: user.id,
        token: "live",
        expiresAt: new Date(now.getTime() + hour),
        absoluteExpiresAt: new Date(now.getTime() + 2 * hour),
      },
      {
        userId: user.id,
        token: "expired",
        expiresAt: new Date(now.getTime() - hour),
        absoluteExpiresAt: new Date(now.getTime() + hour),
      },
      {
        userId: user.id,
        token: "past-ceiling",
        expiresAt: new Date(now.getTime() - 2 * hour),
        absoluteExpiresAt: new Date(now.getTime() - hour),
      },
    ]);
    await db.insert(verification).values([
      { identifier: "a", value: "1", expiresAt: new Date(now.getTime() - 1000) },
      { identifier: "b", value: "2", expiresAt: new Date(now.getTime() + hour) },
    ]);
    const result = await runJob("sessions.cleanup", undefined, { now });
    expect(result).toMatchObject({ status: "succeeded", summary: { sessions: 2, verifications: 1 } });
    expect((await db.select().from(session)).map((s) => s.token)).toEqual(["live"]);
    expect((await db.select().from(verification)).map((v) => v.identifier)).toEqual(["b"]);
    // Running it again finds nothing: it is idempotent.
    expect(await runJob("sessions.cleanup", undefined, { now })).toMatchObject({
      summary: { sessions: 0, verifications: 0 },
    });
  });

  it("every registered job has a schedule or an event", () => {
    for (const job of JOBS) expect(job.schedule ?? job.event, job.name).toBeTruthy();
  });
});

describe("cron fallback route", () => {
  const context = (name: string) => ({ params: Promise.resolve({ name }) });
  const request = (name: string, init: RequestInit = {}) =>
    new Request(`http://localhost:3000/api/jobs/${name}`, { method: "POST", ...init });
  const bearer = () => ({ Authorization: `Bearer ${env.CRON_SECRET}` });

  it("refuses a missing or wrong secret and runs nothing", async () => {
    for (const headers of [
      {},
      { Authorization: "Bearer wrong-secret-wrong-secret" },
      { Authorization: env.CRON_SECRET },
    ] as Record<string, string>[]) {
      const response = await jobPOST(request("test.echo", { headers }), context("test.echo"));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
    expect(calls).toEqual([]);
    expect(await runs()).toHaveLength(0);
  });

  it("runs a job by name with the right secret, by POST or GET", async () => {
    const response = await jobPOST(
      request("test.echo", {
        headers: bearer(),
        body: JSON.stringify({ payload: { n: 4 }, idempotencyKey: "k1" }),
      }),
      context("test.echo"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: "test.echo", status: "succeeded", summary: { n: 4 } });

    const repeat = await jobPOST(
      request("test.echo", {
        headers: bearer(),
        body: JSON.stringify({ payload: { n: 4 }, idempotencyKey: "k1" }),
      }),
      context("test.echo"),
    );
    expect(await repeat.json()).toMatchObject({ status: "skipped" });

    const viaGet = await jobGET(
      new Request("http://localhost:3000/api/jobs/ratelimit.cleanup", { headers: bearer() }),
      context("ratelimit.cleanup"),
    );
    expect(viaGet.status).toBe(200);
    expect(await viaGet.json()).toMatchObject({ job: "ratelimit.cleanup", status: "succeeded" });
  });

  it("two calls in the same minute with no key do the work once", async () => {
    const a = await jobPOST(request("test.echo", { headers: bearer() }), context("test.echo"));
    const b = await jobPOST(request("test.echo", { headers: bearer() }), context("test.echo"));
    const statuses = [(await a.json()).status, (await b.json()).status].sort();
    // (If the minute ticks over between the two calls, both run: that is still correct.)
    expect(["skipped,succeeded", "succeeded,succeeded"]).toContain(statuses.join(","));
  });

  it("answers 404 for an unknown job, 422 for a bad body and 500 when the job fails", async () => {
    expect(
      (await jobPOST(request("no.such_job", { headers: bearer() }), context("no.such_job"))).status,
    ).toBe(404);
    expect(
      (await jobPOST(request("test.echo", { headers: bearer(), body: "not json" }), context("test.echo")))
        .status,
    ).toBe(422);
    failuresLeft = 1;
    const failed = await jobPOST(request("test.flaky", { headers: bearer() }), context("test.flaky"));
    expect(failed.status).toBe(500);
    // The error text is for the job_run row, not for whoever called the route.
    expect(JSON.stringify(await failed.json())).not.toContain("temporary wobble");
  });
});

describe("other routes", () => {
  it("health says ok with the database up, and gives nothing else away", async () => {
    const response = await healthGET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["db", "status", "time"]);
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect(Number.isNaN(Date.parse(String(body.time)))).toBe(false);
    const text = JSON.stringify(body);
    for (const secret of [env.BETTER_AUTH_SECRET, env.CRON_SECRET, env.DATABASE_URL, "version", "node"])
      expect(text).not.toContain(secret);
  });

  it("the Inngest endpoint is closed when Inngest is not configured", async () => {
    const response = await inngestGET(new Request("http://localhost:3000/api/inngest") as never, {});
    expect(response.status).toBe(404);
  });
});
