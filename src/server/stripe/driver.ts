import type { BillingEvent } from "./types";

/**
 * Everything the product asks of Stripe, behind one interface (docs/ARCHITECTURE.md, "Providers
 * behind adapters"). Two implementations: `real.ts` (the `stripe` SDK) and `fake.ts` (no account,
 * no network: local development and tests).
 *
 * Card details never pass through here or through our servers at all: the person types them on a
 * page that Stripe hosts, and we only ever receive ids.
 */
export type CheckoutMetadata = {
  familyId: string;
  userId: string;
  planKey: string;
  /** `promo_code.id` when a code was applied. */
  promoCodeId?: string;
};

export type CreateCheckoutInput = {
  customerId: string;
  /** The plan's Stripe price. */
  priceId: string;
  /** Card required at the start of a trial (spec 3.7). 0 for no trial. */
  trialDays: number;
  /** A Stripe coupon to apply to the first payment. */
  couponId?: string | null;
  metadata: CheckoutMetadata;
  /** Paths on our own site, e.g. `/parent/billing?checkout=success`. */
  successPath: string;
  cancelPath: string;
};

export type CreateSetupInput = {
  customerId: string;
  metadata: { familyId: string; userId: string };
  successPath: string;
  cancelPath: string;
};

export type HostedSession = {
  id: string;
  /** Where to send the browser. Absolute for Stripe; a path on this site for the fake. */
  url: string;
};

export type CouponInput = {
  /** Our own code, used as the coupon's name in Stripe's dashboard. */
  code: string;
  percentOff?: number | null;
  amountOffPence?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
};

export interface StripeDriver {
  readonly name: "fake" | "stripe";

  /** Creates the Stripe customer for a family. Safe to call twice for the same family. */
  createCustomer(input: { familyId: string; email: string | null; name: string | null }): Promise<{ customerId: string }>;

  /** Stripe Checkout in subscription mode. */
  createCheckoutSession(input: CreateCheckoutInput): Promise<HostedSession>;

  /** Stripe Checkout in setup mode: a SetupIntent that checks a card and takes no money (age assurance on Free). */
  createSetupSession(input: CreateSetupInput): Promise<HostedSession>;

  /** The Stripe Customer Portal: change plan, update card, cancel, invoices. */
  createPortalSession(input: { customerId: string; returnPath: string }): Promise<{ url: string }>;

  createCoupon(input: CouponInput): Promise<{ couponId: string }>;
  deleteCoupon(couponId: string): Promise<void>;

  /** Admin exception: moves the end of a trial. Stripe then sends `customer.subscription.updated`. */
  updateTrialEnd(input: { subscriptionId: string; trialEnd: Date }): Promise<void>;

  /** Ends a subscription now (account deletion). Stripe then sends `customer.subscription.deleted`. */
  cancelSubscription(input: { subscriptionId: string }): Promise<void>;

  /**
   * Verifies the signature of a webhook body and returns the event. Throws `WebhookSignatureError`
   * when the signature is missing, wrong or too old. `now` is the clock for the age check.
   */
  constructEvent(rawBody: string, signatureHeader: string | null, now: Date): BillingEvent;
}

/** The webhook body did not come from Stripe (or is a replay of an old one). Answered with 400. */
export class WebhookSignatureError extends Error {
  constructor(message = "The webhook signature could not be verified.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/** Events older than this are refused even with a good signature, the same window Stripe's own library uses. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
