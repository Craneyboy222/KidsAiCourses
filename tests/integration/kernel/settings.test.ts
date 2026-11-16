import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/env";
import { systemCtx } from "@/server/context";
import {
  aiProcessor,
  auditLog,
  course,
  courseTool,
  courseVersion,
  page,
  pageVersion,
  siteSetting,
  tool,
} from "@/server/db";
import { getSetting, listSettings, registerSettingGuard, setSetting } from "@/server/settings";
import {
  REQUIRED_LEGAL_SLUGS,
  clearLaunchItem,
  computeLaunchReadiness,
  confirmLaunchItem,
  getLaunchReadiness,
  isSignupOpen,
  markLaunchReadyForDev,
} from "@/server/settings/launch-readiness";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createParent, createStaff } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
afterAll(async () => {
  await closeDb();
});

async function owner() {
  return testCtx((await createStaff({ roles: ["super_admin"] })).actor);
}
async function admin() {
  return testCtx((await createStaff({ roles: ["admin"] })).actor);
}

async function publishLegalPage(slug: string) {
  const [p] = await db.insert(page).values({ slug, kind: "legal", title: slug }).returning();
  if (!p) throw new Error("no page");
  const [v] = await db
    .insert(pageVersion)
    .values({
      pageId: p.id,
      version: 1,
      title: slug,
      body: "Text",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  await db.update(page).set({ currentVersionId: v?.id }).where(eq(page.id, p.id));
  return p;
}

const MANUAL = [
  "crisis_scripts_approved",
  "age_assurance_confirmed",
  "dpia_signed_off",
  "osa_assessed",
] as const;

/** Does by hand what an owner would do in Studio, through the real services. */
async function makeReady(ctx: Awaited<ReturnType<typeof owner>>) {
  await setSetting(ctx, "safeguarding.dsl_name", "Chris Owner");
  for (const slug of REQUIRED_LEGAL_SLUGS) await publishLegalPage(slug);
  for (const key of MANUAL) await confirmLaunchItem(ctx, key, "Signed off by counsel, ref LEG-12");
}

describe("setSetting", () => {
  it("saves, reads back and audits a change with who, what and the before and after", async () => {
    const ctx = await admin();
    expect(await getSetting(ctx, "moderation.sample_rate")).toBe(0.1);
    await setSetting(ctx, "moderation.sample_rate", 0.25, "Busier week");
    expect(await getSetting(ctx, "moderation.sample_rate")).toBe(0.25);

    const logs = await db.select().from(auditLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "setting.update",
      actorType: "staff",
      actorId: ctx.actor.userId,
      targetType: "site_setting",
      targetId: "moderation.sample_rate",
      reason: "Busier week",
      meta: { from: 0.1, to: 0.25 },
      requestId: ctx.requestId,
    });
  });

  it("refuses an invalid value and writes nothing", async () => {
    const ctx = await admin();
    await expect(setSetting(ctx, "moderation.sample_rate", 3)).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(await db.select().from(siteSetting)).toHaveLength(0);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("is for admins: parents, editors and signed-out visitors are refused", async () => {
    const parent = testCtx((await createParent()).actor);
    await expect(setSetting(parent, "coach.enabled", false)).rejects.toMatchObject({ code: "forbidden" });
    const editor = testCtx((await createStaff({ roles: ["editor"] })).actor);
    await expect(setSetting(editor, "coach.enabled", false)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setSetting(testCtx(), "coach.enabled", false)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("keeps owner-only settings for the owner", async () => {
    await expect(setSetting(await admin(), "safeguarding.dsl_name", "Someone")).rejects.toMatchObject({
      code: "forbidden",
    });
    await setSetting(await owner(), "safeguarding.dsl_name", "Chris Owner");
    expect(await getSetting({ db }, "safeguarding.dsl_name")).toBe("Chris Owner");
  });

  it("can clear a nullable setting back to none (regression: null was written as SQL NULL and refused)", async () => {
    const ctx = await admin();
    await setSetting(ctx, "site.maintenance_message", "Back at 3pm");
    await setSetting(ctx, "site.maintenance_message", null);
    expect(await getSetting(ctx, "site.maintenance_message")).toBeNull();
    const [row] = await db.select().from(siteSetting).where(eq(siteSetting.key, "site.maintenance_message"));
    expect(row).toBeDefined();
    expect(row?.value).toBeNull();
    const all = await listSettings(ctx);
    expect(all.find((s) => s.key === "site.maintenance_message")).toMatchObject({ value: null, isSet: true });
  });

  it("still runs guards registered by other modules", async () => {
    const ctx = await admin();
    const seen: unknown[] = [];
    registerSettingGuard("site.maintenance_message", async (_ctx, value) => {
      seen.push(value);
    });
    await setSetting(ctx, "site.maintenance_message", "Back at 3pm");
    expect(seen).toEqual(["Back at 3pm"]);
  });
});

describe("listSettings", () => {
  it("returns every registry entry with value, default, group, label, help and flags", async () => {
    const ctx = await admin();
    await setSetting(ctx, "moderation.sample_rate", 0.5);
    const all = await listSettings(ctx);
    expect(all.length).toBeGreaterThan(30);
    expect(all.find((s) => s.key === "moderation.sample_rate")).toMatchObject({
      group: "moderation",
      label: "Human review sample",
      value: 0.5,
      defaultValue: 0.1,
      isSet: true,
      ownerOnly: false,
      legal: false,
      updatedBy: ctx.actor.userId,
    });
    expect(all.find((s) => s.key === "safeguarding.dsl_name")).toMatchObject({
      value: null,
      defaultValue: null,
      isSet: false,
      ownerOnly: true,
      legal: true,
      updatedAt: null,
    });
    expect(all.find((s) => s.key === "site.default_quiet_hours")?.value).toEqual({
      start: "21:00",
      end: "07:00",
    });
    for (const s of all) expect(typeof s.help).toBe("string");
  });

  it("falls back to the default when a stored value no longer fits the schema", async () => {
    await db.insert(siteSetting).values({ key: "moderation.sample_rate", value: "lots" });
    const all = await listSettings(await admin());
    expect(all.find((s) => s.key === "moderation.sample_rate")).toMatchObject({ value: 0.1, isSet: false });
  });

  it("is not for learners, parents or the public", async () => {
    await expect(listSettings(testCtx((await createParent()).actor))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listSettings(testCtx())).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("launch readiness gate", () => {
  it("blocks opening sign-up until every item is satisfied, and lists what is outstanding", async () => {
    const ctx = await owner();
    const attempt = setSetting(ctx, "site.signup_open", true);
    await expect(attempt).rejects.toMatchObject({ code: "not_ready", status: 409 });
    await expect(setSetting(ctx, "site.signup_open", true)).rejects.toThrow(/Designated Safeguarding Lead/);
    await expect(setSetting(ctx, "site.signup_open", true)).rejects.toThrow(/crisis scripts/);
    expect(await getSetting(ctx, "site.signup_open")).toBe(false);
    expect(await isSignupOpen(ctx)).toBe(false);

    // Do everything but one item: still blocked, and the message now names only that item.
    await makeReady(ctx);
    await clearLaunchItem(ctx, "osa_assessed", "Assessment needs redoing");
    const error = await setSetting(ctx, "site.signup_open", true).catch(
      (e: unknown) => e as { message: string; detail: unknown },
    );
    expect(error).toMatchObject({ code: "not_ready", detail: { outstanding: ["osa_assessed"] } });
    expect((error as { message: string }).message).toContain("Online Safety Act");
    expect((error as { message: string }).message).not.toContain("Designated Safeguarding Lead");

    await confirmLaunchItem(ctx, "osa_assessed", "Redone and filed");
    await setSetting(ctx, "site.signup_open", true);
    expect(await getSetting(ctx, "site.signup_open")).toBe(true);
    expect(await isSignupOpen(testCtx())).toBe(true);
  });

  it("always allows closing sign-up", async () => {
    await setSetting(await admin(), "site.signup_open", false);
    expect(await isSignupOpen({ db })).toBe(false);
  });

  it("closes sign-up by itself when a condition later fails, and reopens when it is fixed", async () => {
    const ctx = await owner();
    await makeReady(ctx);
    await setSetting(ctx, "site.signup_open", true);
    expect(await isSignupOpen(ctx)).toBe(true);

    // A legal page is unpublished.
    const [terms] = await db.select().from(page).where(eq(page.slug, "terms"));
    await db
      .update(page)
      .set({ currentVersionId: null })
      .where(eq(page.id, terms?.id ?? ""));
    expect(await isSignupOpen(ctx)).toBe(false);
    expect(await getSetting(ctx, "site.signup_open")).toBe(true); // the switch was not touched
    await db
      .update(pageVersion)
      .set({ status: "published" })
      .where(eq(pageVersion.pageId, terms?.id ?? ""));
    const [version] = await db
      .select()
      .from(pageVersion)
      .where(eq(pageVersion.pageId, terms?.id ?? ""));
    await db
      .update(page)
      .set({ currentVersionId: version?.id })
      .where(eq(page.id, terms?.id ?? ""));
    expect(await isSignupOpen(ctx)).toBe(true);

    // The owner withdraws a confirmation.
    await clearLaunchItem(ctx, "dpia_signed_off", "Retention periods changed");
    expect(await isSignupOpen(ctx)).toBe(false);
    await confirmLaunchItem(ctx, "dpia_signed_off", "Re-signed");
    expect(await isSignupOpen(ctx)).toBe(true);

    // The DSL's name is removed.
    await setSetting(ctx, "safeguarding.dsl_name", null);
    expect(await isSignupOpen(ctx)).toBe(false);
  });

  it("a published course using an unverified tool fails tools_verified", async () => {
    const ctx = await owner();
    await makeReady(ctx);
    expect((await computeLaunchReadiness(ctx)).ready).toBe(true);

    const [aTool] = await db
      .insert(tool)
      .values({ slug: "shinytool", name: "Shiny Tool", status: "pending_verification" })
      .returning();
    const [aCourse] = await db
      .insert(course)
      .values({ slug: "c1", title: "Course one", status: "published" })
      .returning();
    const [version] = await db
      .insert(courseVersion)
      .values({
        courseId: aCourse?.id ?? "",
        revision: 1,
        semver: "1.0.0",
        status: "published",
        snapshot: {} as never,
        origin: "hand_made",
      } as typeof courseVersion.$inferInsert)
      .returning();
    await db
      .insert(courseTool)
      .values({
        courseVersionId: version?.id ?? "",
        courseId: aCourse?.id ?? "",
        toolId: aTool?.id ?? "",
        purpose: "Build",
        required: true,
        position: 0,
      });

    // Not counted until the course points at that version as its published one.
    expect((await computeLaunchReadiness(ctx)).ready).toBe(true);
    await db
      .update(course)
      .set({ publishedVersionId: version?.id })
      .where(eq(course.id, aCourse?.id ?? ""));
    const readiness = await computeLaunchReadiness(ctx);
    expect(readiness.outstanding.map((i) => i.key)).toEqual(["tools_verified"]);
    expect(readiness.outstanding[0]?.detail).toContain("shinytool");
    await expect(setSetting(ctx, "site.signup_open", true)).rejects.toMatchObject({ code: "not_ready" });

    // A policy alone is not enough: the tool must also be approved.
    await db
      .update(tool)
      .set({ under18Policy: "parent_consent_required" })
      .where(eq(tool.id, aTool?.id ?? ""));
    expect((await computeLaunchReadiness(ctx)).ready).toBe(false);
    // (The database itself refuses an approved tool with no under-18 policy.)
    await db
      .update(tool)
      .set({ status: "approved" })
      .where(eq(tool.id, aTool?.id ?? ""));
    expect((await computeLaunchReadiness(ctx)).ready).toBe(true);
  });

  it("an enabled processor is fine only with approval and a DPA (the database agrees)", async () => {
    const ctx = await owner();
    await makeReady(ctx);
    await db
      .insert(aiProcessor)
      .values({
        providerKey: "acme",
        name: "Acme",
        purpose: "Coach",
        enabled: true,
        approvedAt: new Date(),
        dpaReference: "DPA-7",
        approvedBy: ctx.actor.userId,
      });
    expect((await computeLaunchReadiness(ctx)).ready).toBe(true);
    await expect(
      db.insert(aiProcessor).values({ providerKey: "rogue", name: "Rogue", purpose: "Coach", enabled: true }),
    ).rejects.toThrow();
  });

  it("live AI with no approved provider fails processors_approved", async () => {
    const ctx = await owner();
    await makeReady(ctx);
    vi.stubEnv("AI_PROVIDER_MODE", "gateway");
    resetEnvCache();
    const readiness = await computeLaunchReadiness(ctx);
    expect(readiness.outstanding.map((i) => i.key)).toEqual(["processors_approved"]);
  });

  it("getLaunchReadiness returns each item with key, label, auto, satisfied and detail, for staff only", async () => {
    const ctx = await owner();
    await confirmLaunchItem(ctx, "crisis_scripts_approved", "Approved by the DSL on 14 November 2026");
    const items = await getLaunchReadiness(ctx);
    expect(items).toHaveLength(8);
    expect(items.find((i) => i.key === "crisis_scripts_approved")).toMatchObject({
      auto: false,
      satisfied: true,
      confirmedBy: ctx.actor.userId,
      confirmedAt: ctx.now.toISOString(),
      detail: "Approved by the DSL on 14 November 2026",
    });
    expect(items.find((i) => i.key === "dsl_named")).toMatchObject({ auto: true, satisfied: false });
    await expect(getLaunchReadiness(testCtx((await createParent()).actor))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getLaunchReadiness(testCtx())).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("confirmLaunchItem and clearLaunchItem", () => {
  it("are for the owner only: an admin, a job and a parent are refused", async () => {
    await expect(confirmLaunchItem(await admin(), "osa_assessed", "Done")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(confirmLaunchItem(systemCtx("some.job"), "osa_assessed", "Done")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      confirmLaunchItem(testCtx((await createParent()).actor), "osa_assessed", "Done"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(clearLaunchItem(await admin(), "osa_assessed", "Why not")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await getSetting({ db }, "launch.readiness")).toEqual({});
  });

  it("are audited, with the note and the reason", async () => {
    const ctx = await owner();
    await confirmLaunchItem(ctx, "age_assurance_confirmed", "Counsel confirmed card check, ref LEG-9");
    await clearLaunchItem(ctx, "age_assurance_confirmed", "Method changing to subscription");
    const logs = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    expect(logs.map((l) => l.action)).toEqual(["launch_readiness.confirm", "launch_readiness.clear"]);
    expect(logs[0]).toMatchObject({
      actorId: ctx.actor.userId,
      targetId: "age_assurance_confirmed",
      meta: { note: "Counsel confirmed card check, ref LEG-9" },
    });
    expect(logs[1]).toMatchObject({
      targetId: "age_assurance_confirmed",
      reason: "Method changing to subscription",
    });
    expect(await getSetting(ctx, "launch.readiness")).toEqual({});
  });

  it("cannot confirm an automatic item, an unknown item, or anything without a note", async () => {
    const ctx = await owner();
    await expect(confirmLaunchItem(ctx, "dsl_named", "I promise")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(confirmLaunchItem(ctx, "made_up" as never, "Done")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(confirmLaunchItem(ctx, "osa_assessed", " ")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(clearLaunchItem(ctx, "osa_assessed", "")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("two confirmations at the same moment both survive", async () => {
    const ctx = await owner();
    await Promise.all(MANUAL.map((key) => confirmLaunchItem(ctx, key, `Confirmed ${key}`)));
    expect(Object.keys(await getSetting(ctx, "launch.readiness")).sort()).toEqual([...MANUAL].sort());
  });
});

describe("other setting guards", () => {
  it("deputy escalation needs a named deputy, and the deputy cannot be removed while it is on", async () => {
    const ctx = await owner();
    await expect(setSetting(ctx, "safeguarding.deputy_escalation_enabled", true)).rejects.toMatchObject({
      code: "not_ready",
    });
    await setSetting(ctx, "safeguarding.deputy_name", "  ");
    await expect(setSetting(ctx, "safeguarding.deputy_escalation_enabled", true)).rejects.toMatchObject({
      code: "not_ready",
    });
    await setSetting(ctx, "safeguarding.deputy_name", "Dana Deputy");
    await setSetting(ctx, "safeguarding.deputy_escalation_enabled", true);
    expect(await getSetting(ctx, "safeguarding.deputy_escalation_enabled")).toBe(true);
    await expect(setSetting(ctx, "safeguarding.deputy_name", null)).rejects.toMatchObject({
      code: "conflict",
    });
    await setSetting(ctx, "safeguarding.deputy_escalation_enabled", false);
    await setSetting(ctx, "safeguarding.deputy_name", null);
  });

  it("Radar score weights must add up to 100", async () => {
    const ctx = await admin();
    const weights = {
      teenRelevance: 25,
      usefulness: 20,
      momentum: 15,
      accessibility: 15,
      safetyAndAgeFit: 15,
      longevity: 10,
    };
    await expect(setSetting(ctx, "radar.score_weights", { ...weights, longevity: 20 })).rejects.toThrow(
      /add up to 100.*110/,
    );
    await expect(
      setSetting(ctx, "radar.score_weights", { ...weights, teenRelevance: 135, longevity: -100 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await setSetting(ctx, "radar.score_weights", { ...weights, teenRelevance: 30, longevity: 5 });
    expect((await getSetting(ctx, "radar.score_weights")).teenRelevance).toBe(30);
  });
});

describe("markLaunchReadyForDev", () => {
  it("satisfies the checklist in tests, so sign-up opens through the real gate", async () => {
    const seed = systemCtx("seed");
    const readiness = await markLaunchReadyForDev(seed);
    expect(readiness.ready).toBe(true);
    await setSetting(seed, "site.signup_open", true);
    expect(await isSignupOpen(testCtx())).toBe(true);

    // It is plainly labelled as a placeholder, and audited.
    expect(await getSetting(seed, "safeguarding.dsl_name")).toMatch(/placeholder/i);
    const confirmations = await getSetting(seed, "launch.readiness");
    expect(confirmations.dpia_signed_off).toMatchObject({ confirmedBy: "dev-seed" });
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "launch_readiness.dev_override"));
    expect(logs).toHaveLength(1);

    // Running it twice changes nothing and creates no duplicate pages.
    await markLaunchReadyForDev(seed);
    expect(await db.select().from(page)).toHaveLength(REQUIRED_LEGAL_SLUGS.length);
  });

  it("keeps real values that are already there", async () => {
    const ctx = await owner();
    await setSetting(ctx, "safeguarding.dsl_name", "Chris Owner");
    await confirmLaunchItem(ctx, "osa_assessed", "Real sign-off");
    await publishLegalPage("terms");
    await markLaunchReadyForDev(systemCtx("seed"));
    expect(await getSetting(ctx, "safeguarding.dsl_name")).toBe("Chris Owner");
    expect((await getSetting(ctx, "launch.readiness")).osa_assessed).toMatchObject({
      confirmedBy: ctx.actor.userId,
      note: "Real sign-off",
    });
    expect(await db.select().from(pageVersion)).toHaveLength(REQUIRED_LEGAL_SLUGS.length);
  });

  it.each(["production", "preview"])("refuses to run when APP_ENV is %s", async (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    vi.stubEnv("STAFF_2FA_REQUIRED", "true");
    vi.stubEnv("SEED_PASSWORD", undefined);
    vi.stubEnv("STRIPE_DRIVER", "stripe");
    vi.stubEnv("RADAR_FIXTURES", "false");
    resetEnvCache();
    await expect(markLaunchReadyForDev(systemCtx("seed"))).rejects.toMatchObject({ code: "forbidden" });
    expect(await db.select().from(siteSetting)).toHaveLength(0);
    expect(await db.select().from(page)).toHaveLength(0);
  });
});
