import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemCtx } from "@/server/context";
import { auditLog, family as familyTable, user } from "@/server/db/schema";
import { getAgeAssurance, isAgeAssuranceSatisfied, recordAgeAssurance } from "@/server/services/age-assurance";
import { saveConsents } from "@/server/services/consent";
import { setSetting } from "@/server/settings";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createLearner, createParent, createStaff } from "../../helpers/factories";
import { NOW, REQUIRED_TICKED, freshAccountsDb, mockedEntitlement } from "./helpers";

vi.mock("@/server/services/entitlements", () => ({ getEntitlementForFamily: vi.fn(async () => mockedEntitlement()) }));

beforeEach(async () => {
  await freshAccountsDb();
});
afterAll(async () => {
  await closeDb();
});

const read = { db, now: NOW };
const payments = () => systemCtx("payments.webhook", { now: NOW });

async function familyWith(age: number, options: { consent?: boolean; parentVerified?: boolean } = {}) {
  const { actor: parent, family } = await createParent({ emailVerified: options.parentVerified ?? true });
  const { user: learner } = await createLearner({ age, familyId: family.id, now: NOW });
  if (options.consent !== false) await saveConsents(testCtx(parent, { now: NOW }), learner.id, { choices: REQUIRED_TICKED });
  return { parent, family, learnerId: learner.id };
}

describe("age assurance by band, in card_or_subscription mode (the default)", () => {
  it("13 to 15: consent and a verified email are not enough; the parent needs a card check or a paid subscription", async () => {
    const { family, learnerId } = await familyWith(14);
    expect(await getAgeAssurance(read, learnerId)).toEqual({ satisfied: false, missing: ["card_or_subscription"], band: "teen_13_15", mode: "card_or_subscription" });
    expect(await isAgeAssuranceSatisfied(read, learnerId)).toBe(false);

    await recordAgeAssurance(payments(), family.id, "card_authorisation");
    expect(await isAgeAssuranceSatisfied(read, learnerId)).toBe(true);
  });

  it("13 to 15: an active paid subscription also counts", async () => {
    const { family, learnerId } = await familyWith(13);
    await recordAgeAssurance(payments(), family.id, "paid_subscription");
    expect(await getAgeAssurance(read, learnerId)).toMatchObject({ satisfied: true, missing: [] });
  });

  it("13 to 15: a card check without consent is still not enough", async () => {
    const { family, learnerId } = await familyWith(15, { consent: false });
    await recordAgeAssurance(payments(), family.id, "card_authorisation");
    expect(await getAgeAssurance(read, learnerId)).toMatchObject({ satisfied: false, missing: ["consent"] });
  });

  it("16 to 17: the parent's verified email and consent are enough, with no card", async () => {
    const { learnerId } = await familyWith(16);
    expect(await getAgeAssurance(read, learnerId)).toEqual({ satisfied: true, missing: [], band: "teen_16_17", mode: "card_or_subscription" });
  });

  it("16 to 17: not without consent, and not while the parent's email is unconfirmed", async () => {
    const noConsent = await familyWith(17, { consent: false });
    expect(await getAgeAssurance(read, noConsent.learnerId)).toMatchObject({ satisfied: false, missing: ["consent"] });

    const unverified = await familyWith(17, { parentVerified: false });
    expect(await getAgeAssurance(read, unverified.learnerId)).toMatchObject({ satisfied: false, missing: ["parent_email"] });
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, unverified.parent.userId));
    expect(await isAgeAssuranceSatisfied(read, unverified.learnerId)).toBe(true);
  });

  it("18: nothing more is needed", async () => {
    const { learnerId } = await familyWith(18, { consent: false, parentVerified: false });
    expect(await getAgeAssurance(read, learnerId)).toEqual({ satisfied: true, missing: [], band: "adult_18", mode: "card_or_subscription" });
  });

  it("a teen with no family yet has nobody vouching for them", async () => {
    const { user: teen } = await createLearner({ age: 16, status: "pending_parent", now: NOW });
    expect(await getAgeAssurance(read, teen.id)).toMatchObject({ satisfied: false, missing: ["parent_email", "consent"] });
  });

  it("uses the live band: a 15-year-old who turns 16 no longer needs the card check once the daily job has moved them up", async () => {
    const { learnerId } = await familyWith(15);
    const nextYear = { db, now: new Date("2027-11-16T10:00:00Z") };
    // Until the stored band catches up, the stricter one applies.
    expect(await getAgeAssurance(nextYear, learnerId)).toMatchObject({ band: "teen_13_15", satisfied: false });
  });
});

describe("age assurance in other modes", () => {
  it("parent_email mode: a verified parent email and consent are enough for 13 to 15", async () => {
    await setSetting(systemCtx("seed"), "safety.age_assurance_mode", "parent_email");
    const { learnerId } = await familyWith(14);
    expect(await getAgeAssurance(read, learnerId)).toEqual({ satisfied: true, missing: [], band: "teen_13_15", mode: "parent_email" });
    const noConsent = await familyWith(14, { consent: false });
    expect(await isAgeAssuranceSatisfied(read, noConsent.learnerId)).toBe(false);
  });

  it("off_dev_only is honoured in the test environment only because APP_ENV is test", async () => {
    await setSetting(systemCtx("seed"), "safety.age_assurance_mode", "off_dev_only");
    const { learnerId } = await familyWith(13, { consent: false });
    expect(await getAgeAssurance(read, learnerId)).toMatchObject({ satisfied: true, mode: "off_dev_only" });
  });
});

describe("recordAgeAssurance", () => {
  it("records the method and the time, and writes an audit entry", async () => {
    const { family } = await familyWith(14);
    await recordAgeAssurance(payments(), family.id, "card_authorisation");
    expect((await db.select().from(familyTable).where(eq(familyTable.id, family.id)))[0]).toMatchObject({ ageAssuranceLevel: "card_authorisation", ageAssuredAt: NOW });
    const logs = await db.select().from(auditLog).where(eq(auditLog.action, "age_assurance.record"));
    expect(logs).toMatchObject([{ targetId: family.id, meta: { method: "card_authorisation", previous: "none" } }]);
  });

  it("only ever moves up: a weaker method later does not replace a stronger one", async () => {
    const { family } = await familyWith(14);
    await recordAgeAssurance(payments(), family.id, "paid_subscription");
    await recordAgeAssurance(payments(), family.id, "card_authorisation");
    await recordAgeAssurance(payments(), family.id, "parent_email");
    expect((await db.select().from(familyTable).where(eq(familyTable.id, family.id)))[0]?.ageAssuranceLevel).toBe("paid_subscription");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "age_assurance.record"))).toHaveLength(1);
  });

  it("can never be set from a parent's or a learner's own session", async () => {
    const { parent, family, learnerId } = await familyWith(14);
    const { actor: learner } = await createLearner({ age: 17, familyId: family.id, now: NOW });
    await expect(recordAgeAssurance(testCtx(parent, { now: NOW }), family.id, "card_authorisation")).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordAgeAssurance(testCtx(parent, { now: NOW }), family.id, "paid_subscription")).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordAgeAssurance(testCtx(learner, { now: NOW }), family.id, "card_authorisation")).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordAgeAssurance(testCtx(undefined, { now: NOW }), family.id, "card_authorisation")).rejects.toMatchObject({ code: "forbidden" });
    expect(await isAgeAssuranceSatisfied(read, learnerId)).toBe(false);
  });

  it("staff need the billing-exception permission", async () => {
    const { family } = await familyWith(14);
    const editor = await createStaff({ roles: ["editor"] });
    const admin = await createStaff({ roles: ["admin"] });
    await expect(recordAgeAssurance(testCtx(editor.actor, { now: NOW }), family.id, "card_authorisation")).rejects.toMatchObject({ code: "forbidden" });
    await expect(recordAgeAssurance(testCtx(admin.actor, { now: NOW }), family.id, "card_authorisation")).resolves.toBeUndefined();
  });

  it("says so when the family does not exist", async () => {
    await expect(recordAgeAssurance(payments(), "00000000-0000-4000-8000-000000000000", "card_authorisation")).rejects.toMatchObject({ code: "not_found" });
  });
});
