import { z } from "zod";

/**
 * The parts of Stripe's webhook objects that we read, and nothing else.
 *
 * These are deliberately small structural types. The real driver hands Stripe SDK objects to
 * them without a cast, so the compiler checks them against the installed `stripe` package; the
 * fake driver builds exactly these shapes and parses them back with the schemas below. One
 * handler (`services/billing-events.ts`) then serves both.
 */
const ref = z.union([z.string(), z.object({ id: z.string() })]);
const metadata = z.record(z.string(), z.string());
const unix = z.number().int().nonnegative();

export const wireSubscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer: ref,
  cancel_at_period_end: z.boolean(),
  canceled_at: unix.nullable(),
  trial_end: unix.nullable(),
  created: unix,
  metadata,
  items: z.object({
    data: z.array(
      z.object({
        price: z.object({ id: z.string() }),
        quantity: z.number().int().optional(),
        current_period_start: unix,
        current_period_end: unix,
      }),
    ),
  }),
});
export type WireSubscription = z.infer<typeof wireSubscriptionSchema>;

export const wireCheckoutSessionSchema = z.object({
  id: z.string(),
  mode: z.string(),
  customer: ref.nullable(),
  subscription: ref.nullable(),
  setup_intent: ref.nullable(),
  metadata: metadata.nullable(),
});
export type WireCheckoutSession = z.infer<typeof wireCheckoutSessionSchema>;

export const wireSetupIntentSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer: ref.nullable(),
  metadata: metadata.nullable(),
});
export type WireSetupIntent = z.infer<typeof wireSetupIntentSchema>;

export const wireInvoiceSchema = z.object({
  id: z.string(),
  customer: ref.nullable(),
  amount_paid: z.number().int(),
  attempt_count: z.number().int(),
  next_payment_attempt: unix.nullable(),
  parent: z.object({ subscription_details: z.object({ subscription: ref }).nullable() }).nullable(),
});
export type WireInvoice = z.infer<typeof wireInvoiceSchema>;

export const wireChargeSchema = z.object({
  id: z.string(),
  customer: ref.nullable(),
  amount: z.number().int(),
  amount_refunded: z.number().int(),
  refunded: z.boolean(),
});
export type WireCharge = z.infer<typeof wireChargeSchema>;

export const SUBSCRIPTION_EVENT_TYPES = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.trial_will_end"] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

type EventBase = { id: string; /** Seconds since the epoch, as Stripe sends it. */ created: number };

/** A verified webhook event, narrowed to the ones that change anything here. */
export type BillingEvent = EventBase &
  (
    | { type: "checkout.session.completed"; object: WireCheckoutSession }
    | { type: SubscriptionEventType; object: WireSubscription }
    | { type: "invoice.paid" | "invoice.payment_failed"; object: WireInvoice }
    | { type: "charge.refunded"; object: WireCharge }
    | { type: "setup_intent.succeeded"; object: WireSetupIntent }
    /** Verified, but not something we act on. Recorded as ignored. */
    | { type: "other"; rawType: string }
  );

export type HandledEventType = Exclude<BillingEvent["type"], "other">;

/** The id out of a field that Stripe sends either as an id or as an expanded object. */
export function refId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** The envelope of an event as it arrives on the wire, before its object is narrowed. */
export const wireEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: unix,
  data: z.object({ object: z.unknown() }),
});

/** Turns a parsed envelope into a `BillingEvent`. Throws a ZodError when a handled event's object is malformed. */
export function narrowWireEvent(envelope: z.infer<typeof wireEventSchema>): BillingEvent {
  const base = { id: envelope.id, created: envelope.created };
  const object = envelope.data.object;
  switch (envelope.type) {
    case "checkout.session.completed":
      return { ...base, type: envelope.type, object: wireCheckoutSessionSchema.parse(object) };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end":
      return { ...base, type: envelope.type, object: wireSubscriptionSchema.parse(object) };
    case "invoice.paid":
    case "invoice.payment_failed":
      return { ...base, type: envelope.type, object: wireInvoiceSchema.parse(object) };
    case "charge.refunded":
      return { ...base, type: envelope.type, object: wireChargeSchema.parse(object) };
    case "setup_intent.succeeded":
      return { ...base, type: envelope.type, object: wireSetupIntentSchema.parse(object) };
    default:
      return { ...base, type: "other", rawType: envelope.type };
  }
}
