import Stripe from "stripe";
import { env } from "@/env";
import { AppError } from "@/server/errors";
import { WEBHOOK_TOLERANCE_SECONDS, WebhookSignatureError, type StripeDriver } from "./driver";
import type { BillingEvent } from "./types";

/**
 * The real driver: the `stripe` SDK (v23, API version pinned by the package).
 *
 * NOT EXERCISED YET. No Stripe account exists, so nothing here has run against Stripe, in test
 * mode or otherwise. It is written against the installed package's types and type-checks; the
 * first run with test keys should follow docs/OPEN_QUESTIONS.md ("Payments") before it is trusted.
 *
 * Card details are typed on pages Stripe hosts (Checkout and the Customer Portal). This file
 * only ever sends and receives ids.
 */
const absolute = (path: string): string => `${env.NEXT_PUBLIC_APP_URL}${path}`;
const unix = (date: Date): number => Math.floor(date.getTime() / 1000);

function notConfigured(what: string): AppError {
  return new AppError("not_ready", "Payments aren't switched on yet. Nothing has been charged. Please try again later.", { status: 503, detail: { missing: what } });
}

export function createRealStripeDriver(): StripeDriver {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) throw notConfigured("STRIPE_SECRET_KEY");
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: "platform" } });

  return {
    name: "stripe",

    async createCustomer({ familyId, email, name }) {
      const customer = await stripe.customers.create(
        { ...(email ? { email } : {}), ...(name ? { name } : {}), metadata: { familyId } },
        // Two requests at once for the same family get the same customer back.
        { idempotencyKey: `family-customer:${familyId}` },
      );
      return { customerId: customer.id };
    },

    async createCheckoutSession(input) {
      const metadata: Record<string, string> = { ...input.metadata };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.metadata.familyId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        // A card is always collected, including at the start of a trial (spec 3.7).
        payment_method_collection: "always",
        subscription_data: { metadata, ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}) },
        ...(input.couponId ? { discounts: [{ coupon: input.couponId }] } : {}),
        metadata,
        success_url: absolute(input.successPath),
        cancel_url: absolute(input.cancelPath),
      });
      if (!session.url) throw new AppError("internal", "The payment page could not be opened. Nothing has been charged. Try again in a moment.");
      return { id: session.id, url: session.url };
    },

    async createSetupSession(input) {
      const metadata: Record<string, string> = { ...input.metadata };
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: input.customerId,
        client_reference_id: input.metadata.familyId,
        allowed_payment_method_types: ["card"],
        currency: "gbp",
        setup_intent_data: { metadata },
        metadata,
        success_url: absolute(input.successPath),
        cancel_url: absolute(input.cancelPath),
      });
      if (!session.url) throw new AppError("internal", "The card check page could not be opened. Try again in a moment.");
      return { id: session.id, url: session.url };
    },

    async createPortalSession({ customerId, returnPath }) {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: absolute(returnPath) });
      return { url: session.url };
    },

    async createCoupon(input) {
      const coupon = await stripe.coupons.create({
        name: input.code.slice(0, 40),
        duration: "once",
        ...(input.percentOff ? { percent_off: input.percentOff } : {}),
        ...(input.amountOffPence ? { amount_off: input.amountOffPence, currency: "gbp" } : {}),
        ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
        ...(input.expiresAt ? { redeem_by: unix(input.expiresAt) } : {}),
        metadata: { code: input.code },
      });
      return { couponId: coupon.id };
    },

    async deleteCoupon(couponId) {
      await stripe.coupons.del(couponId);
    },

    async updateTrialEnd({ subscriptionId, trialEnd }) {
      await stripe.subscriptions.update(subscriptionId, { trial_end: unix(trialEnd), proration_behavior: "none" });
    },

    async cancelSubscription({ subscriptionId }) {
      await stripe.subscriptions.cancel(subscriptionId);
    },

    constructEvent(rawBody, signatureHeader, now): BillingEvent {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw notConfigured("STRIPE_WEBHOOK_SECRET");
      if (!signatureHeader) throw new WebhookSignatureError("The webhook had no signature.");
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signatureHeader, secret, WEBHOOK_TOLERANCE_SECONDS, undefined, unix(now));
      } catch (error) {
        throw new WebhookSignatureError(error instanceof Error ? error.message : undefined);
      }
      const base = { id: event.id, created: event.created };
      // Each case hands a Stripe SDK object to our own narrow type with no cast: if a field we
      // read moves or changes type in a later SDK version, this stops compiling.
      switch (event.type) {
        case "checkout.session.completed":
          return { ...base, type: event.type, object: event.data.object };
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
        case "customer.subscription.trial_will_end":
          return { ...base, type: event.type, object: event.data.object };
        case "invoice.paid":
        case "invoice.payment_failed":
          return { ...base, type: event.type, object: event.data.object };
        case "charge.refunded":
          return { ...base, type: event.type, object: event.data.object };
        case "setup_intent.succeeded":
          return { ...base, type: event.type, object: event.data.object };
        default:
          return { ...base, type: "other", rawType: event.type };
      }
    },
  };
}
