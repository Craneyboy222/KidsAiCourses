import { describe, expect, it } from "vitest";
import type { LearnerActor } from "@/server/authz/actor";
import { anniversaryPeriodKey, calendarPeriodKey, deriveEntitlement, graceEnd, subscriptionAccess, type EntitlementFacts, type SubscriptionFacts } from "@/server/services/entitlements";
import { canSeePrices } from "@/server/services/plans";
import { periodBounds } from "@/server/services/credits";

/** The entitlement rules, with no database: every row of the table in `entitlements.ts`. */
const NOW = new Date("2026-11-16T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const FREE = { key: "free", seats: 2, coachCredits: 50, fullCatalogue: false };
const FAMILY = { key: "family", seats: 4, coachCredits: 200, fullCatalogue: true };

const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  status: "active",
  stripeSubscriptionId: "sub_1",
  cancelAtPeriodEnd: false,
  currentPeriodStart: day(-10),
  currentPeriodEnd: day(20),
  pastDueSince: null,
  extraSeats: 0,
  updatedAt: day(-10),
  plan: FAMILY,
  ...over,
});
const facts = (subscriptions: SubscriptionFacts[], over: Partial<EntitlementFacts> = {}): EntitlementFacts => ({ subscriptions, freePlan: FREE, now: NOW, graceDays: 7, singleSeat: false, ...over });

describe("deriveEntitlement", () => {
  it("no subscription is Free, on the calendar month", () => {
    expect(deriveEntitlement(facts([]))).toEqual({ planKey: "free", fullCatalogue: false, seats: 2, coachCreditsPerLearnerPerMonth: 50, status: "none", periodKey: "2026-11" });
  });

  it.each(["trialing", "active"])("%s gives the plan, with extra seats on top", (status) => {
    expect(deriveEntitlement(facts([sub({ status, extraSeats: 2 })]))).toMatchObject({ planKey: "family", fullCatalogue: true, seats: 6, coachCreditsPerLearnerPerMonth: 200, status });
  });

  it("past_due keeps the plan inside the grace period and is Free from the moment it ends", () => {
    const overdue = sub({ status: "past_due", pastDueSince: day(-3) });
    expect(deriveEntitlement(facts([overdue]))).toMatchObject({ planKey: "family", status: "past_due" });
    expect(deriveEntitlement(facts([overdue], { now: new Date(day(4).getTime() - 1) }))).toMatchObject({ planKey: "family" });
    expect(deriveEntitlement(facts([overdue], { now: day(4) }))).toMatchObject({ planKey: "free", status: "past_due", fullCatalogue: false, seats: 2 });
    expect(deriveEntitlement(facts([overdue], { graceDays: 0 }))).toMatchObject({ planKey: "free", status: "past_due" });
    expect(graceEnd({ pastDueSince: null, currentPeriodStart: day(-1), updatedAt: day(-9) }, 7)).toEqual(day(6));
  });

  it("a cancelled plan runs to the end of its period and not a second longer", () => {
    const leaving = sub({ cancelAtPeriodEnd: true, currentPeriodEnd: day(5) });
    expect(deriveEntitlement(facts([leaving]))).toMatchObject({ planKey: "family", status: "active" });
    expect(deriveEntitlement(facts([leaving], { now: day(5) }))).toMatchObject({ planKey: "free", status: "cancelled" });
    // A paying subscription whose renewal webhook is late is not cut off.
    expect(deriveEntitlement(facts([sub({ currentPeriodEnd: day(-1) })]))).toMatchObject({ planKey: "family" });
  });

  it.each([
    ["canceled", "cancelled"],
    ["incomplete_expired", "cancelled"],
    ["unpaid", "past_due"],
    ["incomplete", "none"],
    ["paused", "none"],
    ["something_new_from_stripe", "none"],
  ])("%s gives no access (reported as %s)", (status, reported) => {
    expect(subscriptionAccess(sub({ status }), NOW, 7).grants).toBe(false);
    expect(deriveEntitlement(facts([sub({ status })]))).toMatchObject({ planKey: "free", status: reported, fullCatalogue: false });
  });

  it("a plan given by an admin (no Stripe id) stops at its end date", () => {
    const comped = sub({ stripeSubscriptionId: null, currentPeriodEnd: day(3) });
    expect(deriveEntitlement(facts([comped]))).toMatchObject({ planKey: "family" });
    expect(deriveEntitlement(facts([comped], { now: day(3) }))).toMatchObject({ planKey: "free" });
  });

  it("an old cancelled subscription does not hide a new active one", () => {
    const old = sub({ status: "canceled", updatedAt: day(-1) });
    expect(deriveEntitlement(facts([old, sub({ updatedAt: day(-40) })]))).toMatchObject({ planKey: "family", status: "active" });
  });

  it("an 18-year-old's own family always has one seat", () => {
    expect(deriveEntitlement(facts([], { singleSeat: true })).seats).toBe(1);
    expect(deriveEntitlement(facts([sub({ extraSeats: 3 })], { singleSeat: true }))).toMatchObject({ planKey: "family", seats: 1 });
  });
});

describe("credit periods", () => {
  it("Free uses the calendar month in UK time", () => {
    expect(calendarPeriodKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10");
    // 00:30 on 1 July in London is still 30 June in UTC.
    expect(calendarPeriodKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07");
  });

  it("a subscriber's period starts on their anniversary day each month", () => {
    const anchor = new Date("2026-11-16T10:00:00Z");
    expect(anniversaryPeriodKey(anchor, new Date("2026-11-16T10:00:00Z"))).toBe("2026-11-16");
    expect(anniversaryPeriodKey(anchor, new Date("2026-12-15T23:00:00Z"))).toBe("2026-11-16");
    expect(anniversaryPeriodKey(anchor, new Date("2026-12-16T00:30:00Z"))).toBe("2026-12-16");
    expect(anniversaryPeriodKey(anchor, new Date("2027-01-03T09:00:00Z"))).toBe("2026-12-16");
  });

  it("the 29th to the 31st count as the 28th, so every period is one whole month and none overlap", () => {
    const anchor = new Date("2027-01-31T12:00:00Z");
    const keys = ["2027-01-31T12:00:00Z", "2027-02-27T12:00:00Z", "2027-02-28T12:00:00Z", "2027-03-29T12:00:00Z"].map((at) => anniversaryPeriodKey(anchor, new Date(at)));
    expect(keys).toEqual(["2027-01-28", "2027-01-28", "2027-02-28", "2027-03-28"]);
    // The Coach slice turns a key into dates: consecutive keys must meet exactly.
    expect(periodBounds("2027-01-28", NOW).end).toEqual(periodBounds("2027-02-28", NOW).start);
    expect(periodBounds("2027-02-28", NOW).end).toEqual(periodBounds("2027-03-28", NOW).start);
  });
});

describe("canSeePrices", () => {
  const learner = (age: number, safetyBand: LearnerActor["safetyBand"]): LearnerActor => ({ type: "learner", userId: "u", familyId: "f", safetyBand, age, status: "active" });
  it("is false for every learner under 18, whatever else is true", () => {
    expect(canSeePrices(learner(13, "teen_13_15"))).toBe(false);
    expect(canSeePrices(learner(17, "teen_16_17"))).toBe(false);
    // Just turned 18 by age but the stored band has not caught up, or the other way round: still no.
    expect(canSeePrices(learner(18, "teen_16_17"))).toBe(false);
    expect(canSeePrices(learner(17, "adult_18"))).toBe(false);
    expect(canSeePrices(learner(18, "adult_18"))).toBe(true);
  });
  it("is true for parents, staff and signed-out visitors to the public pricing page", () => {
    expect(canSeePrices({ type: "parent", userId: "p", familyId: "f", status: "active" })).toBe(true);
    expect(canSeePrices({ type: "anonymous" })).toBe(true);
  });
});
