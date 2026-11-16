import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AskParentAboutPlans, PlanCards } from "@/components/marketing/plans";
import { formatPence } from "@/lib/format";
import { systemActor } from "@/server/authz/actor";
import { plan } from "@/server/db/schema";
import { HOME_COURSE_COUNT, getHomeCourses, getPricingView, type PricingView } from "@/server/services/marketing";
import { importPlans } from "../../../scripts/import-plans";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";

const T0 = new Date("2026-11-16T10:00:00.000Z");

beforeEach(async () => {
  await resetDb();
  await importPlans(testCtx(systemActor("test"), { now: T0 }));
});
afterAll(closeDb);

/** Anything that would show money to the reader: a currency sign, an amount, or a field that carries one. */
const MONEY = /£|\bGBP\b|pence|price|pricing|amount|\d+\.\d{2}|a month|a year|trial|checkout|invoice|promo/i;

/** What the pricing page renders for a view: the same two components the page itself uses. */
function renderPricing(view: PricingView): string {
  return renderToStaticMarkup(view.kind === "ask_parent" ? createElement(AskParentAboutPlans) : createElement(PlanCards, { plans: view.plans, viewer: view.viewer }));
}

/** Every amount in the plan table, as it would be printed. */
async function everyPrintedAmount(): Promise<string[]> {
  const rows = await db.select().from(plan);
  const pence = rows.flatMap((row) => [row.priceMonthlyPence, row.priceAnnualPence, row.extraSeatPricePence, row.foundingMonthlyPence, row.foundingAnnualPence]).filter((value): value is number => typeof value === "number" && value > 0);
  return [...new Set(pence.map((value) => formatPence(value)))];
}

describe("/pricing for a learner under 18", () => {
  it.each([13, 14, 15, 16, 17])("a %i-year-old gets the Ask a parent page: no plan, no price, nothing about money", async (age) => {
    const { family } = await createFamily();
    const { actor } = await createLearner({ age, familyId: family.id, now: T0 });
    const view = await getPricingView(testCtx(actor, { now: T0 }));

    expect(view).toEqual({ kind: "ask_parent" });
    expect(JSON.stringify(view)).not.toMatch(MONEY);

    const html = renderPricing(view);
    expect(html).toContain("Plans are looked after by your parent or carer");
    expect(html).not.toMatch(MONEY);
    const amounts = await everyPrintedAmount();
    expect(amounts.length).toBeGreaterThanOrEqual(4);
    for (const amount of amounts) expect(html, amount).not.toContain(amount);
  });

  it("a teenager whose account has no family yet (waiting for a parent) gets the same page", async () => {
    const { actor } = await createLearner({ age: 14, familyId: null, now: T0 });
    expect(await getPricingView(testCtx(actor, { now: T0 }))).toEqual({ kind: "ask_parent" });
  });

  it("an 18-year-old still held in the 16–17 band is not shown prices until the band has moved", async () => {
    const { family } = await createFamily();
    const { actor } = await createLearner({ age: 18, familyId: family.id, now: T0 });
    expect(await getPricingView(testCtx({ ...actor, safetyBand: "teen_16_17" as const }, { now: T0 }))).toEqual({ kind: "ask_parent" });
    expect(await getPricingView(testCtx({ ...actor, age: 17 }, { now: T0 }))).toEqual({ kind: "ask_parent" });
  });
});

describe("/pricing for adults and visitors", () => {
  it("shows a visitor, a parent, an 18-year-old and staff the plans from the plan table", async () => {
    const { family, parentActor } = await createFamily();
    const { actor: adult } = await createLearner({ age: 18, familyId: family.id, now: T0 });
    const { actor: staff } = await createStaff({ roles: ["support"] });
    const amounts = await everyPrintedAmount();

    const cases = [
      [testCtx(undefined, { now: T0 }), "visitor"],
      [testCtx(parentActor, { now: T0 }), "parent"],
      [testCtx(adult, { now: T0 }), "adult_learner"],
      [testCtx(staff, { now: T0 }), "staff"],
    ] as const;
    for (const [ctx, viewer] of cases) {
      const view = await getPricingView(ctx);
      expect(view.kind, viewer).toBe("plans");
      if (view.kind !== "plans") continue;
      expect(view.viewer).toBe(viewer);
      expect(view.plans.map((entry) => entry.key)).toEqual(["free", "family"]);
      const html = renderPricing(view);
      for (const amount of amounts) expect(html, `${viewer}: ${amount}`).toContain(amount);
      // The owner has not confirmed prices yet, and the page says so.
      expect(html).toContain("These prices are not final");
    }
  });

  it("follows the plan table, not the code: a changed price is the price shown", async () => {
    await db.update(plan).set({ priceMonthlyPence: 4321 });
    const view = await getPricingView(testCtx(undefined, { now: T0 }));
    expect(renderPricing(view)).toContain("£43.21");
  });
});

describe("home page courses", () => {
  it("gives a signed-in learner none from the public list, which is not filtered by age", async () => {
    const { family, parentActor } = await createFamily();
    const { actor } = await createLearner({ age: 13, familyId: family.id, now: T0 });
    expect(await getHomeCourses(testCtx(actor, { now: T0 }))).toEqual([]);
    // With no courses published the list is empty for everyone, and nothing throws.
    expect(await getHomeCourses(testCtx(undefined, { now: T0 }))).toEqual([]);
    expect(await getHomeCourses(testCtx(parentActor, { now: T0 }))).toEqual([]);
    expect(HOME_COURSE_COUNT).toBeLessThanOrEqual(6);
  });
});
