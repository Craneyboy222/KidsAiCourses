import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { stripeEvent } from "@/server/db/schema";
import { startCheckout } from "@/server/services/billing";
import { receiveStripeWebhook } from "@/server/services/billing-events";
import { fakeChargeObject, fakeDelivery, fakeWebhookSecret, redeliver, signWebhookPayload } from "@/server/stripe/fake";
import { completeFakeCheckout } from "@/server/stripe/fake-simulator";
import { WebhookSignatureError } from "@/server/stripe";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createFamily, createLearner } from "../../helpers/factories";
import { T0, auditRows, daysAfter, entitlementAt, eventRow, familyRow, invoiceEvent, linkCustomer, notificationsFor, send, setUpBilling, subEvent, subState, subscribe, subscriptionRows } from "./helpers";

beforeEach(setUpBilling);
afterAll(closeDb);

const post = (payload: string, signature: string | null) =>
  POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: signature ? { "stripe-signature": signature } : {} }));

describe("signature", () => {
  it("refuses a forged signature with 400 and stores nothing", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const body = subEvent("created", subState(family.id), new Date()).payload;
    const response = await post(body, signWebhookPayload(body, new Date(), "whsec_not_the_real_secret"));
    expect(response.status).toBe(400);
    expect(await db.select().from(stripeEvent)).toHaveLength(0);
    expect((await entitlementAt(family.id)).planKey).toBe("free");
    // The same through the service, as the fake checkout page calls it.
    await expect(receiveStripeWebhook({ rawBody: body, signature: signWebhookPayload(body, T0, "whsec_not_the_real_secret"), now: T0 })).rejects.toBeInstanceOf(WebhookSignatureError);
    expect(await db.select().from(stripeEvent)).toHaveLength(0);
  });

  it("refuses a body with no signature, a tampered body and a replay of an old signature", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const now = new Date();
    const good = subEvent("created", subState(family.id), now);

    expect((await post(good.payload, null)).status).toBe(400);
    expect((await post(good.payload.replace('"active"', '"trialing"'), good.signature)).status).toBe(400);
    // A real signature, but made an hour ago: outside the five-minute window.
    expect((await post(good.payload, signWebhookPayload(good.payload, new Date(now.getTime() - 60 * 60 * 1000)))).status).toBe(400);
    expect(await db.select().from(stripeEvent)).toHaveLength(0);
    expect(fakeWebhookSecret()).toMatch(/^whsec_fake_[0-9a-f]{64}$/);
  });

  it("accepts a correctly signed event through the route and answers 200", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const now = new Date();
    const good = subEvent("created", subState(family.id, { createdAt: now, periodStart: now, periodEnd: daysAfter(30, now) }), now);
    const response = await post(good.payload, good.signature);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, status: "processed" });
    expect((await entitlementAt(family.id, now)).planKey).toBe("family");
  });
});

describe("the entitlement changes only when a webhook arrives", () => {
  it("starting checkout grants nothing; the completed checkout's webhooks do", async () => {
    const { family, parentActor } = await createFamily();
    const ctx = testCtx(parentActor, { now: T0 });
    const { url } = await startCheckout(ctx, { planKey: "family", interval: "month" });
    expect(url).toMatch(/^\/dev\/fake-stripe\/checkout\?session=/);

    // The browser has been to "Stripe" and nothing has come back: still Free, no subscription row.
    expect(await entitlementAt(family.id)).toMatchObject({ planKey: "free", status: "none", fullCatalogue: false, seats: 2 });
    expect(await subscriptionRows(family.id)).toHaveLength(0);
    expect((await familyRow(family.id))?.stripeCustomerId).toMatch(/^cus_fake_/);

    const sessionId = decodeURIComponent(url.split("session=")[1] ?? "");
    const { returnPath } = await completeFakeCheckout(sessionId, T0);
    expect(returnPath).toBe("/parent/billing?checkout=success");

    // Family has a 7-day trial with a card.
    expect(await entitlementAt(family.id)).toMatchObject({ planKey: "family", status: "trialing", fullCatalogue: true, seats: 4, coachCreditsPerLearnerPerMonth: 200 });
    expect((await familyRow(family.id))?.plan).toBe("family");
    expect(await auditRows("entitlement.change")).toHaveLength(1);
    expect(await notificationsFor(parentActor.userId, "billing.plan_started")).toHaveLength(1);

    // Pressing "pay" twice sends the same three events again: nothing more happens.
    await completeFakeCheckout(sessionId, T0);
    expect(await subscriptionRows(family.id)).toHaveLength(1);
    expect(await db.select().from(stripeEvent)).toHaveLength(3);
    expect(await notificationsFor(parentActor.userId, "billing.plan_started")).toHaveLength(1);
  });

  it("a second checkout is refused while a plan is running", async () => {
    const { family, parentActor } = await createFamily();
    await subscribe(family.id);
    await expect(startCheckout(testCtx(parentActor, { now: T0 }), { planKey: "family", interval: "year" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("idempotency and ordering", () => {
  it("handles a repeated event once", async () => {
    const { family, parentActor } = await createFamily();
    await linkCustomer(family.id);
    const created = subEvent("created", subState(family.id), T0, "evt_dup_1");
    expect((await send(created)).status).toBe("processed");
    expect((await send(created)).status).toBe("duplicate");
    expect((await send(redeliver(created, daysAfter(1)), daysAfter(1))).status).toBe("duplicate");
    expect(await subscriptionRows(family.id)).toHaveLength(1);
    expect((await eventRow("evt_dup_1"))?.attempts).toBe(1);
    expect(await auditRows("entitlement.change")).toHaveLength(1);
    expect(await notificationsFor(parentActor.userId, "billing.plan_started")).toHaveLength(1);
  });

  it("handles the same event delivered twice at the same moment once", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const created = subEvent("created", subState(family.id), T0, "evt_race_1");
    const outcomes = await Promise.all([send(created), send(created), send(created)]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["duplicate", "duplicate", "processed"]);
    expect(await subscriptionRows(family.id)).toHaveLength(1);
    expect(await auditRows("entitlement.change")).toHaveLength(1);
  });

  it("an older event arriving late never rolls the subscription back", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const state = subState(family.id);
    const t1 = daysAfter(1);
    const t2 = daysAfter(2);

    // Delivered newest first: the cancellation (day 2), then the update before it (day 1), then the original "created".
    await send(subEvent("deleted", { ...state, status: "canceled", canceledAt: t2 }, t2), t2);
    expect((await send(subEvent("updated", { ...state, extraSeats: 1 }, t1), t2)).note).toBe("stale");
    expect((await send(subEvent("created", state, T0), t2)).note).toBe("stale");

    const [row] = await subscriptionRows(family.id);
    expect(row).toMatchObject({ status: "canceled", extraSeats: 0 });
    expect(await entitlementAt(family.id, t2)).toMatchObject({ planKey: "free", status: "cancelled" });
  });

  it("applies `updated` when it arrives before `created`, and then ignores the late `created`", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const state = subState(family.id, { status: "trialing", trialEnd: daysAfter(7), periodEnd: daysAfter(7) });
    const later = daysAfter(7);
    await send(subEvent("updated", { ...state, status: "active", periodStart: later, periodEnd: daysAfter(37) }, later), later);
    await send(subEvent("created", state, T0), later);
    expect((await subscriptionRows(family.id))[0]).toMatchObject({ status: "active" });
    expect((await entitlementAt(family.id, later)).status).toBe("active");
  });

  it("two events in the same second: nothing revives an ended subscription", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const state = subState(family.id);
    await send(subEvent("created", state, T0));
    await send(subEvent("deleted", { ...state, status: "canceled" }, T0));
    expect((await send(subEvent("updated", { ...state, extraSeats: 2 }, T0))).note).toBe("stale");
    expect((await subscriptionRows(family.id))[0]?.status).toBe("canceled");
  });

  it("a failure is recorded, changes nothing, and succeeds when Stripe retries", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const unknownPrice = subEvent("created", subState(family.id, { priceId: "price_unknown_123" }), T0, "evt_fail_1");
    await expect(send(unknownPrice)).rejects.toThrow(/No plan uses any Stripe price/);
    expect(await eventRow("evt_fail_1")).toMatchObject({ status: "failed", attempts: 1 });
    expect(await subscriptionRows(family.id)).toHaveLength(0);
    expect((await entitlementAt(family.id)).planKey).toBe("free");

    // The route answers 500 so that Stripe tries again.
    const again = redeliver(unknownPrice, new Date());
    expect((await post(again.payload, again.signature)).status).toBe(500);
    expect((await eventRow("evt_fail_1"))?.attempts).toBe(2);
  });

  it("records an event type it does not act on as ignored, and one for an unknown customer too", async () => {
    const { family } = await createFamily();
    expect((await send(fakeDelivery("customer.updated", { id: "cus_x" }, { created: T0, id: "evt_other" }))).status).toBe("ignored");
    // No customer link and no metadata match.
    const stranger = subState(family.id, { customerId: "cus_someone_else", familyId: "00000000-0000-4000-8000-000000000000" });
    expect(await send(subEvent("created", stranger, T0, "evt_stranger"))).toMatchObject({ status: "ignored" });
    expect(await subscriptionRows(family.id)).toHaveLength(0);
    expect((await eventRow("evt_other"))?.status).toBe("ignored");
  });
});

describe("each event", () => {
  it("customer.subscription.created: mirrors plan, interval, period and founding price", async () => {
    const { family } = await createFamily();
    await subscribe(family.id, { priceId: "price_fake_family_founding_annual", periodEnd: new Date("2027-11-16T10:00:00.000Z") });
    const [row] = await subscriptionRows(family.id);
    expect(row).toMatchObject({ status: "active", interval: "year", isFounding: true, extraSeats: 0, cancelAtPeriodEnd: false });
    expect(row?.foundingLockedUntil?.toISOString().slice(0, 10)).toBe("2027-11-16");
    expect(row?.currentPeriodEnd?.toISOString()).toBe("2027-11-16T10:00:00.000Z");
  });

  it("customer.subscription.updated: extra seats raise the seat limit", async () => {
    const { family } = await createFamily();
    const state = await subscribe(family.id);
    expect((await entitlementAt(family.id)).seats).toBe(4);
    await send(subEvent("updated", { ...state, extraSeats: 2 }, daysAfter(1)), daysAfter(1));
    expect((await entitlementAt(family.id, daysAfter(1))).seats).toBe(6);
  });

  it("customer.subscription.deleted: back to Free at once, and the family is told nothing was deleted", async () => {
    const { family, parentActor } = await createFamily();
    const state = await subscribe(family.id);
    await send(subEvent("deleted", { ...state, status: "canceled", canceledAt: daysAfter(3) }, daysAfter(3)), daysAfter(3));
    expect(await entitlementAt(family.id, daysAfter(3))).toMatchObject({ planKey: "free", status: "cancelled", fullCatalogue: false, seats: 2, coachCreditsPerLearnerPerMonth: 50 });
    expect((await familyRow(family.id))?.plan).toBe("free");
    const [notice] = await notificationsFor(parentActor.userId, "billing.plan_ended");
    expect(JSON.stringify(notice?.payload)).toContain("Nothing has been deleted");
  });

  it("customer.subscription.trial_will_end: tells the parent the date, changes nothing", async () => {
    const { family, parentActor } = await createFamily();
    const state = await subscribe(family.id, { status: "trialing", trialEnd: daysAfter(7), periodEnd: daysAfter(7) });
    await send(subEvent("trial_will_end", state, daysAfter(4)), daysAfter(4));
    const [notice] = await notificationsFor(parentActor.userId, "billing.trial_ending");
    expect(JSON.stringify(notice?.payload)).toContain("23 November 2026");
    expect((await entitlementAt(family.id, daysAfter(4))).status).toBe("trialing");
  });

  it("invoice.payment_failed then invoice.paid: past_due, then active again", async () => {
    const { family, parentActor } = await createFamily();
    const state = await subscribe(family.id);
    const failedAt = daysAfter(30);
    await send(invoiceEvent("payment_failed", state, failedAt, { invoiceId: "in_1" }), failedAt);
    expect((await subscriptionRows(family.id))[0]).toMatchObject({ status: "past_due", pastDueSince: failedAt });
    expect(await entitlementAt(family.id, failedAt)).toMatchObject({ planKey: "family", status: "past_due" });
    // Stripe's second attempt at the same invoice does not send a second message.
    await send(invoiceEvent("payment_failed", state, daysAfter(31), { invoiceId: "in_1" }), daysAfter(31));
    expect(await notificationsFor(parentActor.userId, "billing.payment_failed")).toHaveLength(1);

    await send(invoiceEvent("paid", state, daysAfter(32), { invoiceId: "in_1" }), daysAfter(32));
    expect((await subscriptionRows(family.id))[0]).toMatchObject({ status: "active", pastDueSince: null });
    expect((await entitlementAt(family.id, daysAfter(32))).status).toBe("active");
    expect(await notificationsFor(parentActor.userId, "billing.payment_recovered")).toHaveLength(1);
  });

  it("a late invoice.payment_failed does not undo a payment that has since succeeded", async () => {
    const { family } = await createFamily();
    const state = await subscribe(family.id);
    await send(subEvent("updated", { ...state, periodStart: daysAfter(30), periodEnd: daysAfter(60) }, daysAfter(31)), daysAfter(31));
    expect((await send(invoiceEvent("payment_failed", state, daysAfter(30)), daysAfter(31))).note).toBe("stale");
    expect((await entitlementAt(family.id, daysAfter(31))).status).toBe("active");
  });

  it("invoice.paid before the subscription exists is accepted and changes nothing by itself", async () => {
    const { family } = await createFamily();
    await linkCustomer(family.id);
    const state = subState(family.id);
    expect((await send(invoiceEvent("paid", state, T0))).status).toBe("processed");
    expect((await entitlementAt(family.id)).planKey).toBe("free");
    await send(subEvent("created", state, T0));
    expect((await entitlementAt(family.id)).planKey).toBe("family");
  });

  it("charge.refunded: audited, the family is told, and the plan carries on until Stripe cancels it", async () => {
    const { family, parentActor } = await createFamily();
    const state = await subscribe(family.id);
    const refund = fakeDelivery("charge.refunded", fakeChargeObject({ id: "ch_1", customerId: state.customerId, amountPence: 1499, refundedPence: 1499 }), { created: daysAfter(2) });
    expect((await send(refund, daysAfter(2))).status).toBe("processed");
    const [entry] = await auditRows("billing.refund");
    expect(entry?.meta).toMatchObject({ chargeId: "ch_1", refundedPence: 1499, full: true });
    expect(await notificationsFor(parentActor.userId, "billing.refund")).toHaveLength(1);
    expect((await entitlementAt(family.id, daysAfter(2))).planKey).toBe("family");

    // The owner also cancels the subscription in Stripe: that is what ends the plan.
    await send(subEvent("deleted", { ...state, status: "canceled", canceledAt: daysAfter(2) }, daysAfter(2)), daysAfter(2));
    expect((await entitlementAt(family.id, daysAfter(2))).planKey).toBe("free");
  });

  it("every plan change is written to the audit log by the system actor, never a person", async () => {
    const { family } = await createFamily();
    await createLearner({ familyId: family.id, now: T0 });
    await subscribe(family.id);
    const [entry] = await auditRows("entitlement.change");
    expect(entry).toMatchObject({ targetId: family.id, actorId: null });
    expect(entry?.meta).toMatchObject({ from: "free", to: "family" });
  });
});
