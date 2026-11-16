import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runJob } from "@/server/jobs";
import { billingReconcile } from "@/server/jobs/billing";
import { getBillingOverview } from "@/server/services/billing";
import { assertSeatAvailable } from "@/server/services/children";
import { canAccessCourse, getEntitlementForLearner } from "@/server/services/entitlements";
import { setSetting } from "@/server/settings";
import { closeDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";
import { T0, createCourse, daysAfter, entitlementAt, familyRow, invoiceEvent, notificationsFor, send, setUpBilling, subEvent, subscribe, sys } from "./helpers";

beforeEach(setUpBilling);
afterAll(closeDb);

describe("Free", () => {
  it("a family with no subscription is on Free: free courses, the Free allowance, the calendar month", async () => {
    const { family } = await createFamily();
    const { user: learner } = await createLearner({ familyId: family.id, now: T0 });
    const free = await createCourse({ isFree: true });
    const paid = await createCourse();

    expect(await entitlementAt(family.id)).toEqual({ planKey: "free", fullCatalogue: false, seats: 2, coachCreditsPerLearnerPerMonth: 50, status: "none", periodKey: "2026-11" });
    expect(await getEntitlementForLearner(sys(), learner.id)).toMatchObject({ planKey: "free", periodKey: "2026-11" });
    expect(await canAccessCourse(sys(), learner.id, free)).toBe(true);
    expect(await canAccessCourse(sys(), learner.id, paid)).toBe(false);
  });

  it("a teen with no family yet, and a database with no plans at all, are still on Free", async () => {
    const { user: teen } = await createLearner({ familyId: null, now: T0 });
    expect(await getEntitlementForLearner(sys(), teen.id)).toMatchObject({ planKey: "free", status: "none", fullCatalogue: false });
    const { resetDb } = await import("../../helpers/db");
    await resetDb();
    const { family } = await createFamily();
    expect(await entitlementAt(family.id)).toMatchObject({ planKey: "free", seats: 2, coachCreditsPerLearnerPerMonth: 50 });
  });
});

describe("Family", () => {
  it("opens the full catalogue, four seats and the Family allowance; the period follows the anniversary", async () => {
    const { family } = await createFamily();
    const { user: learner } = await createLearner({ familyId: family.id, now: T0 });
    const paid = await createCourse();
    await subscribe(family.id);

    expect(await entitlementAt(family.id)).toEqual({ planKey: "family", fullCatalogue: true, seats: 4, coachCreditsPerLearnerPerMonth: 200, status: "active", periodKey: "2026-11-16" });
    expect(await canAccessCourse(sys(), learner.id, paid)).toBe(true);
    // The day before the next anniversary is still the first period; the anniversary starts the next.
    expect((await entitlementAt(family.id, new Date("2026-12-15T12:00:00Z"))).periodKey).toBe("2026-11-16");
    expect((await entitlementAt(family.id, new Date("2026-12-16T12:00:00Z"))).periodKey).toBe("2026-12-16");
  });

  it("seats: the plan's limit is what stops a child being added, and extra seats raise it", async () => {
    const { family, parentActor } = await createFamily();
    const ctx = testCtx(parentActor, { now: T0 });
    await createLearner({ familyId: family.id, now: T0 });
    await createLearner({ familyId: family.id, now: T0 });
    await expect(assertSeatAvailable(ctx, family.id)).rejects.toMatchObject({ code: "entitlement_required" });

    const state = await subscribe(family.id);
    await expect(assertSeatAvailable(ctx, family.id)).resolves.toBeUndefined();
    await createLearner({ familyId: family.id, now: T0 });
    await createLearner({ familyId: family.id, now: T0 });
    await expect(assertSeatAvailable(ctx, family.id)).rejects.toMatchObject({ code: "entitlement_required" });

    await send(subEvent("updated", { ...state, extraSeats: 1 }, daysAfter(1)), daysAfter(1));
    await expect(assertSeatAvailable(testCtx(parentActor, { now: daysAfter(1) }), family.id)).resolves.toBeUndefined();
    expect((await getBillingOverview(testCtx(parentActor, { now: daysAfter(1) }))).seats).toEqual({ used: 4, total: 5, extra: 1 });
  });
});

describe("a failed payment: grace, then downgrade", () => {
  it("keeps the plan for the grace period, then Free until a payment succeeds", async () => {
    const { family, parentActor } = await createFamily();
    const { user: learner } = await createLearner({ familyId: family.id, now: T0 });
    const paid = await createCourse();
    const free = await createCourse({ isFree: true });
    const state = await subscribe(family.id);
    const failedAt = daysAfter(30);
    await send(invoiceEvent("payment_failed", state, failedAt), failedAt);
    await send(subEvent("updated", { ...state, status: "past_due", periodStart: failedAt, periodEnd: daysAfter(60) }, failedAt), failedAt);

    // Day 6 of 7: nothing has changed.
    expect(await entitlementAt(family.id, daysAfter(36))).toMatchObject({ planKey: "family", status: "past_due", fullCatalogue: true });
    expect(await canAccessCourse(sys(daysAfter(36)), learner.id, paid)).toBe(true);
    const overview = await getBillingOverview(testCtx(parentActor, { now: daysAfter(36) }));
    expect(overview.subscription?.pastDue).toEqual({ graceEndsAt: daysAfter(37), inGrace: true });

    // Day 7: Free, with no webhook and no job needed. Free courses stay open.
    const after = daysAfter(37);
    expect(await entitlementAt(family.id, after)).toMatchObject({ planKey: "free", status: "past_due", fullCatalogue: false, seats: 2, periodKey: "2026-12" });
    expect(await canAccessCourse(sys(after), learner.id, paid)).toBe(false);
    expect(await canAccessCourse(sys(after), learner.id, free)).toBe(true);

    // The daily job brings the cache into line and tells the family, once.
    expect((await familyRow(family.id))?.plan).toBe("family");
    expect(await runJob(billingReconcile, undefined, { now: after })).toMatchObject({ status: "succeeded" });
    expect((await familyRow(family.id))?.plan).toBe("free");
    await runJob(billingReconcile, undefined, { now: after });
    expect(await notificationsFor(parentActor.userId, "billing.plan_ended")).toHaveLength(1);

    // The card is fixed: the plan is back straight away.
    const paidAt = daysAfter(40);
    await send(invoiceEvent("paid", state, paidAt), paidAt);
    expect(await entitlementAt(family.id, paidAt)).toMatchObject({ planKey: "family", status: "active" });
    expect((await familyRow(family.id))?.plan).toBe("family");
  });

  it("the length of the grace period is a setting", async () => {
    const { family } = await createFamily();
    const { actor: admin } = await createStaff({ roles: ["admin"] });
    const state = await subscribe(family.id);
    await send(invoiceEvent("payment_failed", state, daysAfter(30)), daysAfter(30));
    await setSetting(testCtx(admin), "site.payment_grace_days", 2);
    expect((await entitlementAt(family.id, daysAfter(31))).planKey).toBe("family");
    expect((await entitlementAt(family.id, daysAfter(33))).planKey).toBe("free");
  });
});

describe("cancelling", () => {
  it("keeps access to the end of the period, then reverts to Free", async () => {
    const { family, parentActor } = await createFamily();
    const { user: learner } = await createLearner({ familyId: family.id, now: T0 });
    const paid = await createCourse();
    const state = await subscribe(family.id);
    const cancelledAt = daysAfter(5);
    await send(subEvent("updated", { ...state, cancelAtPeriodEnd: true, canceledAt: cancelledAt }, cancelledAt), cancelledAt);

    expect(await entitlementAt(family.id, daysAfter(29))).toMatchObject({ planKey: "family", status: "active" });
    expect(await canAccessCourse(sys(daysAfter(29)), learner.id, paid)).toBe(true);
    const overview = await getBillingOverview(testCtx(parentActor, { now: daysAfter(6) }));
    expect(overview.subscription).toMatchObject({ endsAt: state.periodEnd, nextPaymentAt: null });
    expect(await notificationsFor(parentActor.userId, "billing.cancel_scheduled")).toHaveLength(1);

    // The period has ended. Even before Stripe's "deleted" event arrives, access has gone.
    const end = new Date(state.periodEnd.getTime() + 1000);
    expect(await entitlementAt(family.id, end)).toMatchObject({ planKey: "free", status: "cancelled" });
    expect(await canAccessCourse(sys(end), learner.id, paid)).toBe(false);

    await send(subEvent("deleted", { ...state, status: "canceled", cancelAtPeriodEnd: true, canceledAt: cancelledAt }, end), end);
    expect(await entitlementAt(family.id, end)).toMatchObject({ planKey: "free", status: "cancelled" });
    expect((await familyRow(family.id))?.plan).toBe("free");
    expect((await getBillingOverview(testCtx(parentActor, { now: end }))).canChoosePlan).toBe(true);
  });

  it("changing their mind before the end keeps the plan", async () => {
    const { family } = await createFamily();
    const state = await subscribe(family.id);
    await send(subEvent("updated", { ...state, cancelAtPeriodEnd: true }, daysAfter(5)), daysAfter(5));
    await send(subEvent("updated", { ...state, cancelAtPeriodEnd: false, periodStart: state.periodEnd, periodEnd: daysAfter(60) }, daysAfter(31)), daysAfter(31));
    expect(await entitlementAt(family.id, daysAfter(31))).toMatchObject({ planKey: "family", status: "active" });
  });
});
