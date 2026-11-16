import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { StaffActor } from "@/server/authz/actor";
import { promoCode, promoRedemption } from "@/server/db/schema";
import { previewCheckout, startCheckout } from "@/server/services/billing";
import { getCreditBalance } from "@/server/services/credits";
import { createPromo, disablePromo, listPromos, type CreatePromoInput } from "@/server/services/promo";
import { readFakeSession } from "@/server/stripe/fake";
import { completeFakeCheckout, describeFakeCheckout } from "@/server/stripe/fake-simulator";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";
import { T0, auditRows, daysAfter, entitlementAt, setUpBilling, subscriptionRows } from "./helpers";

let admin: StaffActor;
beforeEach(async () => {
  await setUpBilling();
  admin = (await createStaff({ roles: ["admin"] })).actor;
});
afterAll(closeDb);

const make = (input: Partial<CreatePromoInput> & Pick<CreatePromoInput, "code" | "kind">) => createPromo(testCtx(admin, { now: T0 }), input as CreatePromoInput);
const sessionOf = (url: string) => decodeURIComponent(url.split("session=")[1] ?? "");
const promoRow = async (id: string) => (await db.select().from(promoCode).where(eq(promoCode.id, id)))[0];

describe("admin functions", () => {
  it("only an admin can create, list or disable a code, and each change is audited", async () => {
    const { parentActor } = await createFamily();
    const { actor: support } = await createStaff({ roles: ["support"] });
    const input: CreatePromoInput = { code: "spring20", kind: "percent_off", percentOff: 20 };
    await expect(createPromo(testCtx(parentActor, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createPromo(testCtx(support, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPromos(testCtx(parentActor, { now: T0 }))).rejects.toMatchObject({ code: "forbidden" });

    const promo = await make(input);
    expect(promo).toMatchObject({ code: "SPRING20", kind: "percent_off", percentOff: 20, active: true, redemptionCount: 0 });
    expect(promo.stripeCouponId).toBe("coupon_fake_spring20");
    await expect(make({ code: "Spring20", kind: "amount_off", amountOffPence: 500 })).rejects.toMatchObject({ code: "conflict" });
    expect(await listPromos(testCtx(admin, { now: T0 }))).toHaveLength(1);

    await expect(disablePromo(testCtx(support, { now: T0 }), promo.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await disablePromo(testCtx(admin, { now: T0 }), promo.id, "Campaign over")).active).toBe(false);
    expect(await auditRows("promo.create")).toHaveLength(1);
    expect((await auditRows("promo.disable"))[0]).toMatchObject({ actorId: admin.userId, reason: "Campaign over" });
  });
});

describe("limits", () => {
  it("refuses a code that is unknown, switched off, not started, expired or malformed", async () => {
    const { parentActor } = await createFamily();
    const ctx = testCtx(parentActor, { now: T0 });
    const off = await make({ code: "OFFNOW", kind: "percent_off", percentOff: 10 });
    await disablePromo(testCtx(admin, { now: T0 }), off.id);
    await make({ code: "LATER", kind: "percent_off", percentOff: 10, startsAt: daysAfter(5) });
    await make({ code: "SHORT", kind: "percent_off", percentOff: 10, expiresAt: daysAfter(1) });

    for (const code of ["NOPE123", "OFFNOW", "LATER", "'; drop table"]) {
      await expect(startCheckout(ctx, { planKey: "family", interval: "month", promoCode: code })).rejects.toMatchObject({ code: "invalid_input", fieldErrors: { promoCode: [expect.stringContaining("isn't one of ours")] } });
    }
    await expect(startCheckout(testCtx(parentActor, { now: daysAfter(2) }), { planKey: "family", interval: "month", promoCode: "SHORT" })).rejects.toMatchObject({ fieldErrors: { promoCode: [expect.stringContaining("run out")] } });
    // Before it runs out it is accepted, in any letter case.
    expect((await previewCheckout(ctx, { planKey: "family", interval: "month", promoCode: "short" })).promo).toEqual({ code: "SHORT", description: "10% off your first payment" });
  });

  it("counts a use only when the checkout completes, once per family, up to the limit", async () => {
    const promo = await make({ code: "FIRST1", kind: "amount_off", amountOffPence: 500, maxRedemptions: 1 });
    const a = await createFamily();
    const b = await createFamily();
    const ctxA = testCtx(a.parentActor, { now: T0 });
    const ctxB = testCtx(b.parentActor, { now: T0 });

    // Both families start checkout while one use is left. Starting is not using.
    const first = await startCheckout(ctxA, { planKey: "family", interval: "month", promoCode: "FIRST1" });
    const second = await startCheckout(ctxB, { planKey: "family", interval: "month", promoCode: "FIRST1" });
    expect((await promoRow(promo.id))?.redemptionCount).toBe(0);

    await completeFakeCheckout(sessionOf(first.url), T0);
    expect((await promoRow(promo.id))?.redemptionCount).toBe(1);
    expect(await db.select().from(promoRedemption)).toMatchObject([{ familyId: a.family.id, redeemedBy: a.parentActor.userId }]);
    expect((await auditRows("promo.redeem"))[0]?.meta).toMatchObject({ familyId: a.family.id });

    // The same webhooks again: still one use.
    await completeFakeCheckout(sessionOf(first.url), T0);
    expect((await promoRow(promo.id))?.redemptionCount).toBe(1);
    expect(await db.select().from(promoRedemption)).toHaveLength(1);

    // The limit is reached: the second family's payment page refuses the code, as Stripe's coupon would, and nothing starts.
    await expect(completeFakeCheckout(sessionOf(second.url), T0)).rejects.toMatchObject({ code: "conflict" });
    expect(await subscriptionRows(b.family.id)).toHaveLength(0);
    await expect(startCheckout(ctxB, { planKey: "family", interval: "month", promoCode: "FIRST1" })).rejects.toMatchObject({ fieldErrors: { promoCode: [expect.stringContaining("as many times")] } });
  });

  it("one use per family, even when the code has uses left", async () => {
    await make({ code: "WELCOME", kind: "percent_off", percentOff: 50, maxRedemptions: 100 });
    const { family, parentActor } = await createFamily();
    const ctx = testCtx(parentActor, { now: T0 });
    const { url } = await startCheckout(ctx, { planKey: "family", interval: "month", promoCode: "WELCOME" });
    await completeFakeCheckout(sessionOf(url), T0);

    // They cancel and come back later with the same code.
    const { subState, subEvent, send } = await import("./helpers");
    const [row] = await subscriptionRows(family.id);
    await send(subEvent("deleted", subState(family.id, { id: row?.stripeSubscriptionId ?? "", status: "canceled" }), daysAfter(10)), daysAfter(10));
    await expect(startCheckout(testCtx(parentActor, { now: daysAfter(11) }), { planKey: "family", interval: "month", promoCode: "WELCOME" })).rejects.toMatchObject({
      fieldErrors: { promoCode: [expect.stringContaining("already used")] },
    });
  });
});

describe("what each kind does", () => {
  it("percentage and fixed codes reduce the first payment through a coupon", async () => {
    await make({ code: "HALF", kind: "percent_off", percentOff: 50 });
    const { parentActor } = await createFamily();
    const { url } = await startCheckout(testCtx(parentActor, { now: T0 }), { planKey: "family", interval: "month", promoCode: "HALF" });
    const session = readFakeSession(sessionOf(url), T0);
    if (session?.kind !== "subscription") throw new Error("expected a checkout session");
    expect(session.couponId).toBe("coupon_fake_half");
    const summary = await describeFakeCheckout(session);
    expect(summary.firstPaymentPence).toBe(Math.round(summary.pricePence / 2));
    expect(summary.discountNote).toBe("Code HALF applied");
  });

  it("a free-period code gives a longer trial", async () => {
    await make({ code: "MONTHFREE", kind: "free_period", freeDays: 30 });
    const { family, parentActor } = await createFamily();
    const { url } = await startCheckout(testCtx(parentActor, { now: T0 }), { planKey: "family", interval: "month", promoCode: "MONTHFREE" });
    await completeFakeCheckout(sessionOf(url), T0);
    expect((await subscriptionRows(family.id))[0]).toMatchObject({ status: "trialing", trialEndsAt: daysAfter(30) });
  });

  it("a credit code gives every learner in the family extra Coach credits, once", async () => {
    await make({ code: "ENERGY", kind: "credit_grant", creditGrant: 40 });
    const { family, parentActor } = await createFamily();
    const one = await createLearner({ familyId: family.id, now: T0 });
    const two = await createLearner({ familyId: family.id, now: T0 });
    const ctx = testCtx(parentActor, { now: T0 });
    const { url } = await startCheckout(ctx, { planKey: "family", interval: "month", promoCode: "ENERGY" });
    await completeFakeCheckout(sessionOf(url), T0);
    await completeFakeCheckout(sessionOf(url), T0);

    const allowance = (await entitlementAt(family.id)).coachCreditsPerLearnerPerMonth;
    expect((await getCreditBalance(ctx, one.user.id)).balance).toBe(allowance + 40);
    expect((await getCreditBalance(ctx, two.user.id)).balance).toBe(allowance + 40);
  });
});
