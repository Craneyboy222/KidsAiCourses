import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import { WEBHOOK_TOLERANCE_SECONDS, WebhookSignatureError, type CouponInput, type CreateCheckoutInput, type CreateSetupInput, type HostedSession, type StripeDriver } from "./driver";
import { narrowWireEvent, wireEventSchema, type BillingEvent, type WireCharge, type WireCheckoutSession, type WireInvoice, type WireSetupIntent, type WireSubscription } from "./types";

/**
 * The fake Stripe driver: checkout, the portal, card checks and webhooks with no Stripe account
 * and no network. `STRIPE_DRIVER=fake` (refused in production by `src/env.ts`).
 *
 * It behaves like Stripe where it matters:
 *  - "Hosted" pages are local pages under `/dev/fake-stripe` (see `fake-simulator.ts`). A session
 *    is a signed token, so the fake keeps no state of its own and survives a restart.
 *  - Nothing changes in our database until a webhook arrives. Completing a fake checkout builds
 *    the same events Stripe would send, signs them with Stripe's own scheme
 *    (`t=<unix>,v1=<HMAC-SHA256 of "<t>.<body>">`) and delivers them to the same handler the real
 *    endpoint uses, signature check included.
 *  - The builders at the bottom double as the webhook fixtures for the tests.
 */

// ── Keys ────────────────────────────────────────────────────────────────────

/** Derived from the app secret, so a fake webhook cannot be forged by someone who has only read this file. */
function derivedKey(purpose: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`fake-stripe:${purpose}`).digest("hex");
}

export function fakeWebhookSecret(): string {
  return env.STRIPE_WEBHOOK_SECRET ?? `whsec_fake_${derivedKey("webhook")}`;
}

const hmac = (key: string, value: string): string => createHmac("sha256", key).update(value, "utf8").digest("hex");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── Webhook signatures (Stripe's scheme) ────────────────────────────────────

/** The `Stripe-Signature` header for a body. `secret` can be overridden to build a forged one in tests. */
export function signWebhookPayload(payload: string, at: Date, secret: string = fakeWebhookSecret()): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`)}`;
}

function verifyWebhookSignature(payload: string, header: string | null, now: Date): void {
  if (!header) throw new WebhookSignatureError("The webhook had no signature.");
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!Number.isInteger(timestamp) || signatures.length === 0) throw new WebhookSignatureError("The webhook signature was not in the expected form.");
  const expected = hmac(fakeWebhookSecret(), `${timestamp}.${payload}`);
  if (!signatures.some((signature) => safeEqual(signature, expected))) throw new WebhookSignatureError();
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new WebhookSignatureError("The webhook is too old to accept.");
}

// ── Sessions: signed tokens instead of stored state ─────────────────────────

const path = z.string().regex(/^\/(?!\/)[^\\\s]*$/, "Must be a path on this site");

const checkoutSessionSchema = z.object({
  kind: z.literal("subscription"),
  nonce: z.string().min(8),
  createdAt: z.number().int(),
  customerId: z.string(),
  priceId: z.string(),
  trialDays: z.number().int().min(0),
  couponId: z.string().nullable(),
  metadata: z.object({ familyId: z.string(), userId: z.string(), planKey: z.string(), promoCodeId: z.string().optional() }),
  successPath: path,
  cancelPath: path,
});
const setupSessionSchema = z.object({
  kind: z.literal("setup"),
  nonce: z.string().min(8),
  createdAt: z.number().int(),
  customerId: z.string(),
  metadata: z.object({ familyId: z.string(), userId: z.string() }),
  successPath: path,
  cancelPath: path,
});
const portalSessionSchema = z.object({
  kind: z.literal("portal"),
  nonce: z.string().min(8),
  createdAt: z.number().int(),
  customerId: z.string(),
  returnPath: path,
});
const sessionSchema = z.discriminatedUnion("kind", [checkoutSessionSchema, setupSessionSchema, portalSessionSchema]);

export type FakeCheckoutSession = z.infer<typeof checkoutSessionSchema>;
export type FakeSetupSession = z.infer<typeof setupSessionSchema>;
export type FakePortalSession = z.infer<typeof portalSessionSchema>;
export type FakeSession = z.infer<typeof sessionSchema>;

const SESSION_PREFIX = "fs_fake_";
/** Stripe Checkout sessions last 24 hours. */
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function encodeSession(session: FakeSession): string {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${SESSION_PREFIX}${body}.${hmac(derivedKey("session"), body)}`;
}

/** Reads a session id made by this driver. `null` when it is forged, malformed or more than a day old. */
export function readFakeSession(id: string, now: Date): FakeSession | null {
  if (!id.startsWith(SESSION_PREFIX)) return null;
  const [body, signature] = id.slice(SESSION_PREFIX.length).split(".");
  if (!body || !signature || !safeEqual(signature, hmac(derivedKey("session"), body))) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    if (Math.floor(now.getTime() / 1000) - parsed.data.createdAt > SESSION_TTL_SECONDS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);
const nonce = (): string => randomUUID().replace(/-/g, "");

export const FAKE_CHECKOUT_PATH = "/dev/fake-stripe/checkout";
export const FAKE_PORTAL_PATH = "/dev/fake-stripe/portal";

/** The fake's customer id for a family: always the same, so creating it twice is harmless. */
export const fakeCustomerId = (familyId: string): string => `cus_fake_${familyId.replace(/-/g, "")}`;

// ── The driver ──────────────────────────────────────────────────────────────

export function createFakeStripeDriver(clock: () => Date = () => new Date()): StripeDriver {
  const hosted = (session: FakeSession, page: string): HostedSession => {
    const id = encodeSession(session);
    return { id, url: `${page}?session=${encodeURIComponent(id)}` };
  };
  return {
    name: "fake",

    async createCustomer({ familyId }) {
      return { customerId: fakeCustomerId(familyId) };
    },

    async createCheckoutSession(input: CreateCheckoutInput) {
      return hosted(
        {
          kind: "subscription",
          nonce: nonce(),
          createdAt: seconds(clock()),
          customerId: input.customerId,
          priceId: input.priceId,
          trialDays: input.trialDays,
          couponId: input.couponId ?? null,
          metadata: input.metadata,
          successPath: input.successPath,
          cancelPath: input.cancelPath,
        },
        FAKE_CHECKOUT_PATH,
      );
    },

    async createSetupSession(input: CreateSetupInput) {
      return hosted({ kind: "setup", nonce: nonce(), createdAt: seconds(clock()), customerId: input.customerId, metadata: input.metadata, successPath: input.successPath, cancelPath: input.cancelPath }, FAKE_CHECKOUT_PATH);
    },

    async createPortalSession({ customerId, returnPath }) {
      return { url: hosted({ kind: "portal", nonce: nonce(), createdAt: seconds(clock()), customerId, returnPath }, FAKE_PORTAL_PATH).url };
    },

    async createCoupon(input: CouponInput) {
      return { couponId: `coupon_fake_${input.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` };
    },

    async deleteCoupon() {
      // Nothing is stored, so there is nothing to delete.
    },

    async updateTrialEnd({ subscriptionId, trialEnd }) {
      // Like Stripe: the change comes back to us as a webhook, and only that changes our records.
      const { simulateSubscriptionChange } = await import("./fake-simulator");
      await simulateSubscriptionChange(subscriptionId, { kind: "trial_end", trialEnd }, clock());
    },

    async cancelSubscription({ subscriptionId }) {
      const { simulateSubscriptionChange } = await import("./fake-simulator");
      await simulateSubscriptionChange(subscriptionId, { kind: "cancel_now" }, clock());
    },

    constructEvent(rawBody: string, signatureHeader: string | null, now: Date): BillingEvent {
      verifyWebhookSignature(rawBody, signatureHeader, now);
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new WebhookSignatureError("The webhook body was not JSON.");
      }
      return narrowWireEvent(wireEventSchema.parse(json));
    },
  };
}

// ── Event builders: what Stripe would send. Also the test fixtures. ─────────

/** A signed webhook, ready to hand to `receiveStripeWebhook` or to POST to `/api/webhooks/stripe`. */
export type FakeDelivery = { eventId: string; type: string; payload: string; signature: string };

/**
 * Builds and signs one webhook. `created` is the event's own time; `sentAt` is when it is
 * delivered (signatures are only accepted for five minutes), which differs for a late delivery.
 */
export function fakeDelivery(type: string, object: unknown, options: { created: Date; id?: string; sentAt?: Date; secret?: string }): FakeDelivery {
  const eventId = options.id ?? `evt_fake_${nonce()}`;
  const payload = JSON.stringify({ id: eventId, object: "event", type, created: seconds(options.created), livemode: false, data: { object } });
  return { eventId, type, payload, signature: signWebhookPayload(payload, options.sentAt ?? options.created, options.secret) };
}

/** Signs the same event again for a later delivery, as Stripe does when it retries. */
export function redeliver(delivery: FakeDelivery, sentAt: Date): FakeDelivery {
  return { ...delivery, signature: signWebhookPayload(delivery.payload, sentAt) };
}

export type FakeSubscriptionState = {
  id: string;
  customerId: string;
  familyId: string;
  priceId: string;
  status: string;
  createdAt: Date;
  periodStart: Date;
  periodEnd: Date;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  extraSeats: number;
  /** Needed only when `extraSeats` is above 0. */
  extraSeatPriceId: string | null;
};

export function fakeSubscriptionObject(state: FakeSubscriptionState): WireSubscription {
  const period = { current_period_start: seconds(state.periodStart), current_period_end: seconds(state.periodEnd) };
  return {
    id: state.id,
    status: state.status,
    customer: state.customerId,
    cancel_at_period_end: state.cancelAtPeriodEnd,
    canceled_at: state.canceledAt ? seconds(state.canceledAt) : null,
    trial_end: state.trialEnd ? seconds(state.trialEnd) : null,
    created: seconds(state.createdAt),
    metadata: { familyId: state.familyId },
    items: {
      data: [
        { price: { id: state.priceId }, quantity: 1, ...period },
        ...(state.extraSeats > 0 && state.extraSeatPriceId ? [{ price: { id: state.extraSeatPriceId }, quantity: state.extraSeats, ...period }] : []),
      ],
    },
  };
}

export function fakeInvoiceObject(input: { id?: string; customerId: string; subscriptionId: string | null; amountPaidPence: number; attemptCount?: number; nextAttempt?: Date | null }): WireInvoice {
  return {
    id: input.id ?? `in_fake_${nonce()}`,
    customer: input.customerId,
    amount_paid: input.amountPaidPence,
    attempt_count: input.attemptCount ?? 1,
    next_payment_attempt: input.nextAttempt ? seconds(input.nextAttempt) : null,
    parent: input.subscriptionId ? { subscription_details: { subscription: input.subscriptionId } } : null,
  };
}

export function fakeCheckoutSessionObject(input: {
  id: string;
  mode: "subscription" | "setup";
  customerId: string;
  subscriptionId?: string | null;
  setupIntentId?: string | null;
  metadata: Record<string, string>;
}): WireCheckoutSession {
  return { id: input.id, mode: input.mode, customer: input.customerId, subscription: input.subscriptionId ?? null, setup_intent: input.setupIntentId ?? null, metadata: input.metadata };
}

export function fakeSetupIntentObject(input: { id?: string; customerId: string; familyId: string; status?: string }): WireSetupIntent {
  return { id: input.id ?? `seti_fake_${nonce()}`, status: input.status ?? "succeeded", customer: input.customerId, metadata: { familyId: input.familyId } };
}

export function fakeChargeObject(input: { id?: string; customerId: string; amountPence: number; refundedPence: number }): WireCharge {
  return { id: input.id ?? `ch_fake_${nonce()}`, customer: input.customerId, amount: input.amountPence, amount_refunded: input.refundedPence, refunded: input.refundedPence >= input.amountPence };
}
