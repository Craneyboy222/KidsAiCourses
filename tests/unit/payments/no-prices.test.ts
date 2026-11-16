import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { planInputSchema } from "@/server/services/plans";
import { readPlanFiles } from "../../../scripts/import-plans";

/**
 * Two rules that are easy to break by accident in a later change, checked against the source
 * itself: no price is ever written in code, and nothing a learner under 18 uses can reach the
 * code that knows about money.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");
const read = (file: string) => readFileSync(file, "utf8");

describe("plans are data, not code", () => {
  const plans = readPlanFiles();

  it("the plan files are valid, and every price in them is marked as a placeholder for the owner", () => {
    expect(plans.map((plan) => plan.key).sort()).toEqual(["family", "free"]);
    for (const plan of plans) {
      expect(planInputSchema.safeParse(plan).success).toBe(true);
      expect(plan.prices.placeholder, plan.key).toBe(true);
    }
    const family = plans.find((plan) => plan.key === "family");
    expect(family?.prices.founding).toMatchObject({ placeholder: true, open: true });
    expect(family?.prices.extraSeatMonthlyPence).toBeGreaterThan(0);
    expect(family?.trialDays).toBe(7);
    expect(plans.find((plan) => plan.key === "free")?.prices).toMatchObject({ monthlyPence: 0, annualPence: 0 });
  });

  it("no amount of money from the plan files, and no pound figure at all, appears in the billing code", () => {
    const amounts = new Set<number>();
    for (const plan of plans) {
      for (const value of [plan.prices.monthlyPence, plan.prices.annualPence, plan.prices.extraSeatMonthlyPence, plan.prices.founding?.monthlyPence, plan.prices.founding?.annualPence]) {
        // Four digits or more: shorter figures (300, 999) also turn up as ordinary limits and sizes.
        if (typeof value === "number" && value >= 1000) amounts.add(value);
      }
    }
    const billingCode = [
      ...files(join(SRC, "components", "billing")),
      ...files(join(SRC, "app", "(parent)", "parent", "billing")),
      ...files(join(SRC, "app", "(learner)", "settings", "billing")),
      ...files(join(SRC, "app", "dev", "fake-stripe")),
      ...files(join(SRC, "server", "stripe")),
      ...["billing.ts", "billing-events.ts", "plans.ts", "promo.ts", "entitlements.ts", "unlock-requests.ts"].map((name) => join(SRC, "server", "services", name)),
    ];
    expect(amounts.size).toBeGreaterThanOrEqual(3);
    expect(billingCode.length).toBeGreaterThan(15);
    for (const file of billingCode) {
      const source = read(file);
      expect(source, `${rel(file)} has a pound amount written in it`).not.toMatch(/£\s?\d*[1-9]/);
      for (const pence of amounts) expect(source, `${rel(file)} contains ${pence}`).not.toMatch(new RegExp(`(?<![\\d_.])${pence}(?![\\d_])`));
    }
  });
});

describe("nothing a learner under 18 uses can reach the billing code", () => {
  /** Modules that return, format or lead to a price. */
  const MONEY_MODULES = /from "(@\/server\/services\/(billing|billing-events|promo)|@\/server\/stripe[^"]*|@\/components\/billing[^"]*|@\/app\/\(parent\)\/parent\/billing[^"]*)"/;
  const FORMATS_MONEY = /\bformatPence\b|\bpricingOf\b|\bpencePrice\b|\blistPlansForAdmin\b/;

  const learnerFacing = [
    ...files(join(SRC, "app", "(learner)")).filter((file) => !rel(file).includes("(learner)/settings/billing/")),
    ...files(join(SRC, "app", "(player)")),
    ...files(join(SRC, "app", "api", "v1")),
    ...files(join(SRC, "components", "course")),
    ...files(join(SRC, "components", "coach")),
    ...files(join(SRC, "components", "submissions")),
    ...files(join(SRC, "components", "layout")),
    join(SRC, "components", "ui", "ask-parent-to-unlock.tsx"),
  ];

  it("no learner page, player page, public API route or learner component imports it or formats money", () => {
    expect(learnerFacing.length).toBeGreaterThan(20);
    for (const file of learnerFacing) {
      const source = read(file);
      expect(source, `${rel(file)} imports billing code`).not.toMatch(MONEY_MODULES);
      expect(source, `${rel(file)} formats or reads a price`).not.toMatch(FORMATS_MONEY);
    }
  });

  it("the only learner pages that do are the adult owner's, and they go through the one gate", () => {
    const adultPages = files(join(SRC, "app", "(learner)", "settings", "billing")).filter((file) => file.endsWith("page.tsx"));
    expect(adultPages).toHaveLength(2);
    for (const file of adultPages) expect(read(file), rel(file)).toMatch(/requireAdultBillingPage\(/);
    const gate = read(join(SRC, "app", "(learner)", "settings", "billing", "_lib.ts"));
    expect(gate).toMatch(/getBillingOverview\(/);
    expect(gate).toMatch(/notFound\(\)/);
  });

  it("every billing action and stand-in Stripe page checks who is asking before anything else", () => {
    const actions = read(join(SRC, "app", "(parent)", "parent", "billing", "actions.ts"));
    const bodies = actions.split("export async function ").slice(1);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      const gate = body.indexOf("await resolveBillingAccount(ctx)");
      expect(gate).toBeGreaterThan(0);
      for (const later of ["rateLimit(", "startCheckout(", "openBillingPortal(", "startCardCheck(", "formData.get("]) {
        const at = body.indexOf(later);
        if (at !== -1) expect(at, later).toBeGreaterThan(gate);
      }
    }
    for (const page of [join("checkout", "page.tsx"), join("portal", "page.tsx"), "actions.ts"]) {
      expect(read(join(SRC, "app", "dev", "fake-stripe", page)), page).toMatch(/requireFakeStripe\(/);
    }
    for (const page of ["page.tsx", join("plans", "page.tsx")]) {
      expect(read(join(SRC, "app", "(parent)", "parent", "billing", page)), page).toMatch(/requireParentPage\(\)/);
    }
  });
});

describe("ending a plan deletes nothing", () => {
  it("no billing service deletes a row, and none touches a learner's work", () => {
    for (const name of ["billing.ts", "billing-events.ts", "entitlements.ts", "promo.ts", "plans.ts", "unlock-requests.ts"]) {
      const source = read(join(SRC, "server", "services", name));
      expect(source, `${name} deletes rows`).not.toMatch(/\.delete\(/);
      expect(source, `${name} touches learner work`).not.toMatch(/\b(enrolment|certificate|project|projectVersion|artefact|stepProgress|quizAttempt)\b\s*[,}).]/);
    }
  });
});
