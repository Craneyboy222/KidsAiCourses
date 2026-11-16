import { and, eq } from "drizzle-orm";
import { systemActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { auditLog, course, family, notification, stripeEvent, subscription } from "@/server/db/schema";
import { clearSentEmails } from "@/server/email";
import { receiveStripeWebhook, type WebhookOutcome } from "@/server/services/billing-events";
import { getEntitlementForFamily, type Entitlement } from "@/server/services/entitlements";
import { setStripeDriverForTests } from "@/server/stripe";
import { createFakeStripeDriver, fakeCustomerId, fakeDelivery, fakeInvoiceObject, fakeSubscriptionObject, redeliver, type FakeDelivery, type FakeSubscriptionState } from "@/server/stripe/fake";
import { importPlans } from "../../../scripts/import-plans";
import { db, resetDb, testCtx } from "../../helpers/db";

/**
 * Shared set-up for the payments integration tests. Everything is the real code against real
 * Postgres. Stripe is the fake driver, whose event builders are the webhook fixtures: each one is
 * a signed body exactly as the endpoint would receive it. Nothing is mocked.
 */
export const T0 = new Date("2026-11-16T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
export const daysAfter = (days: number, from: Date = T0): Date => new Date(from.getTime() + days * DAY);

export const sys = (now: Date = T0): Ctx => testCtx(systemActor("test"), { now });

/** Empties the database, loads the real plan files and pins the fake driver's clock. */
export async function setUpBilling(): Promise<void> {
  await resetDb();
  clearSentEmails();
  setStripeDriverForTests(createFakeStripeDriver(() => T0));
  await importPlans(sys());
}

/** Delivers one signed webhook through the same function the endpoint calls. */
export async function send(delivery: FakeDelivery, now: Date = T0): Promise<WebhookOutcome> {
  // Signed at the moment of delivery, as Stripe does: an old event delivered late still has a fresh signature.
  return receiveStripeWebhook({ rawBody: delivery.payload, signature: redeliver(delivery, now).signature, now });
}

/** Saves the family's Stripe customer id, as `startCheckout` does before sending anyone to Stripe. */
export async function linkCustomer(familyId: string): Promise<string> {
  const customerId = fakeCustomerId(familyId);
  await db.update(family).set({ stripeCustomerId: customerId }).where(eq(family.id, familyId));
  return customerId;
}

export const PRICE = {
  monthly: "price_fake_family_monthly",
  annual: "price_fake_family_annual",
  foundingMonthly: "price_fake_family_founding_monthly",
  extraSeat: "price_fake_family_extra_seat",
} as const;

let counter = 0;

/** A monthly Family subscription that started at `T0`, active and paid. Override anything. */
export function subState(familyId: string, overrides: Partial<FakeSubscriptionState> = {}): FakeSubscriptionState {
  counter += 1;
  return {
    id: `sub_test_${counter}_${familyId.slice(0, 8)}`,
    customerId: fakeCustomerId(familyId),
    familyId,
    priceId: PRICE.monthly,
    status: "active",
    createdAt: T0,
    periodStart: T0,
    periodEnd: new Date("2026-12-16T10:00:00.000Z"),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    extraSeats: 0,
    extraSeatPriceId: PRICE.extraSeat,
    ...overrides,
  };
}

export const subEvent = (type: "created" | "updated" | "deleted" | "trial_will_end", state: FakeSubscriptionState, created: Date, id?: string): FakeDelivery =>
  fakeDelivery(`customer.subscription.${type}`, fakeSubscriptionObject(state), { created, id });

export const invoiceEvent = (type: "paid" | "payment_failed", state: FakeSubscriptionState, created: Date, opts: { amountPaidPence?: number; invoiceId?: string; id?: string } = {}): FakeDelivery =>
  fakeDelivery(`invoice.${type}`, fakeInvoiceObject({ id: opts.invoiceId, customerId: state.customerId, subscriptionId: state.id, amountPaidPence: opts.amountPaidPence ?? (type === "paid" ? 1499 : 0) }), { created, id: opts.id });

/** Links the customer and delivers `customer.subscription.created` for an active, paid subscription. */
export async function subscribe(familyId: string, overrides: Partial<FakeSubscriptionState> = {}, at: Date = T0): Promise<FakeSubscriptionState> {
  await linkCustomer(familyId);
  const state = subState(familyId, overrides);
  await send(subEvent("created", state, at), at);
  return state;
}

export const entitlementAt = (familyId: string, now: Date = T0): Promise<Entitlement> => getEntitlementForFamily(sys(now), familyId);

export const subscriptionRows = (familyId: string) => db.select().from(subscription).where(eq(subscription.familyId, familyId));
export const eventRow = async (eventId: string) => (await db.select().from(stripeEvent).where(eq(stripeEvent.eventId, eventId)))[0];
export const familyRow = async (familyId: string) => (await db.select().from(family).where(eq(family.id, familyId)))[0];
/** In-app notifications (an emailed notice also has an `email` row, which is not counted here). */
export const notificationsFor = (userId: string, type?: string) =>
  db
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), eq(notification.channel, "in_app"), type ? eq(notification.type, type) : undefined));
export const auditRows = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

/** A published course row, enough for access checks and unlock requests. */
export async function createCourse(input: { isFree?: boolean; difficulty?: "starter" | "builder" | "pro"; title?: string } = {}): Promise<{ id: string; isFree: boolean; title: string }> {
  counter += 1;
  const title = input.title ?? `Course ${counter}`;
  const [row] = await db
    .insert(course)
    .values({ slug: `course-${counter}-${Date.now()}`, title, status: "published", isFree: input.isFree ?? false, difficulty: input.difficulty ?? "starter" })
    .returning({ id: course.id, isFree: course.isFree, title: course.title });
  if (!row) throw new Error("createCourse: no row");
  return row;
}
