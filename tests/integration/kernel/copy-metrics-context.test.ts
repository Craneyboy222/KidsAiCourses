import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/env";
import { londonDateKey } from "@/lib/dates";
import { can } from "@/server/authz";
import { assertStaffSecondFactor, loadActor } from "@/server/context";
import { COPY_CACHE_MS, clearCopyCache, t, tMany } from "@/server/copy";
import { metricCounter, page, pageVersion } from "@/server/db";
import { incrementCounter, readCounter } from "@/server/metrics";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createLearner, createParent, createStaff } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
  clearCopyCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(async () => {
  await closeDb();
});

async function snippet(
  slug: string,
  body: string,
  options: { audience?: "everyone" | "adult" | "teen"; status?: "draft" | "published" } = {},
) {
  const [p] = await db
    .insert(page)
    .values({ slug, kind: "snippet", audience: options.audience ?? "everyone", title: slug })
    .returning();
  const [v] = await db
    .insert(pageVersion)
    .values({ pageId: p?.id ?? "", version: 1, title: slug, body, status: options.status ?? "published" })
    .returning();
  await db
    .update(page)
    .set({ currentVersionId: v?.id })
    .where(eq(page.id, p?.id ?? ""));
  return { page: p, version: v };
}

describe("copy", () => {
  it("returns the built-in wording, with variables filled in", async () => {
    expect(await t(testCtx(), "unlock.ask_parent.title")).toBe("Ask a parent to unlock");
    expect(await t(testCtx(), "controls.time_cap.body", { minutes: 45 })).toBe(
      "You've reached today's limit of 45 minutes. Your progress is saved. Come back tomorrow.",
    );
    expect(await t(testCtx(), "external.leaving.title")).toBe("You're about to leave [Platform Name]");
  });

  it("a published snippet page with the same slug overrides the default; a draft does not", async () => {
    await snippet("unlock.ask_parent.title", "Ask a grown-up to unlock this", { status: "draft" });
    expect(await t(testCtx(), "unlock.ask_parent.title")).toBe("Ask a parent to unlock");
    await db.update(pageVersion).set({ status: "published" });
    clearCopyCache();
    expect(await t(testCtx(), "unlock.ask_parent.title")).toBe("Ask a grown-up to unlock this");
  });

  it("a page of another kind with the same slug is ignored", async () => {
    const [p] = await db.insert(page).values({ slug: "ai.label", kind: "help", title: "x" }).returning();
    const [v] = await db
      .insert(pageVersion)
      .values({ pageId: p?.id ?? "", version: 1, title: "x", body: "A help page", status: "published" })
      .returning();
    await db
      .update(page)
      .set({ currentVersionId: v?.id })
      .where(eq(page.id, p?.id ?? ""));
    expect(await t(testCtx(), "ai.label")).toBe("AI-generated");
  });

  it("an override can use variables too", async () => {
    await snippet("controls.time_cap.body", "That's {{minutes}} minutes done for today on {{brandName}}.");
    expect(await t(testCtx(), "controls.time_cap.body", { minutes: 30 })).toBe(
      "That's 30 minutes done for today on [Platform Name].",
    );
  });

  it("an audience-specific snippet wins for that audience only", async () => {
    await snippet("ai.label.description", "Coach is an AI and can get things wrong.");
    await snippet("ai.label.description", "Coach is an AI. Double-check anything that matters.", {
      audience: "teen",
    });
    const teen = await createLearner({ age: 14 });
    const adult = await createLearner({ age: 18 });
    const parent = await createParent();
    expect(await t(testCtx(teen.actor), "ai.label.description")).toBe(
      "Coach is an AI. Double-check anything that matters.",
    );
    expect(await t(testCtx(adult.actor), "ai.label.description")).toBe(
      "Coach is an AI and can get things wrong.",
    );
    expect(await t(testCtx(parent.actor), "ai.label.description")).toBe(
      "Coach is an AI and can get things wrong.",
    );
    expect(await t(testCtx(), "ai.label.description")).toBe("Coach is an AI and can get things wrong.");
  });

  it("caches overrides for 30 seconds, and clearCopyCache() forgets them", async () => {
    const t0 = new Date("2026-11-16T12:00:00Z");
    const at = (ms: number) => testCtx(undefined, { now: new Date(t0.getTime() + ms) });
    expect(await t(at(0), "save.saved")).toBe("Saved");
    await snippet("save.saved", "All saved");
    expect(await t(at(COPY_CACHE_MS - 1), "save.saved")).toBe("Saved");
    expect(await t(at(COPY_CACHE_MS + 1), "save.saved")).toBe("All saved");
    await db.update(pageVersion).set({ body: "Saved just now" });
    expect(await t(at(COPY_CACHE_MS + 2), "save.saved")).toBe("All saved");
    clearCopyCache();
    expect(await t(at(COPY_CACHE_MS + 3), "save.saved")).toBe("Saved just now");
  });

  it("tMany reads several keys with one look-up", async () => {
    await snippet("save.saving", "Saving your work…");
    const copy = await tMany(testCtx(), ["save.saving", "save.saved", "save.failed"]);
    expect(copy["save.saving"]).toBe("Saving your work…");
    expect(copy["save.saved"]).toBe("Saved");
    expect(Object.keys(copy)).toHaveLength(3);
  });
});

describe("metric counters", () => {
  it("adds to today's UK-date counter, atomically", async () => {
    const ctx = testCtx(undefined, { now: new Date("2026-11-16T12:00:00Z") });
    await Promise.all(Array.from({ length: 25 }, () => incrementCounter(ctx, "signup.under13_blocked")));
    await incrementCounter(ctx, "signup.under13_blocked", 5);
    const rows = await db.select().from(metricCounter);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "signup.under13_blocked", day: "2026-11-16", count: 30 });
  });

  it("the day is the UK date, not the UTC date", async () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London.
    const ctx = testCtx(undefined, { now: new Date("2026-06-30T23:30:00Z") });
    await incrementCounter(ctx, "signup.under13_blocked");
    expect(londonDateKey(ctx.now)).toBe("2026-07-01");
    expect(
      await readCounter(ctx, "signup.under13_blocked", { from: "2026-07-01", to: "2026-07-01" }),
    ).toEqual([{ day: "2026-07-01", count: 1 }]);
    expect(
      await readCounter(ctx, "signup.under13_blocked", { from: "2026-06-01", to: "2026-06-30" }),
    ).toEqual([]);
  });

  it("stores nothing but a key, a date and a number, and refuses anything else as a key", async () => {
    const ctx = testCtx(undefined, { ip: "198.51.100.9" });
    await incrementCounter(ctx, "signup.under13_blocked");
    const [row] = await db.select().from(metricCounter);
    expect(Object.keys(row ?? {}).sort()).toEqual(["count", "createdAt", "day", "id", "key", "updatedAt"]);
    expect(JSON.stringify(row)).not.toContain("198.51.100.9");
    await expect(incrementCounter(ctx, "signup.under13_blocked:maya@example.test" as never)).rejects.toThrow(
      /unknown metric key/,
    );
    await expect(incrementCounter(ctx, "signup.under13_blocked", 0)).rejects.toThrow();
    expect(await db.select().from(metricCounter)).toHaveLength(1);
  });
});

describe("staff two-factor relaxation (local and test only)", () => {
  const session = (userId: string) => ({ userId, createdAt: new Date(), twoFactorVerified: false });

  it("with STAFF_2FA_REQUIRED=false in the test environment, staff count as verified", async () => {
    const staff = await createStaff({ roles: ["editor"] });
    const actor = await loadActor(db, session(staff.user.id), new Date());
    expect(actor).toMatchObject({ type: "staff", twoFactorVerified: true });
    expect(can(actor, "course.edit")).toBe(true);
  });

  it("with the requirement on, a password alone is not enough", async () => {
    vi.stubEnv("STAFF_2FA_REQUIRED", "true");
    resetEnvCache();
    const staff = await createStaff({ roles: ["editor"] });
    const actor = await loadActor(db, session(staff.user.id), new Date());
    expect(actor).toMatchObject({ type: "staff", twoFactorVerified: false });
    expect(can(actor, "course.edit")).toBe(false);
    if (actor.type === "staff")
      expect(() => assertStaffSecondFactor(actor)).toThrowError(
        expect.objectContaining({ code: "two_factor_required" }),
      );
  });

  it("it never makes a learner or parent into staff, or gives staff more roles", async () => {
    const parent = await createParent();
    const learner = await createLearner({ age: 14 });
    expect((await loadActor(db, session(parent.user.id), new Date())).type).toBe("parent");
    expect((await loadActor(db, session(learner.user.id), new Date())).type).toBe("learner");
    const support = await createStaff({ roles: ["support"] });
    const actor = await loadActor(db, session(support.user.id), new Date());
    expect(can(actor, "setting.manage")).toBe(false);
    expect(can(actor, "launch_readiness.manage")).toBe(false);
  });
});
