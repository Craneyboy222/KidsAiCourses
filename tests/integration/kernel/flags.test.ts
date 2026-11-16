import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, featureFlag } from "@/server/db";
import { FLAG_CACHE_MS, clearFlagCache, isEnabled, listFlags, setFlag } from "@/server/flags";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
  clearFlagCache();
});
afterAll(async () => {
  await closeDb();
});

const admin = async () => testCtx((await createStaff({ roles: ["admin"] })).actor);

describe("feature flags", () => {
  it("an unknown flag is off", async () => {
    expect(await isEnabled(testCtx(), "does.not_exist")).toBe(false);
  });

  it("setFlag creates and changes a flag, and audits both", async () => {
    const ctx = await admin();
    await setFlag(ctx, { key: "coach.voice_input", enabled: true, description: "Voice input in Coach" });
    expect(await isEnabled(testCtx(), "coach.voice_input")).toBe(true);
    await setFlag(ctx, { key: "coach.voice_input", enabled: false });
    expect(await isEnabled(testCtx(), "coach.voice_input")).toBe(false);

    const [row] = await db.select().from(featureFlag);
    expect(row).toMatchObject({
      key: "coach.voice_input",
      enabled: false,
      description: "Voice input in Coach",
      updatedBy: ctx.actor.userId,
    });
    const logs = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    expect(logs.map((l) => l.action)).toEqual(["flag.create", "flag.update"]);
    expect(logs[1]).toMatchObject({
      targetType: "feature_flag",
      targetId: "coach.voice_input",
      actorId: ctx.actor.userId,
      meta: { from: { enabled: true }, to: { enabled: false } },
    });
  });

  it("targets by the actor's safety band and family without the caller passing anything", async () => {
    const ctx = await admin();
    const { family } = await createFamily();
    const young = await createLearner({ age: 14, familyId: family.id });
    const older = await createLearner({ age: 17, familyId: family.id });
    await setFlag(ctx, {
      key: "portfolio.share_link",
      enabled: true,
      rules: { safetyBands: ["teen_16_17", "adult_18"] },
    });
    expect(await isEnabled(testCtx(older.actor), "portfolio.share_link")).toBe(true);
    expect(await isEnabled(testCtx(young.actor), "portfolio.share_link")).toBe(false);
    expect(await isEnabled(testCtx(), "portfolio.share_link")).toBe(false);

    await setFlag(ctx, { key: "beta.family", enabled: true, rules: [{ familyIds: [family.id] }] });
    expect(await isEnabled(testCtx(young.actor), "beta.family")).toBe(true);
    const other = await createLearner({ age: 14, familyId: (await createFamily()).family.id });
    expect(await isEnabled(testCtx(other.actor), "beta.family")).toBe(false);
  });

  it("targets by plan when the caller supplies it, and an explicit target overrides the actor", async () => {
    const ctx = await admin();
    await setFlag(ctx, { key: "coach.long_answers", enabled: true, rules: { plans: ["family"] } });
    expect(await isEnabled(testCtx(), "coach.long_answers", { plan: "family" })).toBe(true);
    expect(await isEnabled(testCtx(), "coach.long_answers", { plan: "free" })).toBe(false);
    expect(await isEnabled(testCtx(), "coach.long_answers")).toBe(false);

    await setFlag(ctx, { key: "band.only", enabled: true, rules: { safetyBands: ["adult_18"] } });
    const young = await createLearner({ age: 14 });
    expect(await isEnabled(testCtx(young.actor), "band.only", { safetyBand: "adult_18" })).toBe(true);
  });

  it("stores open-shaped rules as given, and a rule it does not understand switches nothing on", async () => {
    const ctx = await admin();
    await setFlag(ctx, {
      key: "future.schools",
      enabled: true,
      rules: { schoolIds: ["s-1"], plans: ["family"] },
    });
    const [row] = await db.select().from(featureFlag);
    expect(row?.rules).toEqual([{ schoolIds: ["s-1"], plans: ["family"] }]);
    expect(await isEnabled(testCtx(), "future.schools", { plan: "family" })).toBe(false);
  });

  it("refuses badly shaped known conditions and bad keys", async () => {
    const ctx = await admin();
    await expect(
      setFlag(ctx, { key: "x.y", enabled: true, rules: { percentage: 150 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      setFlag(ctx, { key: "x.y", enabled: true, rules: { safetyBands: "adult_18" as never } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setFlag(ctx, { key: "Not A Key", enabled: true })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(await db.select().from(featureFlag)).toHaveLength(0);
  });

  it("changing only enabled keeps the stored rules", async () => {
    const ctx = await admin();
    await setFlag(ctx, { key: "a.b", enabled: true, rules: { plans: ["family"] } });
    await setFlag(ctx, { key: "a.b", enabled: false });
    await setFlag(ctx, { key: "a.b", enabled: true });
    expect(await isEnabled(testCtx(), "a.b", { plan: "free" })).toBe(false);
    expect(await isEnabled(testCtx(), "a.b", { plan: "family" })).toBe(true);
  });

  it("caches for 15 seconds, and the cache can be cleared", async () => {
    const ctx = await admin();
    const t0 = new Date("2026-11-16T12:00:00Z");
    await setFlag(ctx, { key: "cached.flag", enabled: true });
    expect(await isEnabled(testCtx(undefined, { now: t0 }), "cached.flag")).toBe(true);

    // Changed behind the cache's back (another server instance, say).
    await db.update(featureFlag).set({ enabled: false }).where(eq(featureFlag.key, "cached.flag"));
    expect(
      await isEnabled(testCtx(undefined, { now: new Date(t0.getTime() + FLAG_CACHE_MS - 1) }), "cached.flag"),
    ).toBe(true);
    expect(
      await isEnabled(testCtx(undefined, { now: new Date(t0.getTime() + FLAG_CACHE_MS + 1) }), "cached.flag"),
    ).toBe(false);

    await db.update(featureFlag).set({ enabled: true }).where(eq(featureFlag.key, "cached.flag"));
    expect(
      await isEnabled(testCtx(undefined, { now: new Date(t0.getTime() + FLAG_CACHE_MS + 2) }), "cached.flag"),
    ).toBe(false);
    clearFlagCache();
    expect(
      await isEnabled(testCtx(undefined, { now: new Date(t0.getTime() + FLAG_CACHE_MS + 3) }), "cached.flag"),
    ).toBe(true);
  });

  it("managing flags is for admins", async () => {
    const editor = testCtx((await createStaff({ roles: ["editor"] })).actor);
    await expect(setFlag(editor, { key: "a.b", enabled: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listFlags(editor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setFlag(testCtx(), { key: "a.b", enabled: true })).rejects.toMatchObject({
      code: "unauthenticated",
    });

    const ctx = await admin();
    await setFlag(ctx, { key: "b.flag", enabled: true });
    await setFlag(ctx, { key: "a.flag", enabled: false, rules: { percentage: 10 } });
    expect((await listFlags(ctx)).map((f) => [f.key, f.enabled, f.rules])).toEqual([
      ["a.flag", false, [{ percentage: 10 }]],
      ["b.flag", true, []],
    ]);
  });
});
