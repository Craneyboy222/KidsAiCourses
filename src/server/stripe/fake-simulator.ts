import { addMonths, addYears } from "date-fns";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { family, plan, promoCode, subscription } from "@/server/db";
import { AppError } from "@/server/errors";
import { discountedPence, promoStillRedeemable } from "@/server/services/promo";
import { findPlanByPriceId, intervalOf, pencePrice, priceIdFor } from "@/server/services/plans";
import {
  fakeChargeObject,
  fakeCheckoutSessionObject,
  fakeDelivery,
  fakeInvoiceObject,
  fakeSetupIntentObject,
  fakeSubscriptionObject,
  readFakeSession,
  type FakeCheckoutSession,
  type FakeDelivery,
  type FakeSetupSession,
  type FakeSubscriptionState,
} from "./fake";

/**
 * What Stripe itself would do, for the fake driver: the "hosted" checkout and portal pages under
 * `/dev/fake-stripe` call these. Each one works out the events Stripe would send and delivers
 * them, signed, to the same webhook handler as the real endpoint. Nothing here writes to our
 * tables: if the handler did not exist, a fake checkout would change nothing at all.
 *
 * Only reachable with `STRIPE_DRIVER=fake`. The fake keeps no state; where it needs to know how a
 * subscription stands (to cancel or renew it) it reads our own mirror of it.
 */

/** Hands signed webhooks to the real handler, one after another, like Stripe's deliveries. */
export async function deliverFakeWebhooks(deliveries: FakeDelivery[], now: Date): Promise<void> {
  // Imported here to keep the module graph one-way: the handler imports the driver, not the other way round.
  const { receiveStripeWebhook } = await import("@/server/services/billing-events");
  for (const delivery of deliveries) await receiveStripeWebhook({ rawBody: delivery.payload, signature: delivery.signature, now });
}

const advance = (from: Date, interval: "month" | "year"): Date => (interval === "year" ? addYears(from, 1) : addMonths(from, 1));
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing in this file may run against a real Stripe account. */
function assertFake(): void {
  if (env.STRIPE_DRIVER !== "fake") throw new AppError("not_found", "We couldn't find that.");
}

export type FakeCheckoutSummary = {
  planName: string;
  interval: "month" | "year";
  pricePence: number;
  firstPaymentPence: number;
  trialDays: number;
  discountNote: string | null;
};

async function loadPromo(promoCodeId: string | undefined) {
  if (!promoCodeId) return null;
  const [row] = await db.select().from(promoCode).where(eq(promoCode.id, promoCodeId)).limit(1);
  return row ?? null;
}

/** What the fake checkout page shows before "paying". Its caller must have checked who is looking. */
export async function describeFakeCheckout(session: FakeCheckoutSession): Promise<FakeCheckoutSummary> {
  const resolved = await findPlanByPriceId({ db }, session.priceId);
  if (!resolved) throw new AppError("not_found", "That plan could not be found.");
  const pricePence = pencePrice(resolved.plan, resolved.variant) ?? 0;
  const promo = session.couponId ? await loadPromo(session.metadata.promoCodeId) : null;
  return {
    planName: resolved.plan.name,
    interval: intervalOf(resolved.variant),
    pricePence,
    firstPaymentPence: discountedPence(pricePence, promo),
    trialDays: session.trialDays,
    discountNote: promo ? `Code ${promo.code} applied` : null,
  };
}

/**
 * The person pressed "Pay" (or "Start trial") on the fake checkout page. Sends what Stripe sends:
 * `customer.subscription.created`, `invoice.paid` and `checkout.session.completed`. Event ids come
 * from the session, so pressing twice delivers the same events again and changes nothing more.
 */
export async function completeFakeCheckout(sessionId: string, now: Date): Promise<{ returnPath: string }> {
  assertFake();
  const session = readFakeSession(sessionId, now);
  if (!session || session.kind !== "subscription") throw new AppError("not_found", "That payment page has expired. Go back and start again.");
  const summary = await describeFakeCheckout(session);
  // Stripe refuses a coupon that has run out or reached its limit; so does the fake.
  if (session.metadata.promoCodeId && !(await promoStillRedeemable({ db, now }, session.metadata.promoCodeId, session.metadata.familyId))) {
    const [already] = await db.select({ id: subscription.id }).from(subscription).where(eq(subscription.stripeSubscriptionId, `sub_fake_${session.nonce}`)).limit(1);
    if (!already) throw new AppError("conflict", "That code can't be used any more. Go back and try again without it.");
  }

  const trialEnd = session.trialDays > 0 ? new Date(now.getTime() + session.trialDays * DAY_MS) : null;
  const state: FakeSubscriptionState = {
    id: `sub_fake_${session.nonce}`,
    customerId: session.customerId,
    familyId: session.metadata.familyId,
    priceId: session.priceId,
    status: trialEnd ? "trialing" : "active",
    createdAt: now,
    periodStart: now,
    periodEnd: trialEnd ?? advance(now, summary.interval),
    trialEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    extraSeats: 0,
    extraSeatPriceId: null,
  };
  await deliverFakeWebhooks(
    [
      fakeDelivery("customer.subscription.created", fakeSubscriptionObject(state), { created: now, id: `evt_fake_${session.nonce}_sub` }),
      fakeDelivery("invoice.paid", fakeInvoiceObject({ id: `in_fake_${session.nonce}`, customerId: session.customerId, subscriptionId: state.id, amountPaidPence: trialEnd ? 0 : summary.firstPaymentPence }), {
        created: now,
        id: `evt_fake_${session.nonce}_inv`,
      }),
      fakeDelivery(
        "checkout.session.completed",
        fakeCheckoutSessionObject({ id: sessionId, mode: "subscription", customerId: session.customerId, subscriptionId: state.id, metadata: session.metadata }),
        { created: now, id: `evt_fake_${session.nonce}_cs` },
      ),
    ],
    now,
  );
  return { returnPath: session.successPath };
}

/** The person pressed "Check my card" on the fake card-check page: `setup_intent.succeeded`, then `checkout.session.completed` in setup mode. */
export async function completeFakeSetup(sessionId: string, now: Date): Promise<{ returnPath: string }> {
  assertFake();
  const session = readFakeSession(sessionId, now);
  if (!session || session.kind !== "setup") throw new AppError("not_found", "That page has expired. Go back and start again.");
  const setup: FakeSetupSession = session;
  const intentId = `seti_fake_${setup.nonce}`;
  await deliverFakeWebhooks(
    [
      fakeDelivery("setup_intent.succeeded", fakeSetupIntentObject({ id: intentId, customerId: setup.customerId, familyId: setup.metadata.familyId }), { created: now, id: `evt_fake_${setup.nonce}_seti` }),
      fakeDelivery("checkout.session.completed", fakeCheckoutSessionObject({ id: sessionId, mode: "setup", customerId: setup.customerId, setupIntentId: intentId, metadata: setup.metadata }), {
        created: now,
        id: `evt_fake_${setup.nonce}_cs`,
      }),
    ],
    now,
  );
  return { returnPath: setup.successPath };
}

// ── Changes to a subscription that already exists ───────────────────────────

export type FakeSubscriptionChange =
  | { kind: "cancel_at_period_end" }
  | { kind: "resume" }
  | { kind: "cancel_now" }
  /** Time passes to the end of the period: a renewal payment, or the end of a cancelled plan. */
  | { kind: "period_end" }
  | { kind: "payment_failed" }
  | { kind: "payment_recovered" }
  | { kind: "trial_will_end" }
  | { kind: "trial_end"; trialEnd: Date }
  | { kind: "add_seat" }
  | { kind: "remove_seat" }
  | { kind: "refund" };

export const FAKE_PORTAL_ACTIONS = ["cancel_at_period_end", "resume", "cancel_now", "period_end", "payment_failed", "payment_recovered", "trial_will_end", "add_seat", "remove_seat", "refund"] as const;
export type FakePortalAction = (typeof FAKE_PORTAL_ACTIONS)[number];

/** How a subscription stands, read from our mirror of it (the fake has no records of its own). */
export async function loadFakeSubscription(stripeSubscriptionId: string): Promise<{ state: FakeSubscriptionState; interval: "month" | "year"; pricePence: number } | null> {
  const [row] = await db
    .select({ sub: subscription, plan, customerId: family.stripeCustomerId })
    .from(subscription)
    .innerJoin(plan, eq(plan.id, subscription.planId))
    .innerJoin(family, eq(family.id, subscription.familyId))
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  if (!row?.sub.stripePriceId || !row.customerId) return null;
  const resolved = await findPlanByPriceId({ db }, row.sub.stripePriceId);
  const interval = row.sub.interval ?? "month";
  return {
    interval,
    pricePence: resolved ? (pencePrice(resolved.plan, resolved.variant) ?? 0) : 0,
    state: {
      id: stripeSubscriptionId,
      customerId: row.customerId,
      familyId: row.sub.familyId,
      priceId: row.sub.stripePriceId,
      status: row.sub.status,
      createdAt: row.sub.createdAt,
      periodStart: row.sub.currentPeriodStart ?? row.sub.createdAt,
      periodEnd: row.sub.currentPeriodEnd ?? advance(row.sub.createdAt, interval),
      trialEnd: row.sub.trialEndsAt,
      cancelAtPeriodEnd: row.sub.cancelAtPeriodEnd,
      canceledAt: row.sub.canceledAt,
      extraSeats: row.sub.extraSeats,
      extraSeatPriceId: priceIdFor(row.plan, "extra_seat"),
    },
  };
}

/** The family's running fake subscription, for the portal page. */
export async function findFakeSubscriptionForCustomer(customerId: string): Promise<string | null> {
  const rows = await db
    .select({ stripeId: subscription.stripeSubscriptionId, status: subscription.status })
    .from(subscription)
    .innerJoin(family, eq(family.id, subscription.familyId))
    .where(eq(family.stripeCustomerId, customerId));
  return rows.find((row) => row.stripeId && row.status !== "canceled")?.stripeId ?? null;
}

/** The events Stripe would send for one change. Exported so the tests can use them as fixtures. */
export function eventsForChange(current: { state: FakeSubscriptionState; interval: "month" | "year"; pricePence: number }, change: FakeSubscriptionChange, now: Date): FakeDelivery[] {
  const { state, interval, pricePence } = current;
  const updated = (next: FakeSubscriptionState): FakeDelivery => fakeDelivery("customer.subscription.updated", fakeSubscriptionObject(next), { created: now });
  const deleted = (): FakeDelivery => fakeDelivery("customer.subscription.deleted", fakeSubscriptionObject({ ...state, status: "canceled", canceledAt: now }), { created: now });
  const invoice = (amountPaidPence: number) => fakeInvoiceObject({ customerId: state.customerId, subscriptionId: state.id, amountPaidPence });

  switch (change.kind) {
    case "cancel_at_period_end":
      return [updated({ ...state, cancelAtPeriodEnd: true, canceledAt: now })];
    case "resume":
      return [updated({ ...state, cancelAtPeriodEnd: false, canceledAt: null })];
    case "cancel_now":
      return [deleted()];
    case "period_end": {
      if (state.cancelAtPeriodEnd) return [deleted()];
      const next = { ...state, status: "active", periodStart: state.periodEnd, periodEnd: advance(state.periodEnd, interval) };
      return [fakeDelivery("invoice.paid", invoice(pricePence), { created: now }), updated(next)];
    }
    case "payment_failed":
      return [fakeDelivery("invoice.payment_failed", invoice(0), { created: now }), updated({ ...state, status: "past_due" })];
    case "payment_recovered":
      return [fakeDelivery("invoice.paid", invoice(pricePence), { created: now }), updated({ ...state, status: "active" })];
    case "trial_will_end":
      return [fakeDelivery("customer.subscription.trial_will_end", fakeSubscriptionObject(state), { created: now })];
    case "trial_end":
      return [updated({ ...state, trialEnd: change.trialEnd, periodEnd: state.status === "trialing" ? change.trialEnd : state.periodEnd })];
    case "add_seat":
      return [updated({ ...state, extraSeats: state.extraSeats + 1 })];
    case "remove_seat":
      return [updated({ ...state, extraSeats: Math.max(0, state.extraSeats - 1) })];
    case "refund":
      return [fakeDelivery("charge.refunded", fakeChargeObject({ customerId: state.customerId, amountPence: pricePence, refundedPence: pricePence }), { created: now })];
  }
}

/** Applies one change the way Stripe would: by sending webhooks. Used by the fake portal and by the driver's own calls. */
export async function simulateSubscriptionChange(stripeSubscriptionId: string, change: FakeSubscriptionChange, now: Date): Promise<void> {
  assertFake();
  const current = await loadFakeSubscription(stripeSubscriptionId);
  if (!current) throw new AppError("not_found", "That subscription could not be found.");
  await deliverFakeWebhooks(eventsForChange(current, change, now), now);
}
