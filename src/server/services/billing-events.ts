import { randomUUID } from "node:crypto";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { formatDate } from "@/lib/dates";
import { audit } from "@/server/audit";
import { systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { db as rootDb } from "@/server/db/client";
import { family, stripeEvent, subscription } from "@/server/db";
import { logError, logInfo, logWarn } from "@/server/log";
import { getSetting } from "@/server/settings/store";
import { getStripeDriver, refId, type BillingEvent, type HandledEventType, type WireCharge, type WireCheckoutSession, type WireInvoice, type WireSetupIntent, type WireSubscription } from "@/server/stripe";
import { recordAgeAssurance } from "./age-assurance";
import { PLAN_ENDED_NOTE, notifyBillingContacts, syncFamilyPlan, type BillingNotice } from "./billing";
import { getEntitlementForFamily, type Entitlement } from "./entitlements";
import { FREE_PLAN_KEY, findPlanByPriceId, intervalOf, isFoundingVariant, type PlanRow, type PriceVariant } from "./plans";
import { recordPromoRedemption } from "./promo";
import { notifyPaidUnlocks, resolvePaidUnlocksForFamily } from "./unlock-requests";

/**
 * Stripe webhooks: the only thing that changes what a family is entitled to (spec 3.7).
 *
 *  1. The signature is verified before anything is read (`driver.constructEvent`). A body that
 *     fails is refused and nothing is stored.
 *  2. Every event is recorded in `stripe_event` under its unique id, in the same transaction as
 *     the change it causes. A repeat of an event that was handled does nothing; a repeat of one
 *     that failed is tried again.
 *  3. `subscription` mirrors Stripe. Each row remembers the `created` time of the newest event
 *     applied to it (`last_event_at`); an older event arriving late is recorded and skipped, so
 *     out-of-order delivery can never roll a family back to an earlier state.
 *  4. Messages to the family are sent after the change is saved, each with a key that stops a
 *     retried event sending it twice.
 *
 * Handled: checkout.session.completed, customer.subscription.created / updated / deleted /
 * trial_will_end, invoice.paid, invoice.payment_failed, charge.refunded, setup_intent.succeeded.
 * Anything else is recorded as ignored.
 */

export type WebhookOutcome = {
  /** `duplicate`: we had already handled this event id. `ignored`: verified, but nothing for us to do. */
  status: "processed" | "duplicate" | "ignored";
  eventId: string;
  type: string;
  /** Why nothing changed, when that is the case (for example `stale` for an out-of-order event). */
  note?: string;
};

/** Something to do after the change is safely saved: a message to the family. Never fails the webhook. */
type Effect = (ctx: Pick<Ctx, "db" | "now">) => Promise<void>;
type Applied = { effects: Effect[]; ignored?: boolean; note?: string };

type TxCtx = Ctx;

const at = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

/**
 * The entry point for `/api/webhooks/stripe`, and for the fake driver's deliveries. `rawBody` must
 * be the exact bytes received: the signature covers them.
 * Throws `WebhookSignatureError` for a bad signature; any other error means "try again later".
 */
export async function receiveStripeWebhook(input: { rawBody: string; signature: string | null; now?: Date; requestId?: string }): Promise<WebhookOutcome> {
  const now = input.now ?? new Date();
  const driver = await getStripeDriver();
  const event = driver.constructEvent(input.rawBody, input.signature, now);
  const type = event.type === "other" ? event.rawType : event.type;
  const base = { now, requestId: input.requestId ?? `stripe:${event.id}:${randomUUID()}`, actor: systemActor("stripe.webhook") };

  let outcome: { result: WebhookOutcome; effects: Effect[] };
  try {
    outcome = await rootDb.transaction(async (tx) => {
      const ctx: TxCtx = { ...base, db: tx };
      const inserted = await tx
        .insert(stripeEvent)
        .values({ eventId: event.id, type, status: "received", eventCreatedAt: at(event.created), attempts: 1, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: stripeEvent.eventId })
        .returning({ id: stripeEvent.id });
      // Two deliveries of one event at the same moment queue here: the second waits, then sees the first one's result.
      const [row] = await tx.select().from(stripeEvent).where(eq(stripeEvent.eventId, event.id)).limit(1).for("update");
      if (!row) throw new Error("stripe_event row missing straight after insert");
      if (inserted.length === 0) {
        if (row.status === "processed" || row.status === "ignored") return { result: { status: "duplicate" as const, eventId: event.id, type }, effects: [] };
        await tx.update(stripeEvent).set({ attempts: row.attempts + 1, updatedAt: now }).where(eq(stripeEvent.id, row.id));
      }

      const applied: Applied = event.type === "other" ? { effects: [], ignored: true, note: "unhandled type" } : await applyEvent(ctx, event);
      const status = applied.ignored ? ("ignored" as const) : ("processed" as const);
      await tx
        .update(stripeEvent)
        .set({ status, processedAt: now, error: applied.note ?? null, updatedAt: now })
        .where(eq(stripeEvent.id, row.id));
      return { result: { status, eventId: event.id, type, ...(applied.note ? { note: applied.note } : {}) }, effects: applied.effects };
    });
  } catch (error) {
    // The transaction rolled back, so nothing changed. Leave a record of the failure for Studio; Stripe will retry.
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    try {
      await rootDb
        .insert(stripeEvent)
        .values({ eventId: event.id, type, status: "failed", eventCreatedAt: at(event.created), attempts: 1, error: message, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: stripeEvent.eventId,
          set: { status: "failed", attempts: sql`${stripeEvent.attempts} + 1`, error: message, updatedAt: now },
          setWhere: notInArray(stripeEvent.status, ["processed", "ignored"]),
        });
    } catch (recordError) {
      logError("stripe.webhook.record_failure_failed", recordError, { eventId: event.id });
    }
    logError("stripe.webhook.failed", error, { eventId: event.id, type });
    throw error;
  }

  for (const effect of outcome.effects) {
    try {
      await effect({ db: rootDb, now });
    } catch (error) {
      logError("stripe.webhook.effect_failed", error, { eventId: event.id, type });
    }
  }
  if (outcome.result.status !== "duplicate") logInfo("stripe.webhook.handled", { eventId: event.id, type, status: outcome.result.status, note: outcome.result.note });
  return outcome.result;
}

type HandledEvent = Extract<BillingEvent, { type: HandledEventType }>;

async function applyEvent(ctx: TxCtx, event: HandledEvent): Promise<Applied> {
  switch (event.type) {
    case "checkout.session.completed":
      return applyCheckoutCompleted(ctx, event, event.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end":
      return applySubscription(ctx, event, event.type, event.object);
    case "invoice.paid":
      return applyInvoicePaid(ctx, event, event.object);
    case "invoice.payment_failed":
      return applyInvoiceFailed(ctx, event, event.object);
    case "charge.refunded":
      return applyRefund(ctx, event, event.object);
    case "setup_intent.succeeded":
      return applySetupIntent(ctx, event, event.object);
  }
}

// ── Which family? ───────────────────────────────────────────────────────────

type FamilyRef = { id: string; stripeCustomerId: string | null };

/**
 * The family a Stripe object belongs to: by its customer id, which we saved before sending anyone
 * to Stripe; else by the `familyId` we put in the object's metadata, in which case the customer is
 * linked now. A family already linked to a different customer is never re-linked.
 */
async function findFamily(ctx: TxCtx, customerId: string | null, metadataFamilyId: string | null | undefined): Promise<FamilyRef | null> {
  if (customerId) {
    const [byCustomer] = await ctx.db.select({ id: family.id, stripeCustomerId: family.stripeCustomerId }).from(family).where(eq(family.stripeCustomerId, customerId)).limit(1);
    if (byCustomer) return byCustomer;
  }
  if (!metadataFamilyId || !/^[0-9a-f-]{36}$/i.test(metadataFamilyId)) return null;
  const [byId] = await ctx.db.select({ id: family.id, stripeCustomerId: family.stripeCustomerId }).from(family).where(eq(family.id, metadataFamilyId)).limit(1);
  if (!byId) return null;
  if (byId.stripeCustomerId && customerId && byId.stripeCustomerId !== customerId) {
    logWarn("stripe.webhook.customer_mismatch", { familyId: byId.id });
    return null;
  }
  if (!byId.stripeCustomerId && customerId) {
    await ctx.db
      .update(family)
      .set({ stripeCustomerId: customerId, updatedAt: ctx.now })
      .where(and(eq(family.id, byId.id), isNull(family.stripeCustomerId)));
    return { id: byId.id, stripeCustomerId: customerId };
  }
  return byId;
}

const unmatched = (what: string): Applied => ({ effects: [], ignored: true, note: `no family for ${what}` });

// ── Entitlement changes, in one place ───────────────────────────────────────

/**
 * Call after a write to `subscription`. Updates the `family.plan` cache, audits the change and
 * returns the messages to send: the plan has started (and any course a learner asked about is now
 * open), or the plan has ended.
 */
async function afterSubscriptionWrite(ctx: TxCtx, familyId: string, before: Entitlement, eventId: string): Promise<Effect[]> {
  const change = await syncFamilyPlan(ctx, familyId, { eventId });
  const after = change?.entitlement ?? (await getEntitlementForFamily(ctx, familyId));
  const effects: Effect[] = [];

  if (!before.fullCatalogue && after.fullCatalogue) {
    const opened = await resolvePaidUnlocksForFamily(ctx, familyId);
    effects.push(async (post) => {
      await notifyBillingContacts(post, familyId, {
        type: "billing.plan_started",
        title: after.status === "trialing" ? "Your free trial has started" : "Your plan is on",
        body: "Every course in the catalogue is now open to your family. You can change or cancel your plan at any time from Billing.",
        dedupeKey: `billing-started:${eventId}`,
      });
      await notifyPaidUnlocks(post, opened);
    });
  }
  if (before.planKey !== FREE_PLAN_KEY && after.planKey === FREE_PLAN_KEY) {
    const lapsed = after.status === "past_due";
    effects.push(async (post) =>
      notifyBillingContacts(post, familyId, {
        type: "billing.plan_ended",
        title: "Your plan has ended",
        body: lapsed ? `We couldn't take your payment, so your plan has ended. ${PLAN_ENDED_NOTE} Update your card to pick up where you left off.` : `Your plan has ended. ${PLAN_ENDED_NOTE}`,
        emailTemplate: "billing_plan_ended",
        dedupeKey: `billing-ended:${eventId}`,
      }),
    );
  }
  return effects;
}

// ── customer.subscription.* ─────────────────────────────────────────────────

type SubscriptionRow = typeof subscription.$inferSelect;

/**
 * True when the event is older than what the row already reflects. Stripe's `created` is in whole
 * seconds, so two events can tie: a tie is applied (the snapshots agree or the later one wins),
 * except that a `created` event never overwrites anything and nothing revives an ended subscription.
 */
function isStale(existing: SubscriptionRow | undefined, eventAt: Date, opts: { isCreated: boolean; isDeleted: boolean }): boolean {
  if (!existing?.lastEventAt) return false;
  const last = existing.lastEventAt.getTime();
  if (eventAt.getTime() < last) return true;
  if (eventAt.getTime() > last) return false;
  if (opts.isDeleted) return false;
  return opts.isCreated || existing.status === "canceled";
}

async function resolveItems(ctx: TxCtx, sub: WireSubscription): Promise<{ main: { plan: PlanRow; variant: PriceVariant; priceId: string; periodStart: Date; periodEnd: Date }; extraSeats: number }> {
  let main: { plan: PlanRow; variant: PriceVariant; priceId: string; periodStart: Date; periodEnd: Date } | null = null;
  let extraSeats = 0;
  for (const item of sub.items.data) {
    const resolved = await findPlanByPriceId(ctx, item.price.id);
    if (!resolved) continue;
    if (resolved.variant === "extra_seat") extraSeats += Math.max(0, item.quantity ?? 1);
    else main ??= { plan: resolved.plan, variant: resolved.variant, priceId: item.price.id, periodStart: at(item.current_period_start), periodEnd: at(item.current_period_end) };
  }
  // Thrown, not ignored: the event is recorded as failed and Stripe retries, so saving the missing
  // price id on the plan in Studio is enough to put it right.
  if (!main) throw new Error(`No plan uses any Stripe price on subscription ${sub.id}. Save the price ids on the plan in Studio.`);
  return { main, extraSeats };
}

async function applySubscription(ctx: TxCtx, event: { id: string; created: number }, type: HandledEventType, sub: WireSubscription): Promise<Applied> {
  const fam = await findFamily(ctx, refId(sub.customer), sub.metadata.familyId);
  if (!fam) return unmatched("subscription");

  const eventAt = at(event.created);
  const isDeleted = type === "customer.subscription.deleted";
  const [existing] = await ctx.db.select().from(subscription).where(eq(subscription.stripeSubscriptionId, sub.id)).limit(1).for("update");

  const effects: Effect[] = [];
  if (type === "customer.subscription.trial_will_end" && sub.trial_end) {
    const date = formatDate(at(sub.trial_end));
    effects.push(async (post) =>
      notifyBillingContacts(post, fam.id, {
        type: "billing.trial_ending",
        title: `Your free trial ends on ${date}`,
        body: `Your first payment is taken on ${date}, using the card you gave at the start. If you'd rather not carry on, cancel before then from Billing and you won't be charged.`,
        emailTemplate: "billing_trial_ending",
        emailData: { date },
        dedupeKey: `billing-trial-ending:${event.id}`,
      }),
    );
  }
  if (isStale(existing, eventAt, { isCreated: type === "customer.subscription.created", isDeleted })) return { effects, note: "stale" };

  const { main, extraSeats } = await resolveItems(ctx, sub);
  const status = isDeleted ? "canceled" : sub.status;
  const founding = isFoundingVariant(main.variant);
  const lockMonths = main.plan.foundingLockMonths ?? 12;
  const created = at(sub.created);
  const before = await getEntitlementForFamily(ctx, fam.id);

  const values = {
    familyId: fam.id,
    planId: main.plan.id,
    stripePriceId: main.priceId,
    status,
    interval: intervalOf(main.variant),
    extraSeats,
    isFounding: founding,
    foundingLockedUntil: founding ? new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + lockMonths, created.getUTCDate())) : null,
    trialEndsAt: sub.trial_end ? at(sub.trial_end) : null,
    currentPeriodStart: main.periodStart,
    currentPeriodEnd: main.periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? at(sub.canceled_at) : isDeleted ? eventAt : null,
    pastDueSince: status === "past_due" ? (existing?.pastDueSince ?? eventAt) : null,
    lastEventAt: eventAt,
    updatedAt: ctx.now,
  };
  if (existing) await ctx.db.update(subscription).set(values).where(eq(subscription.id, existing.id));
  else await ctx.db.insert(subscription).values({ ...values, stripeSubscriptionId: sub.id, createdAt: ctx.now });

  // A card was collected to start the trial; a payment has been made once the plan is active (spec 3.1).
  if (status === "trialing") await recordAgeAssurance(ctx, fam.id, "card_authorisation");
  if (status === "active") await recordAgeAssurance(ctx, fam.id, "paid_subscription");

  effects.push(...(await afterSubscriptionWrite(ctx, fam.id, before, event.id)));

  if (!isDeleted && sub.cancel_at_period_end && existing && !existing.cancelAtPeriodEnd) {
    const date = formatDate(main.periodEnd);
    effects.push(async (post) =>
      notifyBillingContacts(post, fam.id, {
        type: "billing.cancel_scheduled",
        title: `Your plan will end on ${date}`,
        body: `You've cancelled your plan. Your family keeps everything it has now until ${date}, then moves to the Free plan. Finished projects and certificates are kept. You can change your mind before then from Billing.`,
        dedupeKey: `billing-cancel-scheduled:${event.id}`,
      }),
    );
  }
  return { effects };
}

// ── invoice.* ───────────────────────────────────────────────────────────────

async function lockSubscription(ctx: TxCtx, invoice: WireInvoice): Promise<SubscriptionRow | undefined> {
  const subscriptionId = refId(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return undefined;
  const [row] = await ctx.db.select().from(subscription).where(eq(subscription.stripeSubscriptionId, subscriptionId)).limit(1).for("update");
  return row;
}

async function applyInvoicePaid(ctx: TxCtx, event: { id: string; created: number }, invoice: WireInvoice): Promise<Applied> {
  const fam = await findFamily(ctx, refId(invoice.customer), null);
  if (!fam) return unmatched("invoice");
  // Money has actually been taken with an adult's card. A £0 invoice at the start of a trial does not count.
  if (invoice.amount_paid > 0) await recordAgeAssurance(ctx, fam.id, "paid_subscription");

  const row = await lockSubscription(ctx, invoice);
  const eventAt = at(event.created);
  // The subscription's own events carry its state. The one thing a paid invoice settles by itself
  // is an overdue payment, in case the "updated" event is late or lost.
  if (!row || row.status !== "past_due" || (row.lastEventAt && eventAt < row.lastEventAt)) return { effects: [] };

  const before = await getEntitlementForFamily(ctx, fam.id);
  await ctx.db.update(subscription).set({ status: "active", pastDueSince: null, lastEventAt: eventAt, updatedAt: ctx.now }).where(eq(subscription.id, row.id));
  const effects = await afterSubscriptionWrite(ctx, fam.id, before, event.id);
  effects.push(async (post) =>
    notifyBillingContacts(post, fam.id, {
      type: "billing.payment_recovered",
      title: "Payment received, thank you",
      body: "Your payment has gone through and your plan carries on as normal.",
      dedupeKey: `billing-recovered:${event.id}`,
    }),
  );
  return { effects };
}

async function applyInvoiceFailed(ctx: TxCtx, event: { id: string; created: number }, invoice: WireInvoice): Promise<Applied> {
  const fam = await findFamily(ctx, refId(invoice.customer), null);
  if (!fam) return unmatched("invoice");
  const row = await lockSubscription(ctx, invoice);
  const eventAt = at(event.created);
  if (!row) return { effects: [], note: "no subscription yet" };
  if (row.lastEventAt && eventAt < row.lastEventAt) return { effects: [], note: "stale" };
  if (row.status === "canceled") return { effects: [], note: "subscription ended" };

  const before = await getEntitlementForFamily(ctx, fam.id);
  const pastDueSince = row.pastDueSince ?? eventAt;
  if (row.status === "active" || row.status === "trialing" || (row.status === "past_due" && !row.pastDueSince)) {
    await ctx.db.update(subscription).set({ status: "past_due", pastDueSince, lastEventAt: eventAt, updatedAt: ctx.now }).where(eq(subscription.id, row.id));
  }
  const effects = await afterSubscriptionWrite(ctx, fam.id, before, event.id);

  const graceDays = await getSetting(ctx, "site.payment_grace_days");
  const graceDate = formatDate(new Date(pastDueSince.getTime() + graceDays * 24 * 60 * 60 * 1000));
  const notice: BillingNotice = {
    type: "billing.payment_failed",
    title: "Your payment didn't go through",
    body: `We couldn't take the payment for your plan. Nothing changes until ${graceDate}: update your card from Billing before then to keep your plan. After that your family moves to the Free plan, and nothing is deleted.`,
    emailTemplate: "billing_payment_failed",
    emailData: { graceDate },
    urgent: true,
    // One message per failed invoice, however many times Stripe retries it.
    dedupeKey: `billing-payment-failed:${invoice.id}`,
  };
  effects.push(async (post) => notifyBillingContacts(post, fam.id, notice));
  return { effects };
}

// ── charge.refunded ─────────────────────────────────────────────────────────

/**
 * A refund is recorded and the family is told. It does not, by itself, end a plan: a refund can
 * be for a duplicate charge on a plan that should carry on. To end the plan as well, cancel the
 * subscription in Stripe, which arrives here as `customer.subscription.deleted`.
 */
async function applyRefund(ctx: TxCtx, event: { id: string; created: number }, charge: WireCharge): Promise<Applied> {
  const fam = await findFamily(ctx, refId(charge.customer), null);
  if (!fam) return unmatched("charge");
  await audit(ctx, { action: "billing.refund", targetType: "family", targetId: fam.id, meta: { chargeId: charge.id, amountPence: charge.amount, refundedPence: charge.amount_refunded, full: charge.refunded, eventId: event.id } });
  return {
    effects: [
      async (post) =>
        notifyBillingContacts(post, fam.id, {
          type: "billing.refund",
          title: "A refund is on its way",
          body: "We've sent a refund to the card you paid with. It usually takes 5 to 10 working days to show on your statement.",
          dedupeKey: `billing-refund:${charge.id}:${charge.amount_refunded}`,
        }),
    ],
  };
}

// ── setup_intent.succeeded and checkout.session.completed ───────────────────

const cardCheckedNotice = (key: string): BillingNotice => ({
  type: "billing.card_checked",
  title: "Card check complete",
  body: "Thanks. Your card has been checked and nothing was charged. Coach is now available to your child, as long as their permissions are complete.",
  dedupeKey: `billing-card-checked:${key}`,
});

async function applySetupIntent(ctx: TxCtx, _event: { id: string }, intent: WireSetupIntent): Promise<Applied> {
  if (intent.status !== "succeeded") return { effects: [], note: `setup intent ${intent.status}` };
  const fam = await findFamily(ctx, refId(intent.customer), intent.metadata?.familyId);
  if (!fam) return unmatched("setup intent");
  const [beforeRow] = await ctx.db.select({ level: family.ageAssuranceLevel }).from(family).where(eq(family.id, fam.id)).limit(1);
  await recordAgeAssurance(ctx, fam.id, "card_authorisation");
  if (beforeRow?.level !== "none" && beforeRow?.level !== "parent_email") return { effects: [] };
  // Keyed on the family, so the checkout event for the same card check does not send it again.
  return { effects: [async (post) => notifyBillingContacts(post, fam.id, cardCheckedNotice(fam.id))] };
}

async function applyCheckoutCompleted(ctx: TxCtx, _event: { id: string }, session: WireCheckoutSession): Promise<Applied> {
  const fam = await findFamily(ctx, refId(session.customer), session.metadata?.familyId);
  if (!fam) return unmatched("checkout session");

  if (session.mode === "setup") {
    const [beforeRow] = await ctx.db.select({ level: family.ageAssuranceLevel }).from(family).where(eq(family.id, fam.id)).limit(1);
    await recordAgeAssurance(ctx, fam.id, "card_authorisation");
    if (beforeRow?.level !== "none" && beforeRow?.level !== "parent_email") return { effects: [] };
    return { effects: [async (post) => notifyBillingContacts(post, fam.id, cardCheckedNotice(fam.id))] };
  }

  if (session.mode === "subscription") {
    // The subscription's own events set the plan. This event is where a promo code counts as used.
    const promoCodeId = session.metadata?.promoCodeId;
    if (promoCodeId && /^[0-9a-f-]{36}$/i.test(promoCodeId)) {
      const stripeSubscriptionId = refId(session.subscription);
      const [mirror] = stripeSubscriptionId ? await ctx.db.select({ id: subscription.id }).from(subscription).where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId)).limit(1) : [];
      const userId = session.metadata?.userId;
      await recordPromoRedemption(ctx, { promoCodeId, familyId: fam.id, redeemedBy: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null, subscriptionId: mirror?.id ?? null });
    }
    return { effects: [] };
  }
  return { effects: [], note: `checkout mode ${session.mode}` };
}
