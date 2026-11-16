import { and, desc, eq, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { userEmail } from "@/server/auth/learner-email";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { family, plan, promoCode, subscription, user, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { registerEmailTemplate } from "@/server/email";
import { logError } from "@/server/log";
import { notify } from "@/server/notifications";
import { getSetting } from "@/server/settings/store";
import { getStripeDriverForUse } from "@/server/stripe";
import type { AgeAssuranceLevel } from "./age-assurance";
import { getEntitlementForFamily, subscriptionAccess, type Entitlement } from "./entitlements";
import { countSeatsUsed, getLearnerSummary, listChildren, listParentUserIds } from "./family";
import { FREE_PLAN_KEY, getPlanByKey, isFoundingVariant, pencePrice, planFeatures, priceIdFor, type BillingInterval, type PlanRow, type PriceVariant } from "./plans";
import { checkPromoForFamily, describePromo, type PromoRow } from "./promo";

/**
 * Billing for the people who pay (spec 3.7): a parent or carer for their family, or an
 * 18-year-old who owns their own account. Everything here that returns or leads to a price goes
 * through `resolveBillingAccount` first, so a learner under 18 can never reach it, whatever page
 * or API calls it.
 *
 * Nothing in this file changes what a family is entitled to. Checkout, the portal and the card
 * check only send the browser to Stripe; the entitlement changes when Stripe's webhook arrives
 * (`billing-events.ts`). The one exception is an admin's billing exception, which is audited.
 */

// The billing emails. Registered here, not in the webhook handler, because the daily job sends one
// too and every sender of a billing notice imports this file.
registerEmailTemplate("billing_payment_failed", {
  audience: "parent",
  category: "transactional",
  description: "A subscription payment did not go through.",
  subject: "Your payment didn't go through",
  body: `
We tried to take the payment for your {{brandName}} plan and it didn't go through. This is usually an expired card or a bank check.

Nothing changes until {{graceDate}}. If the payment hasn't gone through by then, your family moves to the Free plan. Nothing is deleted: finished projects and certificates stay.

[Update your card]({{url}})
`,
});
registerEmailTemplate("billing_trial_ending", {
  audience: "parent",
  category: "transactional",
  description: "A free trial ends in a few days and the first payment will be taken.",
  subject: "Your free trial ends on {{date}}",
  body: `
Your free trial of {{brandName}} ends on {{date}}. Your first payment is taken then, using the card you gave at the start.

If you'd rather not carry on, you can cancel before that date and you won't be charged. Your family then stays on the Free plan.

[See your plan]({{url}})
`,
});
registerEmailTemplate("billing_plan_ended", {
  audience: "parent",
  category: "transactional",
  description: "A paid plan has ended and the family is on Free.",
  subject: "Your plan has ended",
  body: `
Your {{brandName}} plan has ended and your family is now on the Free plan.

Nothing has been deleted. Finished projects, portfolios and certificates are all still there, and the free courses stay open. You can choose a plan again at any time.

[See your plan]({{url}})
`,
});

export type BillingAccount = {
  familyId: string;
  userId: string;
  /** A parent or carer, or an 18-year-old who owns their own account. */
  kind: "parent" | "adult_learner";
  /** That person's billing page. */
  homePath: string;
  plansPath: string;
};

export const PARENT_BILLING_PATH = "/parent/billing";
export const ADULT_BILLING_PATH = "/settings/billing";

/**
 * Who is paying. Throws for everyone who may not see billing: signed-out visitors, staff, and
 * above all any learner under 18 (their message says nothing about money).
 */
export async function resolveBillingAccount(ctx: Pick<Ctx, "db" | "actor">): Promise<BillingAccount> {
  const { actor } = ctx;
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");

  if (actor.type === "parent") {
    assertCan(actor, "family.billing.manage", { familyId: actor.familyId });
    return { familyId: actor.familyId, userId: actor.userId, kind: "parent", homePath: PARENT_BILLING_PATH, plansPath: `${PARENT_BILLING_PATH}/plans` };
  }

  if (actor.type === "learner") {
    // Under 18: no prices, no checkout, no invoices, no promo codes. Ever.
    if (actor.safetyBand !== "adult_18" || actor.age < 18) {
      throw new AppError("forbidden", "That part of the site is for parents and carers. If a course is locked, use Ask a parent to unlock on its page.");
    }
    assertCan(actor, "family.billing.manage", { learnerId: actor.userId });
    if (!(await getSetting(ctx, "site.adult_self_serve"))) {
      throw new AppError("forbidden", "Managing your own plan isn't available at the moment. A parent or carer can still do it for you.");
    }
    const [owned] = actor.familyId
      ? await ctx.db
          .select({ id: family.id })
          .from(family)
          .where(and(eq(family.id, actor.familyId), eq(family.ownerUserId, actor.userId)))
          .limit(1)
      : [];
    if (!owned) {
      throw new AppError("forbidden", "Your plan is looked after by the parent or carer on your account. To manage it yourself, take over your account first in Settings.");
    }
    return { familyId: owned.id, userId: actor.userId, kind: "adult_learner", homePath: ADULT_BILLING_PATH, plansPath: `${ADULT_BILLING_PATH}/plans` };
  }

  throw new AppError("forbidden", "You don't have permission to do that.");
}

// ── What the billing page shows ─────────────────────────────────────────────

export type PlanOption = {
  interval: BillingInterval;
  /** What is charged each month or year, in pence. */
  pricePence: number;
  /** The founding-family price applies. */
  founding: boolean;
  /** The usual price, shown beside a founding price. */
  standardPricePence: number;
  /** How long the founding price is held. */
  lockMonths: number | null;
};

export type PlanOffer = {
  planKey: string;
  name: string;
  description: string | null;
  highlights: string[];
  seats: number;
  /** Free days at the start, with a card. 0 when this family has had a plan before. */
  trialDays: number;
  options: PlanOption[];
  extraSeatMonthlyPence: number | null;
  /** The owner has not confirmed these prices yet. */
  pricesArePlaceholders: boolean;
};

export type SubscriptionSummary = {
  interval: BillingInterval | null;
  isFounding: boolean;
  foundingLockedUntil: Date | null;
  /** While trialing: when the trial ends and the first payment is taken. */
  trialEndsAt: Date | null;
  /** The next date money is due, or `null` when nothing more will be taken. */
  nextPaymentAt: Date | null;
  /** Set when the plan has been cancelled and runs until this date. */
  endsAt: Date | null;
  /** A payment has failed. Access continues until `graceEndsAt`. */
  pastDue: { graceEndsAt: Date; inGrace: boolean } | null;
  /** Given by us at no charge, until `endsAt`. */
  comped: boolean;
};

export type AgeAssuranceSummary = {
  level: AgeAssuranceLevel;
  checkedAt: Date | null;
  /** A learner aged 13 to 15 is waiting on the card check before they can use Coach. */
  needed: boolean;
  waitingFor: string[];
};

export type BillingOverview = {
  account: BillingAccount;
  plan: { key: string; name: string };
  status: Entitlement["status"];
  seats: { used: number; total: number; extra: number };
  subscription: SubscriptionSummary | null;
  /** There is something to manage in the Stripe portal: a card, a plan or invoices. */
  canManage: boolean;
  /** No plan is running, so one can be chosen. */
  canChoosePlan: boolean;
  offers: PlanOffer[];
  ageAssurance: AgeAssuranceSummary;
};

type SubscriptionRow = typeof subscription.$inferSelect;
type SubWithPlan = { sub: SubscriptionRow; plan: PlanRow };

/** Stripe statuses for a subscription that still exists at Stripe. A new checkout must not be started beside one. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);

async function loadSubscriptions(db: Db, familyId: string): Promise<SubWithPlan[]> {
  return db.select({ sub: subscription, plan }).from(subscription).innerJoin(plan, eq(plan.id, subscription.planId)).where(eq(subscription.familyId, familyId)).orderBy(desc(subscription.updatedAt));
}

const isLive = (row: SubWithPlan, now: Date): boolean => {
  if (!LIVE_STATUSES.has(row.sub.status)) return false;
  // A plan we gave, or one set to end, is over once its period has passed.
  const ended = row.sub.currentPeriodEnd !== null && now >= row.sub.currentPeriodEnd;
  return !(ended && (row.sub.cancelAtPeriodEnd || row.sub.stripeSubscriptionId === null));
};

function variantFor(row: PlanRow, interval: BillingInterval): PriceVariant {
  const founding: PriceVariant = interval === "year" ? "founding_annual" : "founding_monthly";
  const standard: PriceVariant = interval === "year" ? "annual" : "monthly";
  return planFeatures(row).foundingOpen && pencePrice(row, founding) !== null ? founding : standard;
}

function offerFor(row: PlanRow, trialDays: number): PlanOffer | null {
  const features = planFeatures(row);
  const options: PlanOption[] = [];
  for (const interval of ["month", "year"] as const) {
    const variant = variantFor(row, interval);
    const pricePence = pencePrice(row, variant);
    const standardPricePence = pencePrice(row, interval === "year" ? "annual" : "monthly") ?? 0;
    if (pricePence === null || pricePence <= 0 || priceIdFor(row, variant) === null) continue;
    options.push({ interval, pricePence, founding: isFoundingVariant(variant), standardPricePence, lockMonths: isFoundingVariant(variant) ? row.foundingLockMonths : null });
  }
  if (options.length === 0) return null;
  return {
    planKey: row.key,
    name: row.name,
    description: row.description,
    highlights: features.highlights,
    seats: row.seats,
    trialDays,
    options,
    extraSeatMonthlyPence: row.extraSeatPricePence,
    pricesArePlaceholders: features.pricePlaceholder,
  };
}

/** A family gets the free trial once: not again after a plan has been cancelled. */
const trialDaysFor = (row: PlanRow, history: SubWithPlan[]): number => (history.some((h) => h.sub.stripeSubscriptionId !== null) ? 0 : row.trialDays);

async function loadOffers(ctx: Pick<Ctx, "db">, history: SubWithPlan[]): Promise<PlanOffer[]> {
  const rows = await ctx.db
    .select()
    .from(plan)
    .where(and(eq(plan.active, true), ne(plan.key, FREE_PLAN_KEY)))
    .orderBy(plan.position);
  return rows.map((row) => offerFor(row, trialDaysFor(row, history))).filter((offer): offer is PlanOffer => offer !== null);
}

/** Everything the billing page shows. Parents, carers and adult account owners only. */
export async function getBillingOverview(ctx: Ctx): Promise<BillingOverview> {
  const account = await resolveBillingAccount(ctx);
  const [entitlement, history, used, [fam], learners, graceDays] = await Promise.all([
    getEntitlementForFamily(ctx, account.familyId),
    loadSubscriptions(ctx.db, account.familyId),
    countSeatsUsed(ctx, account.familyId),
    ctx.db.select().from(family).where(eq(family.id, account.familyId)).limit(1),
    listChildren(ctx, account.familyId),
    getSetting(ctx, "site.payment_grace_days"),
  ]);
  if (!fam) throw new AppError("not_found", "We couldn't find your family's account. Sign out and in again, then try once more.");

  const live = history.find((row) => isLive(row, ctx.now)) ?? null;
  const planName = live && entitlement.planKey === live.plan.key ? live.plan.name : ((await getPlanByKey(ctx, entitlement.planKey))?.name ?? "Free");

  let summary: SubscriptionSummary | null = null;
  if (live) {
    const { sub } = live;
    const access = subscriptionAccess(
      { ...sub, plan: { key: live.plan.key, seats: live.plan.seats, coachCredits: live.plan.coachCredits, fullCatalogue: planFeatures(live.plan).fullCatalogue } },
      ctx.now,
      graceDays,
    );
    const comped = sub.stripeSubscriptionId === null;
    const ending = sub.cancelAtPeriodEnd || comped;
    summary = {
      interval: sub.interval,
      isFounding: sub.isFounding,
      foundingLockedUntil: sub.foundingLockedUntil,
      trialEndsAt: sub.status === "trialing" ? sub.trialEndsAt : null,
      nextPaymentAt: ending || sub.status === "past_due" ? null : sub.status === "trialing" ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : sub.currentPeriodEnd,
      endsAt: ending ? sub.currentPeriodEnd : null,
      pastDue: sub.status === "past_due" && access.graceEndsAt ? { graceEndsAt: access.graceEndsAt, inGrace: access.grants } : null,
      comped,
    };
  }

  const mode = await getSetting(ctx, "safety.age_assurance_mode");
  const cardChecked = fam.ageAssuranceLevel === "card_authorisation" || fam.ageAssuranceLevel === "paid_subscription";
  const waitingFor = mode === "card_or_subscription" && !cardChecked ? learners.filter((l) => l.safetyBand === "teen_13_15").map((l) => l.nickname) : [];

  return {
    account,
    plan: { key: entitlement.planKey, name: planName },
    status: entitlement.status,
    seats: { used, total: entitlement.seats, extra: live?.sub.extraSeats ?? 0 },
    subscription: summary,
    // A customer made for a checkout that was never finished has nothing in the portal.
    canManage: fam.stripeCustomerId !== null && (history.some((row) => row.sub.stripeSubscriptionId !== null) || fam.ageAssuranceLevel === "card_authorisation" || fam.ageAssuranceLevel === "paid_subscription"),
    canChoosePlan: live === null,
    offers: live === null ? await loadOffers(ctx, history) : [],
    ageAssurance: { level: fam.ageAssuranceLevel, checkedAt: fam.ageAssuredAt, needed: waitingFor.length > 0, waitingFor },
  };
}

// ── Going to Stripe ─────────────────────────────────────────────────────────

/** The family's Stripe customer, created the first time it is needed. Never created for a learner under 18. */
async function ensureCustomer(ctx: Ctx, account: BillingAccount): Promise<string> {
  const [fam] = await ctx.db
    .select({ customerId: family.stripeCustomerId, ownerUserId: family.ownerUserId })
    .from(family)
    .where(eq(family.id, account.familyId))
    .limit(1);
  if (!fam) throw new AppError("not_found", "We couldn't find your family's account. Sign out and in again, then try once more.");
  if (fam.customerId) return fam.customerId;

  const [owner] = await ctx.db.select({ email: user.email, name: user.name, kind: user.kind }).from(user).where(eq(user.id, fam.ownerUserId)).limit(1);
  const driver = await getStripeDriverForUse(ctx);
  // Stripe gets the paying adult's email address and name, and nothing about any child.
  const { customerId } = await driver.createCustomer({ familyId: account.familyId, email: owner ? userEmail(owner) : null, name: owner?.kind === "parent" ? owner.name : null });
  await ctx.db
    .update(family)
    .set({ stripeCustomerId: customerId, updatedAt: ctx.now })
    .where(and(eq(family.id, account.familyId), isNull(family.stripeCustomerId)));
  const [saved] = await ctx.db.select({ customerId: family.stripeCustomerId }).from(family).where(eq(family.id, account.familyId)).limit(1);
  return saved?.customerId ?? customerId;
}

export type CheckoutPreview = { offer: PlanOffer; option: PlanOption; promo: { code: string; description: string } | null; trialDays: number };

async function prepareCheckout(
  ctx: Ctx,
  account: BillingAccount,
  input: { planKey: string; interval: BillingInterval; promoCode?: string | null },
): Promise<{ row: PlanRow; variant: PriceVariant; priceId: string; trialDays: number; promo: PromoRow | null; preview: CheckoutPreview }> {
  const history = await loadSubscriptions(ctx.db, account.familyId);
  if (history.some((row) => isLive(row, ctx.now) && row.sub.stripeSubscriptionId !== null)) {
    throw new AppError("conflict", "You already have a plan. Use Manage plan to change it, update your card or cancel.");
  }
  const row = await getPlanByKey(ctx, input.planKey);
  if (!row || !row.active || row.key === FREE_PLAN_KEY) throw new AppError("not_found", "That plan isn't available. Go back and choose again.");
  const offer = offerFor(row, trialDaysFor(row, history));
  const option = offer?.options.find((o) => o.interval === input.interval);
  const variant = variantFor(row, input.interval);
  const priceId = priceIdFor(row, variant);
  if (!offer || !option || !priceId) throw new AppError("not_ready", "That plan can't be bought just yet. Nothing has been charged. Please try again later.", { status: 503 });

  const promo = input.promoCode?.trim() ? await checkPromoForFamily(ctx, { code: input.promoCode, familyId: account.familyId }) : null;
  const trialDays = promo?.kind === "free_period" ? Math.max(offer.trialDays, promo.freeDays ?? 0) : offer.trialDays;
  return { row, variant, priceId, trialDays, promo, preview: { offer, option, promo: promo ? { code: promo.code, description: describePromo(promo) } : null, trialDays } };
}

/**
 * Starts Stripe Checkout for a plan and returns where to send the browser. Card details are
 * typed on Stripe's page, never ours. Nothing is granted here: the plan starts when Stripe's
 * webhook says the checkout completed.
 */
export async function startCheckout(ctx: Ctx, input: { planKey: string; interval: BillingInterval; promoCode?: string | null }): Promise<{ url: string }> {
  const account = await resolveBillingAccount(ctx);
  const { row, priceId, trialDays, promo } = await prepareCheckout(ctx, account, input);
  const driver = await getStripeDriverForUse(ctx);
  const customerId = await ensureCustomer(ctx, account);

  let couponId: string | null = null;
  if (promo && (promo.kind === "percent_off" || promo.kind === "amount_off")) {
    couponId = promo.stripeCouponId;
    // A code made while the fake driver was in use has no coupon at Stripe yet: make it now.
    if (driver.name === "stripe" && (!couponId || couponId.startsWith("coupon_fake_"))) {
      couponId = (await driver.createCoupon({ code: promo.code, percentOff: promo.percentOff, amountOffPence: promo.amountOffPence, maxRedemptions: promo.maxRedemptions, expiresAt: promo.expiresAt })).couponId;
      await ctx.db.update(promoCode).set({ stripeCouponId: couponId, updatedAt: ctx.now }).where(eq(promoCode.id, promo.id));
    }
  }

  const session = await driver.createCheckoutSession({
    customerId,
    priceId,
    trialDays,
    couponId,
    metadata: { familyId: account.familyId, userId: account.userId, planKey: row.key, ...(promo ? { promoCodeId: promo.id } : {}) },
    successPath: `${account.homePath}?checkout=success`,
    cancelPath: `${account.plansPath}?checkout=cancelled`,
  });
  return { url: session.url };
}

/** What a checkout would be, without starting one: lets the plan page confirm a promo code before leaving for Stripe. */
export async function previewCheckout(ctx: Ctx, input: { planKey: string; interval: BillingInterval; promoCode?: string | null }): Promise<CheckoutPreview> {
  const account = await resolveBillingAccount(ctx);
  return (await prepareCheckout(ctx, account, input)).preview;
}

/**
 * Age assurance on Free (spec 3.1): a £0 card authorisation. Sends the adult to a Stripe-hosted
 * page that checks a card with a SetupIntent and takes no money. The result is recorded only when
 * Stripe's webhook confirms it.
 */
export async function startCardCheck(ctx: Ctx): Promise<{ url: string }> {
  const account = await resolveBillingAccount(ctx);
  const driver = await getStripeDriverForUse(ctx);
  const customerId = await ensureCustomer(ctx, account);
  const session = await driver.createSetupSession({
    customerId,
    metadata: { familyId: account.familyId, userId: account.userId },
    successPath: `${account.homePath}?card=checked`,
    cancelPath: `${account.homePath}?card=cancelled`,
  });
  return { url: session.url };
}

/** The Stripe Customer Portal: change or cancel the plan, update the card, see invoices. */
export async function openBillingPortal(ctx: Ctx): Promise<{ url: string }> {
  const account = await resolveBillingAccount(ctx);
  const [fam] = await ctx.db.select({ customerId: family.stripeCustomerId }).from(family).where(eq(family.id, account.familyId)).limit(1);
  if (!fam?.customerId) throw new AppError("conflict", "There's nothing to manage yet: you haven't chosen a plan or added a card.");
  const driver = await getStripeDriverForUse(ctx);
  return driver.createPortalSession({ customerId: fam.customerId, returnPath: account.homePath });
}

// ── Keeping `family.plan` in step, and telling people ───────────────────────

/**
 * The adults to tell about a family's billing: its parents and carers, or the 18-year-old who
 * owns it. Never a learner under 18: an owner who is a learner is checked to be an adult first.
 */
export async function billingContactIds(ctx: Pick<Ctx, "db" | "now">, familyId: string): Promise<string[]> {
  const parents = await listParentUserIds(ctx, familyId);
  if (parents.length > 0) return parents;
  const [fam] = await ctx.db.select({ ownerUserId: family.ownerUserId, kind: user.kind }).from(family).innerJoin(user, eq(user.id, family.ownerUserId)).where(eq(family.id, familyId)).limit(1);
  if (!fam) return [];
  if (fam.kind === "parent") return [fam.ownerUserId];
  if (fam.kind !== "learner") return [];
  try {
    return (await getLearnerSummary(ctx, fam.ownerUserId)).safetyBand === "adult_18" ? [fam.ownerUserId] : [];
  } catch {
    return [];
  }
}

export type BillingNotice = { type: string; title: string; body: string; emailTemplate?: string; emailData?: Record<string, string>; dedupeKey: string; urgent?: boolean };

/** Sends one billing notice to every billing contact of a family. Never to a learner under 18. */
export async function notifyBillingContacts(ctx: Pick<Ctx, "db" | "now">, familyId: string, notice: BillingNotice): Promise<void> {
  const [fam] = await ctx.db.select({ ownerKind: user.kind }).from(family).innerJoin(user, eq(user.id, family.ownerUserId)).where(eq(family.id, familyId)).limit(1);
  const href = fam?.ownerKind === "learner" ? ADULT_BILLING_PATH : PARENT_BILLING_PATH;
  for (const userId of await billingContactIds(ctx, familyId)) {
    await notify(ctx, {
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      href,
      urgent: notice.urgent,
      // Every billing email links to that person's own billing page.
      ...(notice.emailTemplate ? { emailTemplate: notice.emailTemplate, emailData: { url: `${env.NEXT_PUBLIC_APP_URL}${href}`, ...notice.emailData } } : {}),
      dedupeKey: `${notice.dedupeKey}:${userId}`,
    });
  }
}

/**
 * Brings the `family.plan` cache into line with the entitlement worked out from `subscription`.
 * Returns the change, if there was one. The entitlement itself never depends on this cache.
 */
export async function syncFamilyPlan(ctx: Ctx, familyId: string, cause: Record<string, unknown>): Promise<{ from: string; to: string; entitlement: Entitlement } | null> {
  const entitlement = await getEntitlementForFamily(ctx, familyId);
  const [fam] = await ctx.db.select({ plan: family.plan }).from(family).where(eq(family.id, familyId)).limit(1).for("update");
  if (!fam || fam.plan === entitlement.planKey) return null;
  await ctx.db.update(family).set({ plan: entitlement.planKey, updatedAt: ctx.now }).where(eq(family.id, familyId));
  await audit(ctx, { action: "entitlement.change", targetType: "family", targetId: familyId, meta: { from: fam.plan, to: entitlement.planKey, status: entitlement.status, ...cause } });
  return { from: fam.plan, to: entitlement.planKey, entitlement };
}

export const PLAN_ENDED_NOTE = "You're now on the Free plan. Nothing has been deleted: finished projects, portfolios and certificates are all still there, and the free courses stay open.";

/**
 * Daily job. The entitlement is always worked out live, so nothing here is needed for access to
 * be right; this catches up the things that happen with the passing of time rather than with a
 * webhook: a grace period running out, a cancelled plan reaching its end date, a plan we gave
 * coming to an end. It updates the `family.plan` cache and tells the family, once.
 */
export async function reconcileBilling(ctx: Ctx): Promise<{ checked: number; downgraded: number; compedEnded: number }> {
  assertCan(ctx.actor, "billing.exception");
  const ended = await ctx.db
    .update(subscription)
    .set({ status: "canceled", canceledAt: ctx.now, updatedAt: ctx.now })
    .where(and(isNull(subscription.stripeSubscriptionId), eq(subscription.status, "active"), lte(subscription.currentPeriodEnd, ctx.now)))
    .returning({ id: subscription.id });

  const paying = await ctx.db.select({ id: family.id }).from(family).where(ne(family.plan, FREE_PLAN_KEY));
  let downgraded = 0;
  for (const fam of paying) {
    const change = await ctx.db.transaction((tx) => syncFamilyPlan({ ...ctx, db: tx }, fam.id, { cause: "reconcile" }));
    if (!change || change.to !== FREE_PLAN_KEY) continue;
    downgraded += 1;
    try {
      await notifyBillingContacts(ctx, fam.id, {
        type: "billing.plan_ended",
        title: "Your plan has ended",
        body: change.entitlement.status === "past_due" ? `We couldn't take your payment, so your plan has ended. ${PLAN_ENDED_NOTE} Update your card to pick up where you left off.` : `Your plan has ended. ${PLAN_ENDED_NOTE}`,
        emailTemplate: "billing_plan_ended",
        dedupeKey: `billing-ended:${fam.id}:${ctx.now.toISOString().slice(0, 10)}`,
      });
    } catch (error) {
      logError("billing.reconcile.notify_failed", error, { familyId: fam.id });
    }
  }
  return { checked: paying.length, downgraded, compedEnded: ended.length };
}

// ── Admin exceptions (Studio). Admins only, always audited. ─────────────────

/**
 * Gives a family a paid plan at no charge until a date ("comped"). Not allowed beside a running
 * Stripe subscription. Giving it again moves the end date.
 */
export async function grantCompedPlan(ctx: Ctx, input: { familyId: string; planKey: string; until: Date; reason: string }): Promise<{ subscriptionId: string }> {
  assertCan(ctx.actor, "billing.exception");
  if (input.reason.trim().length < 5) throw new AppError("invalid_input", "Say why this plan is being given, so it is on the record.");
  if (input.until <= ctx.now) throw new AppError("invalid_input", "Choose an end date in the future.");
  const row = await getPlanByKey(ctx, input.planKey);
  if (!row || row.key === FREE_PLAN_KEY) throw new AppError("not_found", "That plan could not be found.");

  const result = await ctx.db.transaction(async (tx) => {
    const [fam] = await tx.select({ id: family.id }).from(family).where(eq(family.id, input.familyId)).limit(1).for("update");
    if (!fam) throw new AppError("not_found", "That family could not be found.");
    const history = await loadSubscriptions(tx, input.familyId);
    if (history.some((h) => isLive(h, ctx.now) && h.sub.stripeSubscriptionId !== null)) {
      throw new AppError("conflict", "This family is already paying for a plan. Change or refund it in Stripe instead.");
    }
    const existing = history.find((h) => h.sub.stripeSubscriptionId === null && h.sub.status === "active");
    const values = { planId: row.id, status: "active", currentPeriodStart: existing?.sub.currentPeriodStart ?? ctx.now, currentPeriodEnd: input.until, cancelAtPeriodEnd: true, canceledAt: null, updatedAt: ctx.now };
    let subscriptionId: string;
    if (existing) {
      await tx.update(subscription).set(values).where(eq(subscription.id, existing.sub.id));
      subscriptionId = existing.sub.id;
    } else {
      const [created] = await tx
        .insert(subscription)
        .values({ familyId: input.familyId, ...values, createdAt: ctx.now })
        .returning({ id: subscription.id });
      if (!created) throw new Error("grantCompedPlan: the insert returned nothing");
      subscriptionId = created.id;
    }
    const txCtx = { ...ctx, db: tx };
    await audit(txCtx, { action: "billing.comp_grant", targetType: "family", targetId: input.familyId, reason: input.reason.trim(), meta: { planKey: row.key, until: input.until.toISOString(), subscriptionId } }, tx);
    await syncFamilyPlan(txCtx, input.familyId, { cause: "comp_grant" });
    return { subscriptionId };
  });
  return result;
}

/** Ends a plan we gave, now. */
export async function endCompedPlan(ctx: Ctx, input: { familyId: string; reason: string }): Promise<{ ended: number }> {
  assertCan(ctx.actor, "billing.exception");
  if (input.reason.trim().length < 5) throw new AppError("invalid_input", "Say why this plan is being ended, so it is on the record.");
  return ctx.db.transaction(async (tx) => {
    const ended = await tx
      .update(subscription)
      .set({ status: "canceled", canceledAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(subscription.familyId, input.familyId), isNull(subscription.stripeSubscriptionId), eq(subscription.status, "active")))
      .returning({ id: subscription.id });
    const txCtx = { ...ctx, db: tx };
    await audit(txCtx, { action: "billing.comp_end", targetType: "family", targetId: input.familyId, reason: input.reason.trim(), meta: { ended: ended.length } }, tx);
    await syncFamilyPlan(txCtx, input.familyId, { cause: "comp_end" });
    return { ended: ended.length };
  });
}

/**
 * Moves the end of a family's free trial to a later date. The request goes to Stripe; our own
 * record changes when Stripe's webhook confirms it.
 */
export async function extendTrial(ctx: Ctx, input: { familyId: string; until: Date; reason: string }): Promise<{ subscriptionId: string }> {
  assertCan(ctx.actor, "billing.exception");
  if (input.reason.trim().length < 5) throw new AppError("invalid_input", "Say why the trial is being extended, so it is on the record.");
  const [trial] = await ctx.db
    .select({ id: subscription.id, stripeId: subscription.stripeSubscriptionId, trialEndsAt: subscription.trialEndsAt })
    .from(subscription)
    .where(and(eq(subscription.familyId, input.familyId), eq(subscription.status, "trialing"), isNotNull(subscription.stripeSubscriptionId)))
    .limit(1);
  if (!trial?.stripeId) throw new AppError("conflict", "This family isn't in a free trial. To give them time on a plan, give a plan at no charge instead.");
  if (input.until <= ctx.now || (trial.trialEndsAt && input.until <= trial.trialEndsAt)) throw new AppError("invalid_input", "Choose a date after the trial's current end.");
  await audit(ctx, { action: "billing.trial_extend", targetType: "family", targetId: input.familyId, reason: input.reason.trim(), meta: { subscriptionId: trial.id, from: trial.trialEndsAt?.toISOString() ?? null, until: input.until.toISOString() } });
  const driver = await getStripeDriverForUse(ctx);
  await driver.updateTrialEnd({ subscriptionId: trial.stripeId, trialEnd: input.until });
  return { subscriptionId: trial.id };
}

/**
 * Ends every running Stripe subscription of a family now. For account deletion ("Stripe is
 * updated as required", spec Section 4) and for staff. Our record changes when the webhook arrives.
 */
export async function cancelFamilySubscriptions(ctx: Ctx, input: { familyId: string; reason: string }): Promise<{ cancelled: number }> {
  assertCan(ctx.actor, "billing.exception");
  const rows = await ctx.db
    .select({ stripeId: subscription.stripeSubscriptionId, status: subscription.status })
    .from(subscription)
    .where(and(eq(subscription.familyId, input.familyId), isNotNull(subscription.stripeSubscriptionId)));
  const running = rows.filter((row) => LIVE_STATUSES.has(row.status));
  if (running.length === 0) return { cancelled: 0 };
  await audit(ctx, { action: "billing.cancel", targetType: "family", targetId: input.familyId, reason: input.reason, meta: { count: running.length } });
  const driver = await getStripeDriverForUse(ctx);
  for (const row of running) if (row.stripeId) await driver.cancelSubscription({ subscriptionId: row.stripeId });
  return { cancelled: running.length };
}
