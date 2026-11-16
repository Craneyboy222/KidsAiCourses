import { asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan, type Actor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { plan, type Db } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * Plans are data (spec 3.7, Section 11): the `plan` table, loaded from `content/plans/*.json` and
 * edited in Studio. No price is written anywhere in the code.
 *
 * Under-18s never see a price. Every function here that returns money either checks who is asking
 * or says in its name that the caller must (`…ForBilling`, `…ForAdmin`).
 */
export type PlanRow = typeof plan.$inferSelect;

export type BillingInterval = "month" | "year";
export type PriceVariant = "monthly" | "annual" | "founding_monthly" | "founding_annual" | "extra_seat";

export const FREE_PLAN_KEY = "free";

/** What `plan.features` may hold. Unknown keys are kept, so Studio can add more without a migration. */
const featuresSchema = z
  .object({
    fullCatalogue: z.boolean().default(false),
    /** The founding-family offer is on sale. */
    foundingOpen: z.boolean().default(false),
    /** The prices have not been confirmed by the owner yet. */
    pricePlaceholder: z.boolean().default(false),
    highlights: z.array(z.string().max(200)).max(12).default([]),
  })
  .loose();
export type PlanFeatures = z.infer<typeof featuresSchema>;

export function planFeatures(row: Pick<PlanRow, "features">): PlanFeatures {
  const parsed = featuresSchema.safeParse(row.features ?? {});
  return parsed.success ? parsed.data : { fullCatalogue: false, foundingOpen: false, pricePlaceholder: false, highlights: [] };
}

/**
 * Used only when the `plan` table has no `free` row (a database that has not been seeded). A
 * family with no subscription is on Free, so signed-in pages must still work. No price here.
 */
export function fallbackFreePlan(): Pick<PlanRow, "key" | "name" | "seats" | "coachCredits" | "features"> {
  return { key: FREE_PLAN_KEY, name: "Free", seats: 2, coachCredits: env.FREE_MONTHLY_CREDITS, features: { fullCatalogue: false } };
}

// ── Who may see money ───────────────────────────────────────────────────────

/**
 * The one rule for "may this person be shown a price?" (spec 3.7). A learner under 18 never may.
 * Signed-out visitors may: the public pricing page is written for parents.
 */
export function canSeePrices(actor: Actor): boolean {
  if (actor.type === "learner") return actor.safetyBand === "adult_18" && actor.age >= 18;
  return true;
}

// ── Reading ─────────────────────────────────────────────────────────────────

type ReadCtx = Pick<Ctx, "db">;

export async function getPlanByKey(ctx: ReadCtx, key: string): Promise<PlanRow | null> {
  const [row] = await ctx.db.select().from(plan).where(eq(plan.key, key)).limit(1);
  return row ?? null;
}

export async function getPlanById(ctx: ReadCtx, id: string): Promise<PlanRow | null> {
  const [row] = await ctx.db.select().from(plan).where(eq(plan.id, id)).limit(1);
  return row ?? null;
}

export type PlanPricing = {
  monthlyPence: number;
  annualPence: number;
  /** Present only while the founding offer is on sale. */
  founding: { monthlyPence: number | null; annualPence: number | null; lockMonths: number | null } | null;
  extraSeatMonthlyPence: number | null;
  trialDays: number;
  /** The owner has not confirmed these prices yet. */
  placeholder: boolean;
};

export type PublicPlan = {
  key: string;
  name: string;
  description: string | null;
  seats: number;
  fullCatalogue: boolean;
  highlights: string[];
  /** `null` for anyone who may not see prices (a learner under 18). */
  pricing: PlanPricing | null;
};

export function pricingOf(row: PlanRow): PlanPricing {
  const features = planFeatures(row);
  const hasFounding = features.foundingOpen && (row.foundingMonthlyPence !== null || row.foundingAnnualPence !== null);
  return {
    monthlyPence: row.priceMonthlyPence,
    annualPence: row.priceAnnualPence,
    founding: hasFounding ? { monthlyPence: row.foundingMonthlyPence, annualPence: row.foundingAnnualPence, lockMonths: row.foundingLockMonths } : null,
    extraSeatMonthlyPence: row.extraSeatPricePence,
    trialDays: row.trialDays,
    placeholder: features.pricePlaceholder,
  };
}

function toPublicPlan(row: PlanRow, withPrices: boolean): PublicPlan {
  const features = planFeatures(row);
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    seats: row.seats,
    fullCatalogue: features.fullCatalogue,
    highlights: features.highlights,
    pricing: withPrices ? pricingOf(row) : null,
  };
}

/**
 * The plans on sale, cheapest first, for the public pricing page. Read-only and safe to call for
 * anyone: when the person asking is a learner under 18, every `pricing` is `null`.
 */
export async function listPublicPlans(ctx: Pick<Ctx, "db" | "actor">): Promise<PublicPlan[]> {
  const rows = await ctx.db.select().from(plan).where(eq(plan.active, true)).orderBy(asc(plan.position), asc(plan.key));
  const withPrices = canSeePrices(ctx.actor);
  return rows.map((row) => toPublicPlan(row, withPrices));
}

// ── Stripe price ids ────────────────────────────────────────────────────────

const ENV_PRICE_IDS: Record<PriceVariant, () => string | undefined> = {
  monthly: () => env.STRIPE_PRICE_FAMILY_MONTHLY,
  annual: () => env.STRIPE_PRICE_FAMILY_ANNUAL,
  founding_monthly: () => env.STRIPE_PRICE_FAMILY_FOUNDING_MONTHLY,
  founding_annual: () => env.STRIPE_PRICE_FAMILY_FOUNDING_ANNUAL,
  extra_seat: () => env.STRIPE_PRICE_EXTRA_SEAT_MONTHLY,
};

const PRICE_VARIANTS: readonly PriceVariant[] = ["monthly", "annual", "founding_monthly", "founding_annual", "extra_seat"];

function storedPriceId(row: PlanRow, variant: PriceVariant): string | null {
  switch (variant) {
    case "monthly":
      return row.stripePriceMonthlyId;
    case "annual":
      return row.stripePriceAnnualId;
    case "founding_monthly":
      return row.stripePriceFoundingMonthlyId;
    case "founding_annual":
      return row.stripePriceFoundingAnnualId;
    case "extra_seat":
      return row.stripePriceExtraSeatId;
  }
}

const fakePriceId = (planKey: string, variant: PriceVariant): string => `price_fake_${planKey}_${variant}`;

/**
 * The Stripe price for one way of buying a plan: the id saved on the plan, else the
 * `STRIPE_PRICE_*` variable (Family only), else, with the local fake driver, a made-up id.
 * `null` means the plan cannot be bought that way yet.
 */
export function priceIdFor(row: PlanRow, variant: PriceVariant): string | null {
  const stored = storedPriceId(row, variant);
  if (stored) return stored;
  if (row.key === "family") {
    const fromEnv = ENV_PRICE_IDS[variant]();
    if (fromEnv) return fromEnv;
  }
  return env.STRIPE_DRIVER === "fake" ? fakePriceId(row.key, variant) : null;
}

export type ResolvedPrice = { plan: PlanRow; variant: PriceVariant };

/** Which plan, and which way of buying it, a Stripe price id stands for. `null` when no plan uses it. */
export async function findPlanByPriceId(ctx: ReadCtx, priceId: string): Promise<ResolvedPrice | null> {
  const stored = await ctx.db
    .select()
    .from(plan)
    .where(
      or(
        eq(plan.stripePriceMonthlyId, priceId),
        eq(plan.stripePriceAnnualId, priceId),
        eq(plan.stripePriceFoundingMonthlyId, priceId),
        eq(plan.stripePriceFoundingAnnualId, priceId),
        eq(plan.stripePriceExtraSeatId, priceId),
      ),
    )
    .limit(1);
  const direct = stored[0];
  if (direct) {
    const variant = PRICE_VARIANTS.find((v) => storedPriceId(direct, v) === priceId);
    if (variant) return { plan: direct, variant };
  }
  const envVariant = PRICE_VARIANTS.find((v) => ENV_PRICE_IDS[v]() === priceId);
  if (envVariant) {
    const family = await getPlanByKey(ctx, "family");
    if (family) return { plan: family, variant: envVariant };
  }
  if (env.STRIPE_DRIVER === "fake") {
    const match = /^price_fake_([a-z0-9_]+?)_(monthly|annual|founding_monthly|founding_annual|extra_seat)$/.exec(priceId);
    if (match?.[1] && match[2]) {
      const row = await getPlanByKey(ctx, match[1]);
      if (row) return { plan: row, variant: match[2] as PriceVariant };
    }
  }
  return null;
}

export const intervalOf = (variant: PriceVariant): BillingInterval => (variant === "annual" || variant === "founding_annual" ? "year" : "month");
export const isFoundingVariant = (variant: PriceVariant): boolean => variant === "founding_monthly" || variant === "founding_annual";

/** The price in pence for one way of buying a plan, or `null` when it is not offered. */
export function pencePrice(row: PlanRow, variant: PriceVariant): number | null {
  switch (variant) {
    case "monthly":
      return row.priceMonthlyPence;
    case "annual":
      return row.priceAnnualPence;
    case "founding_monthly":
      return row.foundingMonthlyPence;
    case "founding_annual":
      return row.foundingAnnualPence;
    case "extra_seat":
      return row.extraSeatPricePence;
  }
}

// ── Writing: the importer and Studio ────────────────────────────────────────

const pence = z.number().int().min(0).max(10_000_000);

export const planInputSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, "Use lower_snake_case"),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).nullable().default(null),
    position: z.number().int().min(0).default(0),
    seats: z.number().int().min(1).max(50),
    coachCredits: z.number().int().min(0).max(100_000),
    trialDays: z.number().int().min(0).max(90).default(0),
    active: z.boolean().default(true),
    prices: z
      .object({
        placeholder: z.boolean().default(false),
        monthlyPence: pence,
        annualPence: pence,
        extraSeatMonthlyPence: pence.nullable().default(null),
        founding: z
          .object({
            placeholder: z.boolean().optional(),
            open: z.boolean().default(false),
            monthlyPence: pence.nullable().default(null),
            annualPence: pence.nullable().default(null),
            lockMonths: z.number().int().min(1).max(60).nullable().default(null),
          })
          .strict()
          .nullable()
          .default(null),
      })
      .strict(),
    features: z.object({ fullCatalogue: z.boolean(), highlights: z.array(z.string().max(200)).max(12).default([]) }).loose(),
  })
  .strict();
export type PlanInput = z.infer<typeof planInputSchema>;

export type UpsertPlansResult = { inserted: string[]; updated: string[] };

/**
 * Creates or updates plans from the content files. Run by the seed script and the import script
 * as the system actor, or by an admin. A Stripe id already saved on a plan is never cleared.
 */
export async function upsertPlans(ctx: Ctx, inputs: PlanInput[]): Promise<UpsertPlansResult> {
  assertCan(ctx.actor, "plan.manage");
  const result: UpsertPlansResult = { inserted: [], updated: [] };
  await ctx.db.transaction(async (tx) => {
    for (const input of inputs) {
      const values = {
        name: input.name,
        description: input.description,
        position: input.position,
        seats: input.seats,
        coachCredits: input.coachCredits,
        trialDays: input.trialDays,
        active: input.active,
        priceMonthlyPence: input.prices.monthlyPence,
        priceAnnualPence: input.prices.annualPence,
        extraSeatPricePence: input.prices.extraSeatMonthlyPence,
        foundingMonthlyPence: input.prices.founding?.monthlyPence ?? null,
        foundingAnnualPence: input.prices.founding?.annualPence ?? null,
        foundingLockMonths: input.prices.founding?.lockMonths ?? null,
        features: { ...input.features, foundingOpen: input.prices.founding?.open ?? false, pricePlaceholder: input.prices.placeholder || input.prices.founding?.placeholder === true },
        updatedAt: ctx.now,
      };
      const existing = await tx.select({ id: plan.id }).from(plan).where(eq(plan.key, input.key)).limit(1);
      if (existing[0]) {
        await tx.update(plan).set(values).where(eq(plan.id, existing[0].id));
        result.updated.push(input.key);
      } else {
        await tx.insert(plan).values({ key: input.key, ...values, createdAt: ctx.now });
        result.inserted.push(input.key);
      }
    }
    await audit(ctx, { action: "plan.import", targetType: "plan", meta: { inserted: result.inserted, updated: result.updated } }, tx);
  });
  return result;
}

/** Every plan, with prices and Stripe ids, for the Studio plans screen. Admins only. */
export async function listPlansForAdmin(ctx: Ctx): Promise<PlanRow[]> {
  assertCan(ctx.actor, "plan.manage");
  return ctx.db.select().from(plan).orderBy(asc(plan.position), asc(plan.key));
}

export const planPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).nullable(),
    seats: z.number().int().min(1).max(50),
    coachCredits: z.number().int().min(0).max(100_000),
    trialDays: z.number().int().min(0).max(90),
    active: z.boolean(),
    priceMonthlyPence: pence,
    priceAnnualPence: pence,
    foundingMonthlyPence: pence.nullable(),
    foundingAnnualPence: pence.nullable(),
    foundingLockMonths: z.number().int().min(1).max(60).nullable(),
    extraSeatPricePence: pence.nullable(),
    foundingOpen: z.boolean(),
    pricePlaceholder: z.boolean(),
    stripeProductId: z.string().max(200).nullable(),
    stripePriceMonthlyId: z.string().max(200).nullable(),
    stripePriceAnnualId: z.string().max(200).nullable(),
    stripePriceFoundingMonthlyId: z.string().max(200).nullable(),
    stripePriceFoundingAnnualId: z.string().max(200).nullable(),
    stripePriceExtraSeatId: z.string().max(200).nullable(),
  })
  .partial()
  .strict();
export type PlanPatch = z.infer<typeof planPatchSchema>;

/**
 * Changes a plan from Studio. Audited. A new price here changes what we show; the amount Stripe
 * charges is set by the Stripe price the id points at, so change both together.
 */
export async function updatePlan(ctx: Ctx, key: string, patch: PlanPatch, reason?: string): Promise<PlanRow> {
  assertCan(ctx.actor, "plan.manage");
  const { foundingOpen, pricePlaceholder, ...columns } = patch;
  return ctx.db.transaction(async (tx: Db) => {
    const [current] = await tx.select().from(plan).where(eq(plan.key, key)).limit(1).for("update");
    if (!current) throw new AppError("not_found", "That plan could not be found.");
    if (key === FREE_PLAN_KEY && columns.active === false) throw new AppError("invalid_input", "The Free plan can't be switched off: every family without a subscription is on it.");
    const features = { ...current.features, ...(foundingOpen === undefined ? {} : { foundingOpen }), ...(pricePlaceholder === undefined ? {} : { pricePlaceholder }) };
    const [updated] = await tx
      .update(plan)
      .set({ ...columns, features, updatedAt: ctx.now })
      .where(eq(plan.id, current.id))
      .returning();
    await audit(ctx, { action: "plan.update", targetType: "plan", targetId: current.id, reason, meta: { key, changed: Object.keys(patch) } }, tx);
    return updated ?? current;
  });
}
