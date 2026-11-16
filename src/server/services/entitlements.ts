// CONTRACT — owner: payments slice. See _contract.ts.
import { eq, and } from "drizzle-orm";
import { londonDateKey } from "@/lib/dates";
import type { Ctx } from "@/server/context";
import { family, familyMember, plan, subscription, user } from "@/server/db";
import { getSetting } from "@/server/settings/store";
import { FREE_PLAN_KEY, fallbackFreePlan, planFeatures } from "./plans";

export type Entitlement = {
  planKey: string; // "free" | "family" | …  (plans are data)
  fullCatalogue: boolean;
  seats: number;
  coachCreditsPerLearnerPerMonth: number;
  /** Subscription state as last reported by a verified Stripe webhook. */
  status: "none" | "trialing" | "active" | "past_due" | "cancelled";
  periodKey: string; // credit period, e.g. "2026-11" or the subscription anniversary key
};

/**
 * How an entitlement is worked out (spec 3.7, Section 11).
 *
 * The only input is the `subscription` table, which is written by the signature-verified Stripe
 * webhook handler (and by an audited admin exception). Nothing a browser sends is read here.
 *
 *   trialing, active   the plan's entitlement
 *   past_due           the plan's entitlement for `site.payment_grace_days` after the payment
 *                      first failed, then Free until a payment succeeds
 *   cancel at period   the plan until the period ends, then Free (even if Stripe's final
 *   end                "deleted" event has not arrived)
 *   anything else      Free
 *
 * No subscription at all is Free too. The answer is worked out on every call from one or two
 * indexed reads, so a late webhook or a job that has not run can never leave access open.
 * No price is ever part of an `Entitlement`: it is safe to hand to learner-facing code.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The plan columns an entitlement needs. */
export type EntitlementPlan = { key: string; seats: number; coachCredits: number; fullCatalogue: boolean };

/** One row of `subscription`, with its plan. */
export type SubscriptionFacts = {
  status: string;
  /** Null for a plan given by an admin as a billing exception. */
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  extraSeats: number;
  updatedAt: Date;
  plan: EntitlementPlan;
};

export type SubscriptionAccess = {
  /** The subscription gives its plan's entitlement right now. */
  grants: boolean;
  status: Entitlement["status"];
  /** For `past_due`: when the grace period ends (or ended). */
  graceEndsAt: Date | null;
};

/** When the grace period after a failed payment runs out. */
export function graceEnd(sub: Pick<SubscriptionFacts, "pastDueSince" | "currentPeriodStart" | "updatedAt">, graceDays: number): Date {
  const from = sub.pastDueSince ?? sub.currentPeriodStart ?? sub.updatedAt;
  return new Date(from.getTime() + Math.max(0, graceDays) * DAY_MS);
}

/** Does this subscription give access at `now`? Pure. */
export function subscriptionAccess(sub: SubscriptionFacts, now: Date, graceDays: number): SubscriptionAccess {
  const ended = sub.currentPeriodEnd !== null && now.getTime() >= sub.currentPeriodEnd.getTime();
  switch (sub.status) {
    case "trialing":
    case "active": {
      // A plan that is set to end, or one an admin gave for a fixed time, stops at the end of its period.
      if (ended && (sub.cancelAtPeriodEnd || sub.stripeSubscriptionId === null)) return { grants: false, status: "cancelled", graceEndsAt: null };
      return { grants: true, status: sub.status, graceEndsAt: null };
    }
    case "past_due": {
      const graceEndsAt = graceEnd(sub, graceDays);
      return { grants: now.getTime() < graceEndsAt.getTime(), status: "past_due", graceEndsAt };
    }
    case "canceled":
    case "incomplete_expired":
      return { grants: false, status: "cancelled", graceEndsAt: null };
    case "unpaid":
      return { grants: false, status: "past_due", graceEndsAt: null };
    default:
      // `incomplete`, `paused` and anything Stripe adds later: no payment has been confirmed.
      return { grants: false, status: "none", graceEndsAt: null };
  }
}

/** The calendar month in UK time, e.g. `2026-11`: the credit period on Free. */
export function calendarPeriodKey(now: Date): string {
  return londonDateKey(now).slice(0, 7);
}

/**
 * The credit period for a subscriber: a month that starts on the day of the month the
 * subscription period started, in UK time, e.g. `2026-11-16`. The 29th to the 31st count as the
 * 28th, so that every month has that day and each period is exactly one calendar month long.
 */
export function anniversaryPeriodKey(anchor: Date, now: Date): string {
  const day = Math.min(28, Number(londonDateKey(anchor).slice(8, 10)));
  const today = londonDateKey(now);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  if (Number(today.slice(8, 10)) < day) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export type EntitlementFacts = {
  subscriptions: SubscriptionFacts[];
  freePlan: EntitlementPlan;
  now: Date;
  graceDays: number;
  /** The family belongs to an 18-year-old with their own account: always one seat (spec Section 11). */
  singleSeat: boolean;
};

const RANK: Record<Entitlement["status"], number> = { active: 4, trialing: 3, past_due: 2, cancelled: 1, none: 0 };

/** The decision. Pure, so every rule above has a unit test. */
export function deriveEntitlement(facts: EntitlementFacts): Entitlement {
  const { now, graceDays } = facts;
  const judged = facts.subscriptions.map((sub) => ({ sub, access: subscriptionAccess(sub, now, graceDays) }));
  const byNewest = (a: { sub: SubscriptionFacts }, b: { sub: SubscriptionFacts }) => b.sub.updatedAt.getTime() - a.sub.updatedAt.getTime();

  const granting = judged.filter((j) => j.access.grants).sort((a, b) => RANK[b.access.status] - RANK[a.access.status] || byNewest(a, b))[0];
  if (granting) {
    const { sub, access } = granting;
    return {
      planKey: sub.plan.key,
      fullCatalogue: sub.plan.fullCatalogue,
      seats: facts.singleSeat ? 1 : sub.plan.seats + Math.max(0, sub.extraSeats),
      coachCreditsPerLearnerPerMonth: sub.plan.coachCredits,
      status: access.status,
      periodKey: anniversaryPeriodKey(sub.currentPeriodStart ?? sub.updatedAt, now),
    };
  }

  // Free. The status still says what happened to the newest subscription, for the billing page.
  const latest = [...judged].sort(byNewest)[0];
  return {
    planKey: facts.freePlan.key,
    fullCatalogue: facts.freePlan.fullCatalogue,
    seats: facts.singleSeat ? 1 : facts.freePlan.seats,
    coachCreditsPerLearnerPerMonth: facts.freePlan.coachCredits,
    status: latest ? latest.access.status : "none",
    periodKey: calendarPeriodKey(now),
  };
}

// ── Reading the facts ───────────────────────────────────────────────────────

type ReadCtx = Pick<Ctx, "db" | "now">;

type FactRow = {
  familyId: string;
  ownerKind: string;
  status: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  extraSeats: number | null;
  updatedAt: Date | null;
  planKey: string | null;
  planSeats: number | null;
  planCredits: number | null;
  planFeatures: Record<string, unknown> | null;
};

const factColumns = {
  familyId: family.id,
  ownerKind: user.kind,
  status: subscription.status,
  stripeSubscriptionId: subscription.stripeSubscriptionId,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  currentPeriodStart: subscription.currentPeriodStart,
  currentPeriodEnd: subscription.currentPeriodEnd,
  pastDueSince: subscription.pastDueSince,
  extraSeats: subscription.extraSeats,
  updatedAt: subscription.updatedAt,
  planKey: plan.key,
  planSeats: plan.seats,
  planCredits: plan.coachCredits,
  planFeatures: plan.features,
};

function toSubscriptions(rows: FactRow[]): SubscriptionFacts[] {
  const out: SubscriptionFacts[] = [];
  for (const row of rows) {
    if (row.status === null || row.planKey === null || row.planSeats === null || row.planCredits === null || row.updatedAt === null) continue;
    out.push({
      status: row.status,
      stripeSubscriptionId: row.stripeSubscriptionId,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      pastDueSince: row.pastDueSince,
      extraSeats: row.extraSeats ?? 0,
      updatedAt: row.updatedAt,
      plan: { key: row.planKey, seats: row.planSeats, coachCredits: row.planCredits, fullCatalogue: planFeatures({ features: row.planFeatures ?? {} }).fullCatalogue },
    });
  }
  return out;
}

async function loadFreePlan(ctx: ReadCtx): Promise<EntitlementPlan> {
  const [row] = await ctx.db.select({ key: plan.key, seats: plan.seats, coachCredits: plan.coachCredits, features: plan.features }).from(plan).where(eq(plan.key, FREE_PLAN_KEY)).limit(1);
  const free = row ?? fallbackFreePlan();
  return { key: free.key, seats: free.seats, coachCredits: free.coachCredits, fullCatalogue: planFeatures(free).fullCatalogue };
}

async function entitlementFromRows(ctx: ReadCtx, rows: FactRow[]): Promise<Entitlement> {
  const subscriptions = toSubscriptions(rows);
  // The grace setting only matters while a payment is overdue, so it is only read then.
  const graceDays = subscriptions.some((sub) => sub.status === "past_due") ? await getSetting(ctx, "site.payment_grace_days") : 0;
  const singleSeat = rows[0]?.ownerKind === "learner";
  const base = { subscriptions, now: ctx.now, graceDays, singleSeat };

  // A paying family is answered from the one read already made; only Free needs the Free plan's row.
  if (subscriptions.some((sub) => subscriptionAccess(sub, ctx.now, graceDays).grants)) {
    return deriveEntitlement({ ...base, freePlan: { key: FREE_PLAN_KEY, seats: 1, coachCredits: 0, fullCatalogue: false } });
  }
  return deriveEntitlement({ ...base, freePlan: await loadFreePlan(ctx) });
}

/** Stripe webhooks are the source of truth (spec 3.7). Never trust anything from the browser. */
export async function getEntitlementForLearner(ctx: Ctx, learnerId: string): Promise<Entitlement> {
  const rows: FactRow[] = await ctx.db
    .select(factColumns)
    .from(familyMember)
    .innerJoin(family, eq(family.id, familyMember.familyId))
    .innerJoin(user, eq(user.id, family.ownerUserId))
    .leftJoin(subscription, eq(subscription.familyId, family.id))
    .leftJoin(plan, eq(plan.id, subscription.planId))
    .where(and(eq(familyMember.userId, learnerId), eq(familyMember.role, "learner")));
  // A learner with no family yet (a teen waiting for a parent) is on Free.
  return entitlementFromRows(ctx, rows);
}

export async function getEntitlementForFamily(ctx: Ctx, familyId: string): Promise<Entitlement> {
  const rows: FactRow[] = await ctx.db
    .select(factColumns)
    .from(family)
    .innerJoin(user, eq(user.id, family.ownerUserId))
    .leftJoin(subscription, eq(subscription.familyId, family.id))
    .leftJoin(plan, eq(plan.id, subscription.planId))
    .where(eq(family.id, familyId));
  return entitlementFromRows(ctx, rows);
}

/** Free courses are open to everyone; paid courses need the full catalogue. Checked on every gated route. */
export async function canAccessCourse(ctx: Ctx, learnerId: string, course: { id: string; isFree: boolean }): Promise<boolean> {
  if (course.isFree) return true;
  return (await getEntitlementForLearner(ctx, learnerId)).fullCatalogue;
}
