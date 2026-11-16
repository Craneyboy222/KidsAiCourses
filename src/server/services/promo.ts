import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { formatPence } from "@/lib/format";
import { audit } from "@/server/audit";
import { assertCan, systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { promoCode, promoRedemption, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStripeDriverForUse } from "@/server/stripe";
import { grantCredits } from "./credits";
import { listChildren } from "./family";

/**
 * Promo codes (spec 3.7, Section 11). Made by an admin in Studio, typed only by a parent or an
 * adult at the plan-choice step, never by a learner under 18.
 *
 *   percent_off, amount_off  money off the first payment, through a Stripe coupon
 *   free_period              a longer free trial at the start
 *   credit_grant             extra Coach credits for each learner once the checkout completes
 *
 * A code is checked when checkout starts. It only counts as used when Stripe's
 * `checkout.session.completed` webhook arrives: that is where the redemption is recorded, the
 * count goes up and any credits are granted. One use per family, enforced by a unique index.
 * `plan_unlock` exists in the data model but is not offered yet (docs/OPEN_QUESTIONS.md).
 */
export type PromoRow = typeof promoCode.$inferSelect;
export type PromoKind = PromoRow["kind"];

export const SUPPORTED_PROMO_KINDS = ["percent_off", "amount_off", "free_period", "credit_grant"] as const;

export const createPromoSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/, "Use 3 to 40 letters, numbers, hyphens or underscores"),
    kind: z.enum(SUPPORTED_PROMO_KINDS),
    percentOff: z.number().int().min(1).max(100).nullish(),
    amountOffPence: z.number().int().min(1).max(1_000_000).nullish(),
    freeDays: z.number().int().min(1).max(365).nullish(),
    creditGrant: z.number().int().min(1).max(100_000).nullish(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullish(),
    startsAt: z.date().nullish(),
    expiresAt: z.date().nullish(),
    note: z.string().trim().max(300).nullish(),
  })
  .strict()
  .superRefine((value, issue) => {
    const need = (field: "percentOff" | "amountOffPence" | "freeDays" | "creditGrant", message: string) => {
      if (value[field] === null || value[field] === undefined) issue.addIssue({ code: "custom", path: [field], message });
    };
    if (value.kind === "percent_off") need("percentOff", "Say what percentage to take off.");
    if (value.kind === "amount_off") need("amountOffPence", "Say how much to take off, in pence.");
    if (value.kind === "free_period") need("freeDays", "Say how many free days the code gives.");
    if (value.kind === "credit_grant") need("creditGrant", "Say how many Coach credits the code gives each learner.");
    if (value.startsAt && value.expiresAt && value.expiresAt <= value.startsAt) issue.addIssue({ code: "custom", path: ["expiresAt"], message: "The end date must be after the start date." });
  });
export type CreatePromoInput = z.infer<typeof createPromoSchema>;

function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 4 && typeof e === "object" && e !== null; depth += 1) {
    if ("code" in e && (e as { code: unknown }).code === "23505") return true;
    e = "cause" in e ? (e as { cause: unknown }).cause : null;
  }
  return false;
}

const usesCoupon = (kind: PromoKind): boolean => kind === "percent_off" || kind === "amount_off";

/** Studio: creates a code. Money-off codes get their Stripe coupon straight away. Admins only; audited. */
export async function createPromo(ctx: Ctx, input: CreatePromoInput): Promise<PromoRow> {
  assertCan(ctx.actor, "promo.manage");
  if (input.expiresAt && input.expiresAt <= ctx.now) throw new AppError("invalid_input", "The end date is in the past. Choose a later date.", { fieldErrors: { expiresAt: ["Choose a date in the future."] } });
  const code = input.code.toUpperCase();
  const [taken] = await ctx.db.select({ id: promoCode.id }).from(promoCode).where(eq(promoCode.code, code)).limit(1);
  if (taken) throw new AppError("conflict", "There is already a code with that name. Choose a different one.", { fieldErrors: { code: ["Already in use."] } });

  let stripeCouponId: string | null = null;
  if (usesCoupon(input.kind)) {
    const driver = await getStripeDriverForUse(ctx);
    stripeCouponId = (await driver.createCoupon({ code, percentOff: input.percentOff, amountOffPence: input.amountOffPence, maxRedemptions: input.maxRedemptions, expiresAt: input.expiresAt })).couponId;
  }

  try {
    return await ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(promoCode)
        .values({
          code,
          kind: input.kind,
          percentOff: input.kind === "percent_off" ? (input.percentOff ?? null) : null,
          amountOffPence: input.kind === "amount_off" ? (input.amountOffPence ?? null) : null,
          freeDays: input.kind === "free_period" ? (input.freeDays ?? null) : null,
          creditGrant: input.kind === "credit_grant" ? (input.creditGrant ?? null) : null,
          stripeCouponId,
          maxRedemptions: input.maxRedemptions ?? null,
          startsAt: input.startsAt ?? null,
          expiresAt: input.expiresAt ?? null,
          note: input.note ?? null,
          createdBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .returning();
      if (!created) throw new Error("createPromo: the insert returned nothing");
      await audit(ctx, { action: "promo.create", targetType: "promo_code", targetId: created.id, meta: { code, kind: input.kind, maxRedemptions: input.maxRedemptions ?? null } }, tx);
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("conflict", "There is already a code with that name. Choose a different one.", { fieldErrors: { code: ["Already in use."] } });
    throw error;
  }
}

/** Studio: every code, newest first, with how many times each has been used. */
export async function listPromos(ctx: Ctx, opts: { activeOnly?: boolean } = {}): Promise<PromoRow[]> {
  assertCan(ctx.actor, "promo.manage");
  return ctx.db
    .select()
    .from(promoCode)
    .where(opts.activeOnly ? eq(promoCode.active, true) : undefined)
    .orderBy(desc(promoCode.createdAt));
}

/** Studio: stops a code being used again. Discounts already given are not taken back. Audited. */
export async function disablePromo(ctx: Ctx, promoId: string, reason?: string): Promise<PromoRow> {
  assertCan(ctx.actor, "promo.manage");
  const updated = await ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(promoCode).where(eq(promoCode.id, promoId)).limit(1).for("update");
    if (!current) throw new AppError("not_found", "That code could not be found.");
    if (!current.active) return { row: current, changed: false };
    const [row] = await tx.update(promoCode).set({ active: false, updatedAt: ctx.now }).where(eq(promoCode.id, promoId)).returning();
    await audit(ctx, { action: "promo.disable", targetType: "promo_code", targetId: promoId, reason, meta: { code: current.code } }, tx);
    return { row: row ?? current, changed: true };
  });
  if (updated.changed && updated.row.stripeCouponId) {
    // Best effort: our own check already refuses the code, so a failure here only leaves an unused coupon in Stripe.
    try {
      await (await getStripeDriverForUse(ctx)).deleteCoupon(updated.row.stripeCouponId);
    } catch {
      /* Left in Stripe; harmless. */
    }
  }
  return updated.row;
}

// ── Using a code ────────────────────────────────────────────────────────────

const refuse = (message: string): AppError => new AppError("invalid_input", message, { fieldErrors: { promoCode: [message] } });

/**
 * Checks a code for one family at the moment checkout starts. Throws a plain-English reason when
 * it cannot be used. The caller must already have checked that the person may see billing.
 */
export async function checkPromoForFamily(ctx: Pick<Ctx, "db" | "now">, input: { code: string; familyId: string }): Promise<PromoRow> {
  const code = input.code.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(code)) throw refuse("That code isn't one of ours. Check it and try again.");
  const [promo] = await ctx.db.select().from(promoCode).where(eq(promoCode.code, code)).limit(1);
  if (!promo || !promo.active || (promo.startsAt && promo.startsAt > ctx.now) || !SUPPORTED_PROMO_KINDS.some((kind) => kind === promo.kind)) {
    throw refuse("That code isn't one of ours. Check it and try again.");
  }
  if (promo.expiresAt && promo.expiresAt <= ctx.now) throw refuse("That code has run out. It can't be used any more.");
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) throw refuse("That code has been used as many times as it can be.");
  const [used] = await ctx.db
    .select({ id: promoRedemption.id })
    .from(promoRedemption)
    .where(and(eq(promoRedemption.promoCodeId, promo.id), eq(promoRedemption.familyId, input.familyId)))
    .limit(1);
  if (used) throw refuse("Your family has already used that code. Each code works once per family.");
  return promo;
}

/** What a code does, in words, for the plan-choice page. Shown to parents and adults only. */
export function describePromo(promo: Pick<PromoRow, "kind" | "percentOff" | "amountOffPence" | "freeDays" | "creditGrant">): string {
  switch (promo.kind) {
    case "percent_off":
      return `${promo.percentOff ?? 0}% off your first payment`;
    case "amount_off":
      return `${formatPence(promo.amountOffPence ?? 0)} off your first payment`;
    case "free_period":
      return `${promo.freeDays ?? 0} days free before your first payment`;
    case "credit_grant":
      return `${promo.creditGrant ?? 0} extra Coach credits for each learner`;
    default:
      return "A special offer";
  }
}

/** The first payment after a money-off code, never below zero. */
export function discountedPence(pricePence: number, promo: Pick<PromoRow, "kind" | "percentOff" | "amountOffPence"> | null): number {
  if (!promo) return pricePence;
  if (promo.kind === "percent_off") return Math.max(0, Math.round((pricePence * (100 - (promo.percentOff ?? 0))) / 100));
  if (promo.kind === "amount_off") return Math.max(0, pricePence - (promo.amountOffPence ?? 0));
  return pricePence;
}

export type RedemptionResult = { recorded: boolean; promo: PromoRow | null; creditedLearners: number };

/**
 * Records that a family used a code. Called only by the webhook handler when Stripe confirms a
 * completed checkout, inside its transaction (`ctx.db` is that transaction). Idempotent: the
 * unique index on (code, family) makes a second call a no-op, so a repeated webhook cannot count
 * twice or grant credits twice.
 */
export async function recordPromoRedemption(ctx: Ctx, input: { promoCodeId: string; familyId: string; redeemedBy: string | null; subscriptionId: string | null }): Promise<RedemptionResult> {
  const tx: Db = ctx.db;
  const [promo] = await tx.select().from(promoCode).where(eq(promoCode.id, input.promoCodeId)).limit(1).for("update");
  if (!promo) return { recorded: false, promo: null, creditedLearners: 0 };

  const inserted = await tx
    .insert(promoRedemption)
    .values({ promoCodeId: promo.id, familyId: input.familyId, redeemedBy: input.redeemedBy, subscriptionId: input.subscriptionId, createdAt: ctx.now, updatedAt: ctx.now })
    .onConflictDoNothing({ target: [promoRedemption.promoCodeId, promoRedemption.familyId] })
    .returning({ id: promoRedemption.id });
  if (inserted.length === 0) return { recorded: false, promo, creditedLearners: 0 };

  // Stripe has already applied the code, so the count mirrors what happened; it never passes the cap.
  await tx
    .update(promoCode)
    .set({ redemptionCount: sql`${promoCode.redemptionCount} + 1`, updatedAt: ctx.now })
    .where(and(eq(promoCode.id, promo.id), or(isNull(promoCode.maxRedemptions), lt(promoCode.redemptionCount, promoCode.maxRedemptions))));

  let creditedLearners = 0;
  if (promo.kind === "credit_grant" && promo.creditGrant && promo.creditGrant > 0) {
    const system: Ctx = { ...ctx, actor: systemActor("promo.redeem") };
    for (const learner of await listChildren(ctx, input.familyId)) {
      await grantCredits(system, { learnerId: learner.learnerId, amount: promo.creditGrant, reason: `Promo code ${promo.code}`, idempotencyKey: `promo:${promo.id}:${learner.learnerId}` });
      creditedLearners += 1;
    }
  }
  await audit(ctx, { action: "promo.redeem", targetType: "promo_code", targetId: promo.id, meta: { familyId: input.familyId, kind: promo.kind, creditedLearners } }, tx);
  return { recorded: true, promo, creditedLearners };
}

/** Whether a family has room to use this code right now. For the fake driver, which enforces the cap the way Stripe's coupon would. */
export async function promoStillRedeemable(ctx: Pick<Ctx, "db" | "now">, promoCodeId: string, familyId: string): Promise<boolean> {
  const [promo] = await ctx.db.select().from(promoCode).where(eq(promoCode.id, promoCodeId)).limit(1);
  if (!promo || !promo.active) return false;
  if (promo.expiresAt && promo.expiresAt <= ctx.now) return false;
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) return false;
  const [used] = await ctx.db
    .select({ id: promoRedemption.id })
    .from(promoRedemption)
    .where(and(eq(promoRedemption.promoCodeId, promoCodeId), eq(promoRedemption.familyId, familyId)))
    .limit(1);
  return !used;
}
