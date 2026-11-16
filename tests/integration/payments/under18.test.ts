import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LearnerActor } from "@/server/authz/actor";
import { family, familyMember, user } from "@/server/db/schema";
import { getBillingOverview, openBillingPortal, previewCheckout, resolveBillingAccount, startCardCheck, startCheckout } from "@/server/services/billing";
import { getEntitlementForLearner } from "@/server/services/entitlements";
import { canSeePrices, listPublicPlans } from "@/server/services/plans";
import { requestUnlock } from "@/server/services/unlock-requests";
import { setSetting } from "@/server/settings";
import { completeFakeCheckout } from "@/server/stripe/fake-simulator";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";
import { T0, createCourse, entitlementAt, familyRow, setUpBilling, subscribe, subscriptionRows } from "./helpers";

beforeEach(setUpBilling);
afterAll(closeDb);

/** Anything that would show money to the reader: a currency sign, or a field that carries an amount. */
const MONEY = /£|pence|price|amount|invoice|checkout|promo|coupon|stripe/i;

/** An 18-year-old with their own account: they own a family of one, and have a real, verified email address. */
async function createAdultOwner(): Promise<{ actor: LearnerActor; familyId: string }> {
  const { user: learner, actor } = await createLearner({ age: 18, familyId: null, now: T0 });
  await db.update(user).set({ email: `adult-${learner.id.slice(0, 8)}@example.test`, emailVerified: true }).where(eq(user.id, learner.id));
  const [fam] = await db.insert(family).values({ ownerUserId: learner.id }).returning();
  if (!fam) throw new Error("no family");
  await db.insert(familyMember).values({ familyId: fam.id, userId: learner.id, role: "learner" });
  return { actor: { ...actor, familyId: fam.id }, familyId: fam.id };
}

describe("under-18s never see prices, checkout, invoices or promo entry", () => {
  it.each([13, 15, 16, 17])("a %i-year-old is refused by every billing function, with a message that mentions no money", async (age) => {
    const { family: fam } = await createFamily();
    const { actor } = await createLearner({ age, familyId: fam.id, now: T0 });
    const ctx = testCtx(actor, { now: T0 });

    const attempts = [
      () => resolveBillingAccount(ctx),
      () => getBillingOverview(ctx),
      () => previewCheckout(ctx, { planKey: "family", interval: "month" }),
      () => previewCheckout(ctx, { planKey: "family", interval: "month", promoCode: "ANYTHING" }),
      () => startCheckout(ctx, { planKey: "family", interval: "month" }),
      () => startCardCheck(ctx),
      () => openBillingPortal(ctx),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: "forbidden" });
      expect((error as Error).message).not.toMatch(MONEY);
    }
    // Nothing was created at Stripe for them either.
    expect((await familyRow(fam.id))?.stripeCustomerId).toBeNull();
    expect(canSeePrices(actor)).toBe(false);
  });

  it("the plans list has no prices for a learner under 18, and has them for a parent and a visitor", async () => {
    const { family: fam, parentActor } = await createFamily();
    const { actor: teen } = await createLearner({ age: 15, familyId: fam.id, now: T0 });

    const forTeen = await listPublicPlans(testCtx(teen, { now: T0 }));
    expect(forTeen.map((p) => p.key)).toEqual(["free", "family"]);
    expect(forTeen.every((p) => p.pricing === null)).toBe(true);
    expect(JSON.stringify(forTeen)).not.toMatch(/\d{3,}|£|pence/i);

    const forParent = await listPublicPlans(testCtx(parentActor, { now: T0 }));
    expect(forParent.find((p) => p.key === "family")?.pricing?.monthlyPence).toBeGreaterThan(0);
    const forVisitor = await listPublicPlans(testCtx(undefined, { now: T0 }));
    expect(forVisitor.find((p) => p.key === "family")?.pricing).not.toBeNull();
  });

  it("what a learner is given about their plan carries no money: the entitlement and an unlock request", async () => {
    const { family: fam } = await createFamily();
    const { user: learner, actor } = await createLearner({ age: 14, familyId: fam.id, now: T0 });
    const paid = await createCourse();
    const ctx = testCtx(actor, { now: T0 });

    const entitlement = await getEntitlementForLearner(ctx, learner.id);
    expect(Object.keys(entitlement).sort()).toEqual(["coachCreditsPerLearnerPerMonth", "fullCatalogue", "periodKey", "planKey", "seats", "status"]);
    expect(JSON.stringify(entitlement)).not.toMatch(MONEY);

    const request = await requestUnlock(ctx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });
    expect(Object.keys(request).sort()).toEqual(["courseId", "courseTitle", "createdAt", "id", "kind", "learnerId", "learnerNickname", "status"]);
    expect(JSON.stringify({ ...request, kind: undefined })).not.toMatch(MONEY);

    await subscribe(fam.id);
    expect(JSON.stringify(await getEntitlementForLearner(ctx, learner.id))).not.toMatch(MONEY);
  });

  it("signed-out visitors and staff cannot reach a family's billing", async () => {
    const { actor: admin } = await createStaff({ roles: ["admin"] });
    await expect(getBillingOverview(testCtx(undefined, { now: T0 }))).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(startCheckout(testCtx(admin, { now: T0 }), { planKey: "family", interval: "month" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("an 18-year-old who owns their own account", () => {
  it("sees prices and can pay for themselves: Family, one seat", async () => {
    const { actor, familyId } = await createAdultOwner();
    const ctx = testCtx(actor, { now: T0 });
    expect(canSeePrices(actor)).toBe(true);

    const overview = await getBillingOverview(ctx);
    expect(overview.account).toMatchObject({ kind: "adult_learner", homePath: "/settings/billing" });
    expect(overview.plan.key).toBe("free");
    expect(overview.seats.total).toBe(1);
    expect(overview.offers[0]?.options.map((o) => o.interval)).toEqual(["month", "year"]);
    expect(overview.offers[0]?.options[0]?.pricePence).toBeGreaterThan(0);

    const { url } = await startCheckout(ctx, { planKey: "family", interval: "year" });
    const { returnPath } = await completeFakeCheckout(decodeURIComponent(url.split("session=")[1] ?? ""), T0);
    expect(returnPath).toBe("/settings/billing?checkout=success");
    expect(await entitlementAt(familyId)).toMatchObject({ planKey: "family", fullCatalogue: true, seats: 1, status: "trialing" });
    expect((await subscriptionRows(familyId))[0]?.interval).toBe("year");
    expect((await openBillingPortal(ctx)).url).toMatch(/^\/dev\/fake-stripe\/portal\?session=/);
  });

  it("cannot manage a plan that belongs to their parent's family", async () => {
    const { family: fam } = await createFamily();
    const { actor } = await createLearner({ age: 18, familyId: fam.id, now: T0 });
    await expect(getBillingOverview(testCtx(actor, { now: T0 }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(startCheckout(testCtx(actor, { now: T0 }), { planKey: "family", interval: "month" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("is refused when the owner has switched self-serve off", async () => {
    const { actor } = await createAdultOwner();
    const { actor: admin } = await createStaff({ roles: ["admin"] });
    await setSetting(testCtx(admin), "site.adult_self_serve", false);
    await expect(startCheckout(testCtx(actor, { now: T0 }), { planKey: "family", interval: "month" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("someone who says they are 18 but whose stored band is younger is treated as under 18", async () => {
    const { actor, familyId } = await createAdultOwner();
    const stale: LearnerActor = { ...actor, safetyBand: "teen_16_17" };
    await expect(getBillingOverview(testCtx(stale, { now: T0 }))).rejects.toMatchObject({ code: "forbidden" });
    expect(canSeePrices(stale)).toBe(false);
    expect((await familyRow(familyId))?.stripeCustomerId).toBeNull();
  });
});
