import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemCtx } from "@/server/context";
import { auditLog, consentDefinition, consentRecord, notification, parentControl, user } from "@/server/db/schema";
import {
  CONSENT_HOLD,
  getConsentCentre,
  hasConsent,
  listConsentDefinitions,
  missingRequiredConsents,
  saveConsents,
  upsertConsentDefinitions,
} from "@/server/services/consent";
import { readConsentFiles } from "../../../scripts/import-consents";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createLearner, createParent, createParentControl, createStaff } from "../../helpers/factories";
import { NOW, REQUIRED_TICKED, addSession, daysFrom, expectNoPlaceholderEmail, freshAccountsDb, mockedEntitlement, sessionCount, userRow } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

/** A parent and a child whose account is waiting for consent, as `addChild` leaves it. */
async function familyWithHeldChild(age = 14) {
  const { actor: parent, family } = await createParent();
  const { user: child } = await createLearner({ age, familyId: family.id, status: "paused", now: NOW });
  await db.update(user).set({ statusReason: CONSENT_HOLD.required }).where(eq(user.id, child.id));
  return { parent, family, childId: child.id, ctx: testCtx(parent, { now: NOW, ip: "203.0.113.9" }) };
}

/** The same, with every required consent given, so the account is active. */
async function familyWithActiveChild(age = 14) {
  const setup = await familyWithHeldChild(age);
  await saveConsents(setup.ctx, setup.childId, { choices: REQUIRED_TICKED });
  return setup;
}

async function publishNewVersion(key: string, version = 2) {
  const current = readConsentFiles().find((d) => d.key === key);
  if (!current) throw new Error(`no consent ${key}`);
  return upsertConsentDefinitions(systemCtx("consents.import"), [{ ...current, version, body: `${current.body}\n\nUpdated wording for version ${version}.` }]);
}

describe("the consent centre", () => {
  it("lists three required and two optional consents in order, with plain-English copy and nothing pre-selected", async () => {
    const { ctx, childId } = await familyWithHeldChild(14);
    const centre = await getConsentCentre(ctx, childId);
    expect(centre.items.map((i) => [i.key, i.required])).toEqual([
      ["account_learning_data", true],
      ["ai_processing", true],
      ["third_party_tools", true],
      ["tutor_history_retention", false],
      ["product_improvement_analytics", false],
    ]);
    for (const item of centre.items) {
      expect(item).toMatchObject({ granted: false, needsReconsent: false, defaultOn: false, decidedAt: null, version: 1 });
      expect(item.body.length).toBeGreaterThan(100);
    }
    expect(centre).toMatchObject({ learnerId: childId, complete: false, missingRequired: ["account_learning_data", "ai_processing", "third_party_tools"] });
    expectNoPlaceholderEmail(centre);
  });

  it("starts both optional consents off for a 13 to 15-year-old", async () => {
    const { ctx, childId } = await familyWithHeldChild(13);
    const optional = (await getConsentCentre(ctx, childId)).items.filter((i) => !i.required);
    expect(optional.map((i) => i.defaultOn)).toEqual([false, false]);
  });

  it("uses the band default for an optional consent, and never for a required one", async () => {
    const { ctx, childId } = await familyWithHeldChild(16);
    await db.update(consentDefinition).set({ defaultByBand: { teen_13_15: false, teen_16_17: true, adult_18: true } });
    const centre = await getConsentCentre(ctx, childId);
    expect(centre.items.filter((i) => i.required).every((i) => i.defaultOn === false)).toBe(true);
    expect(centre.items.filter((i) => !i.required).every((i) => i.defaultOn === true)).toBe(true);
    // A default is only where the switch starts: nothing counts as given until the parent saves it.
    expect(await hasConsent(ctx, childId, "tutor_history_retention")).toBe(false);
  });
});

describe("granting", () => {
  it("appends a record for each consent with who, when, how and which version, and makes the account active", async () => {
    const { ctx, parent, family, childId } = await familyWithHeldChild();
    const result = await saveConsents(ctx, childId, { choices: { ...REQUIRED_TICKED, tutor_history_retention: true, product_improvement_analytics: false } });
    expect(result).toMatchObject({ status: "active", activated: true, paused: false, missingRequired: [] });
    expect(result.changed.map((c) => `${c.key}:${c.action}:${c.version}`).sort()).toEqual([
      "account_learning_data:granted:1",
      "ai_processing:granted:1",
      "third_party_tools:granted:1",
      "tutor_history_retention:granted:1",
    ]);

    const records = await db.select().from(consentRecord);
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record).toMatchObject({ learnerId: childId, familyId: family.id, action: "granted", actorUserId: parent.userId, method: "consent_centre", consentVersion: 1, ip: "203.0.113.9", createdAt: NOW });
      expect(record.requestId).toBeTruthy();
    }
    expect(await userRow(childId)).toMatchObject({ status: "active", statusReason: null });
    expect(await hasConsent(ctx, childId, "ai_processing")).toBe(true);
    expect(await hasConsent(ctx, childId, "tutor_history_retention")).toBe(true);
    expect(await hasConsent(ctx, childId, "product_improvement_analytics")).toBe(false);
    expect(await missingRequiredConsents(ctx, childId)).toEqual([]);

    // Every change is in the audit log.
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "consent.grant"))).toHaveLength(4);
    const centre = await getConsentCentre(ctx, childId);
    expect(centre.complete).toBe(true);
    expect(centre.items.find((i) => i.key === "ai_processing")).toMatchObject({ granted: true, decidedAt: NOW });
  });

  it("saving the same choices again appends nothing", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    const again = await saveConsents(ctx, childId, { choices: REQUIRED_TICKED });
    expect(again.changed).toEqual([]);
    expect(await db.select().from(consentRecord)).toHaveLength(3);
  });

  it("never updates or deletes a record: the history only grows", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await saveConsents(testCtx(ctx.actor, { now: daysFrom(NOW, 1) }), childId, { choices: { tutor_history_retention: true } });
    await saveConsents(testCtx(ctx.actor, { now: daysFrom(NOW, 2) }), childId, { choices: { tutor_history_retention: false } });
    await saveConsents(testCtx(ctx.actor, { now: daysFrom(NOW, 3) }), childId, { choices: { tutor_history_retention: true } });
    const history = await db.select().from(consentRecord).where(eq(consentRecord.consentKey, "tutor_history_retention")).orderBy(asc(consentRecord.createdAt));
    expect(history.map((r) => r.action)).toEqual(["granted", "revoked", "granted"]);
    await expect(db.update(consentRecord).set({ action: "revoked" })).rejects.toBeDefined();
    await expect(db.delete(consentRecord)).rejects.toBeDefined();
  });
});

describe("withdrawing", () => {
  it("an optional consent can be withdrawn freely: the account carries on", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await saveConsents(ctx, childId, { choices: { product_improvement_analytics: true } });
    const result = await saveConsents(ctx, childId, { choices: { product_improvement_analytics: false } });
    expect(result).toMatchObject({ status: "active", paused: false });
    expect(await hasConsent(ctx, childId, "product_improvement_analytics")).toBe(false);
    expect(await userRow(childId)).toMatchObject({ status: "active" });
  });

  it("a required consent needs an explicit confirmation first, and nothing changes without it", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await addSession(childId);
    const attempt = saveConsents(ctx, childId, { choices: { ai_processing: false } });
    await expect(attempt).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { confirmPause: expect.any(Array) } });
    await expect(attempt).rejects.toThrow(/pauses the account and signs the learner out/);
    expect(await userRow(childId)).toMatchObject({ status: "active" });
    expect(await sessionCount(childId)).toBe(1);
    expect(await hasConsent(ctx, childId, "ai_processing")).toBe(true);
    expect(await db.select().from(consentRecord)).toHaveLength(3);
  });

  it("withdrawing a required consent pauses the learner, ends their sessions and explains why", async () => {
    const { ctx, parent, childId } = await familyWithActiveChild();
    await addSession(childId);
    await addSession(childId);

    const result = await saveConsents(ctx, childId, { choices: { ai_processing: false }, confirmPause: true });
    expect(result).toMatchObject({ status: "paused", paused: true, activated: false, missingRequired: ["ai_processing"] });
    expect(result.changed).toEqual([{ key: "ai_processing", action: "revoked", version: 1 }]);

    expect(await userRow(childId)).toMatchObject({ status: "paused", statusReason: CONSENT_HOLD.revoked });
    expect(await sessionCount(childId)).toBe(0);
    const record = (await db.select().from(consentRecord).where(eq(consentRecord.action, "revoked")))[0];
    expect(record).toMatchObject({ consentKey: "ai_processing", actorUserId: parent.userId, method: "consent_centre", consentVersion: 1 });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "consent.revoke"))).toHaveLength(1);

    // A clear explanation waits for the learner in the app.
    const notices = await db.select().from(notification).where(eq(notification.userId, childId));
    const paused = notices.find((n) => n.type === "account.paused_consent");
    expect((paused?.payload as { title: string; body: string }).title).toBe("Your account is paused");
    expect((paused?.payload as { body: string }).body).toMatch(/permissions your account needs/);
    // The parent's own session is untouched.
    expect(await userRow(parent.userId)).toMatchObject({ status: "active" });
  });

  it("giving the consent again restores the account", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await saveConsents(ctx, childId, { choices: { ai_processing: false }, confirmPause: true });
    const result = await saveConsents(testCtx(ctx.actor, { now: daysFrom(NOW, 1) }), childId, { choices: { ai_processing: true } });
    expect(result).toMatchObject({ status: "active", activated: true, missingRequired: [] });
    expect(await userRow(childId)).toMatchObject({ status: "active", statusReason: null });
    expect(await hasConsent(ctx, childId, "ai_processing")).toBe(true);
  });

  it("keeps the order of changes made in the same instant, so the last one always wins", async () => {
    // Regression: two records with the same timestamp were ordered by their random ids.
    const { ctx, childId } = await familyWithActiveChild();
    for (let round = 0; round < 6; round++) {
      await saveConsents(ctx, childId, { choices: { product_improvement_analytics: true } });
      expect(await hasConsent(ctx, childId, "product_improvement_analytics")).toBe(true);
      await saveConsents(ctx, childId, { choices: { product_improvement_analytics: false } });
      expect(await hasConsent(ctx, childId, "product_improvement_analytics")).toBe(false);
    }
    const history = await db.select().from(consentRecord).where(eq(consentRecord.consentKey, "product_improvement_analytics")).orderBy(asc(consentRecord.createdAt));
    expect(history.map((r) => r.action)).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? "granted" : "revoked")));
    expect(new Set(history.map((r) => r.createdAt.getTime())).size).toBe(12);
  });

  it("giving it again does not un-pause an account that a parent has also paused", async () => {
    const { ctx, family, childId } = await familyWithActiveChild();
    await saveConsents(ctx, childId, { choices: { third_party_tools: false }, confirmPause: true });
    await createParentControl({ learnerId: childId, familyId: family.id, paused: true, pausedReason: "Homework first" });

    const result = await saveConsents(ctx, childId, { choices: { third_party_tools: true } });
    expect(result).toMatchObject({ status: "paused", activated: false, missingRequired: [] });
    // Consent is no longer the reason; the parent's pause still holds.
    expect(await userRow(childId)).toMatchObject({ status: "paused", statusReason: null });

    // Once the parent's pause is lifted elsewhere, nothing in consent holds the account.
    await db.update(parentControl).set({ paused: false }).where(eq(parentControl.learnerId, childId));
    expect(await missingRequiredConsents(ctx, childId)).toEqual([]);
  });

  it("does not un-pause an account that was paused for another reason", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await db.update(user).set({ status: "paused", statusReason: "parent_pause" }).where(eq(user.id, childId));
    const result = await saveConsents(ctx, childId, { choices: { tutor_history_retention: true } });
    expect(result).toMatchObject({ status: "paused", activated: false });
    expect(await userRow(childId)).toMatchObject({ status: "paused", statusReason: "parent_pause" });
  });
});

describe("a new version of the wording", () => {
  it("a new version of a required consent needs consent again", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    const published = await publishNewVersion("ai_processing");
    expect(published).toMatchObject({ inserted: ["ai_processing@2"], retired: ["ai_processing@1"] });

    expect(await hasConsent(ctx, childId, "ai_processing")).toBe(false);
    expect(await missingRequiredConsents(ctx, childId)).toEqual(["ai_processing"]);
    const item = (await getConsentCentre(ctx, childId)).items.find((i) => i.key === "ai_processing");
    expect(item).toMatchObject({ version: 2, granted: false, needsReconsent: true });
    expect(item?.body).toMatch(/Updated wording for version 2/);
    // The other consents are untouched.
    expect(await hasConsent(ctx, childId, "account_learning_data")).toBe(true);

    const result = await saveConsents(ctx, childId, { choices: { ai_processing: true } });
    expect(result.changed).toEqual([{ key: "ai_processing", action: "granted", version: 2 }]);
    expect(await hasConsent(ctx, childId, "ai_processing")).toBe(true);
    expect(await missingRequiredConsents(ctx, childId)).toEqual([]);
    const versions = (await db.select().from(consentRecord).where(eq(consentRecord.consentKey, "ai_processing")).orderBy(asc(consentRecord.consentVersion))).map((r) => r.consentVersion);
    expect(versions).toEqual([1, 2]);
  });

  it("publishing new wording does not itself pause anyone, and saving something else does not either", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await addSession(childId);
    await publishNewVersion("third_party_tools");
    expect(await userRow(childId)).toMatchObject({ status: "active" });

    // Regression: saving an unrelated choice, or leaving the new wording unticked, used to pause the account with no warning.
    const unrelated = await saveConsents(ctx, childId, { choices: { tutor_history_retention: true } });
    expect(unrelated).toMatchObject({ status: "active", paused: false, missingRequired: ["third_party_tools"] });
    const unticked = await saveConsents(ctx, childId, { choices: { third_party_tools: false, account_learning_data: true } });
    expect(unticked).toMatchObject({ status: "active", paused: false, changed: [] });
    expect(await userRow(childId)).toMatchObject({ status: "active" });
    expect(await sessionCount(childId)).toBe(1);
  });

  it("a new child cannot become active on old wording", async () => {
    const { ctx, childId } = await familyWithHeldChild();
    await saveConsents(ctx, childId, { choices: { account_learning_data: true, ai_processing: true } });
    await publishNewVersion("ai_processing");
    const result = await saveConsents(ctx, childId, { choices: { third_party_tools: true } });
    expect(result).toMatchObject({ status: "paused", activated: false, missingRequired: ["ai_processing"] });
  });

  it("an optional consent given for old wording is off until it is given again", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await saveConsents(ctx, childId, { choices: { tutor_history_retention: true } });
    await publishNewVersion("tutor_history_retention");
    expect(await hasConsent(ctx, childId, "tutor_history_retention")).toBe(false);
    expect(await userRow(childId)).toMatchObject({ status: "active" });
  });

  it("published wording is never rewritten: changed words need a new version number", async () => {
    const current = readConsentFiles().find((d) => d.key === "ai_processing");
    if (!current) throw new Error("missing");
    await expect(upsertConsentDefinitions(systemCtx("consents.import"), [{ ...current, body: `${current.body} Sneaky extra sentence.` }])).rejects.toMatchObject({ code: "conflict" });
    // Importing the same files again changes nothing.
    const again = await upsertConsentDefinitions(systemCtx("consents.import"), readConsentFiles());
    expect(again).toMatchObject({ inserted: [], retired: [] });
    expect(again.unchanged).toHaveLength(5);
    expect(await listConsentDefinitions({ db })).toHaveLength(5);
  });

  it("a required consent with no published wording counts as missing", async () => {
    const { ctx, childId } = await familyWithActiveChild();
    await db.update(consentDefinition).set({ active: false }).where(eq(consentDefinition.key, "third_party_tools"));
    expect(await missingRequiredConsents(ctx, childId)).toEqual(["third_party_tools"]);
    expect(await hasConsent(ctx, childId, "third_party_tools")).toBe(false);
  });
});

describe("who may see and change consents", () => {
  it("a parent cannot read or change another family's child", async () => {
    const { childId } = await familyWithActiveChild();
    const stranger = await createParent();
    const ctx = testCtx(stranger.actor, { now: NOW });
    await expect(getConsentCentre(ctx, childId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveConsents(ctx, childId, { choices: { ai_processing: false }, confirmPause: true })).rejects.toMatchObject({ code: "forbidden" });
    expect(await userRow(childId)).toMatchObject({ status: "active" });
  });

  it("an under-18 learner cannot change their own consents, or anyone else's", async () => {
    const { family } = await familyWithActiveChild();
    const { actor, user: teen } = await createLearner({ age: 16, familyId: family.id, now: NOW });
    const { user: sibling } = await createLearner({ age: 14, familyId: family.id, now: NOW });
    const ctx = testCtx(actor, { now: NOW });
    await expect(saveConsents(ctx, teen.id, { choices: REQUIRED_TICKED })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveConsents(ctx, teen.id, { choices: REQUIRED_TICKED })).rejects.toThrow(/parent or carer looks after these choices/);
    await expect(saveConsents(ctx, sibling.id, { choices: REQUIRED_TICKED })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getConsentCentre(ctx, teen.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("an 18-year-old who runs their own account changes their own, and their parent no longer can", async () => {
    const { ctx: parentCtx, family } = await familyWithActiveChild();
    const { actor, user: adult } = await createLearner({ age: 18, familyId: family.id, now: NOW });
    await db.update(user).set({ email: "josh@example.test", emailVerified: true }).where(eq(user.id, adult.id));

    const own = await saveConsents(testCtx(actor, { now: NOW }), adult.id, { choices: REQUIRED_TICKED });
    expect(own.changed).toHaveLength(3);
    expect((await db.select().from(consentRecord).where(eq(consentRecord.learnerId, adult.id))).every((r) => r.actorUserId === adult.id)).toBe(true);

    await expect(saveConsents(parentCtx, adult.id, { choices: { tutor_history_retention: true } })).rejects.toMatchObject({ code: "forbidden" });
    // The parent can still see what stands, while the link remains.
    await expect(getConsentCentre(parentCtx, adult.id)).resolves.toMatchObject({ complete: true });
  });

  it("support staff may read a family's consents but not change them; signed-out visitors get nothing", async () => {
    const { childId } = await familyWithActiveChild();
    const support = await createStaff({ roles: ["support"] });
    await expect(getConsentCentre(testCtx(support.actor, { now: NOW }), childId)).resolves.toMatchObject({ complete: true });
    await expect(saveConsents(testCtx(support.actor, { now: NOW }), childId, { choices: { ai_processing: false }, confirmPause: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getConsentCentre(testCtx(undefined, { now: NOW }), childId)).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
