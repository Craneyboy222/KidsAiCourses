import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { StaffActor } from "@/server/authz/actor";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "@/server/jobs";
import { billingReconcile } from "@/server/jobs/billing";
import { cancelFamilySubscriptions, endCompedPlan, extendTrial, getBillingOverview, grantCompedPlan } from "@/server/services/billing";
import { getPlanByKey, listPlansForAdmin, updatePlan } from "@/server/services/plans";
import { PLANS_DIR, importPlans } from "../../../scripts/import-plans";
import { closeDb, testCtx } from "../../helpers/db";
import { createFamily, createStaff } from "../../helpers/factories";
import { T0, auditRows, daysAfter, entitlementAt, familyRow, setUpBilling, subscribe, subscriptionRows, sys } from "./helpers";

let admin: StaffActor;
beforeEach(async () => {
  await setUpBilling();
  admin = (await createStaff({ roles: ["admin"] })).actor;
});
afterAll(closeDb);

const adminCtx = (now: Date = T0) => testCtx(admin, { now });

describe("billing exceptions are admin-only and audited", () => {
  it("a plan given at no charge runs until its date, then the family is on Free", async () => {
    const { family, parentActor } = await createFamily();
    const { actor: support } = await createStaff({ roles: ["support"] });
    const input = { familyId: family.id, planKey: "family", until: daysAfter(30), reason: "Founding family, thank-you month" };

    await expect(grantCompedPlan(testCtx(parentActor, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(grantCompedPlan(testCtx(support, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(grantCompedPlan(adminCtx(), { ...input, reason: " " })).rejects.toMatchObject({ code: "invalid_input" });

    await grantCompedPlan(adminCtx(), input);
    expect(await entitlementAt(family.id)).toMatchObject({ planKey: "family", fullCatalogue: true, status: "active" });
    expect((await auditRows("billing.comp_grant"))[0]).toMatchObject({ actorId: admin.userId, targetId: family.id, reason: input.reason });
    const overview = await getBillingOverview(testCtx(parentActor, { now: T0 }));
    expect(overview.subscription).toMatchObject({ comped: true, endsAt: daysAfter(30), nextPaymentAt: null });

    // Giving it again moves the date rather than adding a second plan.
    await grantCompedPlan(adminCtx(), { ...input, until: daysAfter(60) });
    expect(await subscriptionRows(family.id)).toHaveLength(1);
    expect((await entitlementAt(family.id, daysAfter(59))).planKey).toBe("family");
    expect((await entitlementAt(family.id, daysAfter(60))).planKey).toBe("free");

    await runJob(billingReconcile, undefined, { now: daysAfter(61) });
    expect((await subscriptionRows(family.id))[0]?.status).toBe("canceled");
    expect((await familyRow(family.id))?.plan).toBe("free");
  });

  it("a comped plan can be ended early, and is refused beside a paid plan", async () => {
    const a = await createFamily();
    await grantCompedPlan(adminCtx(), { familyId: a.family.id, planKey: "family", until: daysAfter(30), reason: "Support goodwill" });
    await endCompedPlan(adminCtx(daysAfter(1)), { familyId: a.family.id, reason: "Given by mistake" });
    expect((await entitlementAt(a.family.id, daysAfter(1))).planKey).toBe("free");
    expect(await auditRows("billing.comp_end")).toHaveLength(1);

    const b = await createFamily();
    await subscribe(b.family.id);
    await expect(grantCompedPlan(adminCtx(), { familyId: b.family.id, planKey: "family", until: daysAfter(30), reason: "Support goodwill" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("extending a trial goes to Stripe and comes back as a webhook", async () => {
    const { family, parentActor } = await createFamily();
    await subscribe(family.id, { status: "trialing", trialEnd: daysAfter(7), periodEnd: daysAfter(7) });
    const input = { familyId: family.id, until: daysAfter(21), reason: "Family was away for the first week" };
    await expect(extendTrial(testCtx(parentActor, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(extendTrial(adminCtx(), { ...input, until: daysAfter(3) })).rejects.toMatchObject({ code: "invalid_input" });

    await extendTrial(adminCtx(), input);
    expect((await subscriptionRows(family.id))[0]).toMatchObject({ status: "trialing", trialEndsAt: daysAfter(21), currentPeriodEnd: daysAfter(21) });
    expect((await auditRows("billing.trial_extend"))[0]).toMatchObject({ actorId: admin.userId, reason: input.reason });

    const paying = await createFamily();
    await subscribe(paying.family.id);
    await expect(extendTrial(adminCtx(), { ...input, familyId: paying.family.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("account deletion can end a family's subscription at Stripe", async () => {
    const { family, parentActor } = await createFamily();
    await subscribe(family.id);
    await expect(cancelFamilySubscriptions(testCtx(parentActor, { now: T0 }), { familyId: family.id, reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await cancelFamilySubscriptions(sys(), { familyId: family.id, reason: "Family deleted their account" })).toEqual({ cancelled: 1 });
    expect(await entitlementAt(family.id)).toMatchObject({ planKey: "free", status: "cancelled" });
    expect(await cancelFamilySubscriptions(sys(), { familyId: family.id, reason: "Family deleted their account" })).toEqual({ cancelled: 0 });
  });
});

describe("plans are data", () => {
  const file = (name: string) => JSON.parse(readFileSync(join(PLANS_DIR, name), "utf8")) as { seats: number; coachCredits: number; trialDays: number; prices: { placeholder: boolean; monthlyPence: number; annualPence: number; extraSeatMonthlyPence?: number; founding?: { monthlyPence: number; annualPence: number; lockMonths: number } } };

  it("the importer loads the files, marks placeholder prices and can be run again", async () => {
    const family = file("family.json");
    const row = await getPlanByKey(sys(), "family");
    expect(row).toMatchObject({
      seats: family.seats,
      coachCredits: family.coachCredits,
      trialDays: family.trialDays,
      priceMonthlyPence: family.prices.monthlyPence,
      priceAnnualPence: family.prices.annualPence,
      foundingMonthlyPence: family.prices.founding?.monthlyPence,
      foundingAnnualPence: family.prices.founding?.annualPence,
      foundingLockMonths: family.prices.founding?.lockMonths,
      extraSeatPricePence: family.prices.extraSeatMonthlyPence,
    });
    expect(row?.features).toMatchObject({ fullCatalogue: true, pricePlaceholder: true, foundingOpen: true });
    expect(family.prices.placeholder).toBe(true);
    expect(file("free.json").prices).toMatchObject({ placeholder: true, monthlyPence: 0, annualPence: 0 });

    await updatePlan(adminCtx(), "family", { stripePriceMonthlyId: "price_live_123" });
    expect(await importPlans(sys())).toEqual({ inserted: [], updated: ["family", "free"] });
    expect((await getPlanByKey(sys(), "family"))?.stripePriceMonthlyId).toBe("price_live_123");
    expect(await listPlansForAdmin(adminCtx())).toHaveLength(2);
  });

  it("a price changed in Studio is the price a parent is shown: nothing is fixed in code", async () => {
    const { parentActor } = await createFamily();
    const { actor: editor } = await createStaff({ roles: ["editor"] });
    await expect(updatePlan(testCtx(editor), "family", { priceMonthlyPence: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPlansForAdmin(testCtx(parentActor))).rejects.toMatchObject({ code: "forbidden" });

    await updatePlan(adminCtx(), "family", { priceMonthlyPence: 1234, foundingOpen: false, seats: 5 }, "Launch pricing");
    const overview = await getBillingOverview(testCtx(parentActor, { now: T0 }));
    const monthly = overview.offers[0]?.options.find((o) => o.interval === "month");
    expect(monthly).toMatchObject({ pricePence: 1234, founding: false });
    expect(overview.offers[0]?.seats).toBe(5);
    expect((await auditRows("plan.update"))[0]).toMatchObject({ actorId: admin.userId, reason: "Launch pricing" });
    await expect(updatePlan(adminCtx(), "free", { active: false })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("the founding price is offered while the offer is open, with the usual price beside it", async () => {
    const { parentActor } = await createFamily();
    const family = file("family.json");
    const overview = await getBillingOverview(testCtx(parentActor, { now: T0 }));
    expect(overview.offers[0]?.options.find((o) => o.interval === "month")).toEqual({
      interval: "month",
      pricePence: family.prices.founding?.monthlyPence,
      founding: true,
      standardPricePence: family.prices.monthlyPence,
      lockMonths: family.prices.founding?.lockMonths,
    });
    expect(overview.offers[0]).toMatchObject({ trialDays: family.trialDays, pricesArePlaceholders: true });
  });
});
