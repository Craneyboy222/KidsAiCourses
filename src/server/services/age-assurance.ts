// CONTRACT — owner: accounts slice (the payments slice calls recordAgeAssurance). See _contract.ts.
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import type { SafetyBand } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { family } from "@/server/db";
import { AppError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { missingRequiredConsents } from "./consent";
import { getFamily, getLearnerSummary } from "./family";

/**
 * Age assurance (spec 3.1): what we need to know about the adult behind a learner before that
 * learner may use Coach.
 *
 * TODO(legal): the method below is the one the brief proposes, not a legal conclusion. Whether a
 * £0 card authorisation or a paid subscription is proportionate assurance for 13–15, and whether a
 * verified email is enough for 16–17, must be confirmed with a UK data-protection lawyer before
 * launch (docs/OPEN_QUESTIONS.md, launch-readiness item `age_assurance_confirmed`). Nothing here
 * is hard-coded to one answer: the mode is the `safety.age_assurance_mode` setting, and changing
 * the rule means changing `decideAgeAssurance` only.
 */
export type AgeAssuranceMethod = "card_authorisation" | "paid_subscription" | "parent_email";
export type AgeAssuranceLevel = "none" | AgeAssuranceMethod;
export type AgeAssuranceMode = "card_or_subscription" | "parent_email" | "off_dev_only";

/** Weakest to strongest. A family's recorded level only ever moves up. */
export const AGE_ASSURANCE_ORDER: readonly AgeAssuranceLevel[] = ["none", "parent_email", "card_authorisation", "paid_subscription"];

export type AgeAssuranceFacts = {
  mode: AgeAssuranceMode;
  band: SafetyBand;
  /** What the payments slice has recorded for the family. `none` when the learner has no family. */
  familyLevel: AgeAssuranceLevel;
  /** The family's owner has proved their email address. */
  parentEmailVerified: boolean;
  /** Every required consent is given at its current version. */
  consentComplete: boolean;
  /** `off_dev_only` is honoured only here. */
  appEnv: "local" | "test" | "preview" | "production";
};

export type AgeAssuranceDecision = {
  satisfied: boolean;
  /** What is still needed, for the parent-facing explanation. */
  missing: Array<"card_or_subscription" | "parent_email" | "consent">;
};

const CARD_LEVELS: ReadonlySet<AgeAssuranceLevel> = new Set(["card_authorisation", "paid_subscription"]);

/**
 * The decision table. Pure.
 *
 *   mode                  13–15                          16–17                     18+
 *   card_or_subscription  card or subscription + consent  parent email + consent    nothing more
 *   parent_email          parent email + consent          parent email + consent    nothing more
 *   off_dev_only          nothing (local and test only; anywhere else it behaves as card_or_subscription)
 */
export function decideAgeAssurance(facts: AgeAssuranceFacts): AgeAssuranceDecision {
  if (facts.band === "adult_18") return { satisfied: true, missing: [] };

  let mode = facts.mode;
  if (mode === "off_dev_only") {
    if (facts.appEnv === "local" || facts.appEnv === "test") return { satisfied: true, missing: [] };
    // A development switch left on by mistake must never open Coach to children: fail closed.
    mode = "card_or_subscription";
  }

  const missing: AgeAssuranceDecision["missing"] = [];
  const needsCard = mode === "card_or_subscription" && facts.band === "teen_13_15";
  if (needsCard) {
    if (!CARD_LEVELS.has(facts.familyLevel)) missing.push("card_or_subscription");
  } else if (!facts.parentEmailVerified && !CARD_LEVELS.has(facts.familyLevel)) {
    // A card check is stronger evidence of an adult than an email address, so it also counts here.
    missing.push("parent_email");
  }
  if (!facts.consentComplete) missing.push("consent");
  return { satisfied: missing.length === 0, missing };
}

/** The facts and the decision for one learner, for pages that explain what is still needed. */
export async function getAgeAssurance(ctx: Pick<Ctx, "db" | "now">, learnerId: string): Promise<AgeAssuranceDecision & { band: SafetyBand; mode: AgeAssuranceMode }> {
  const learner = await getLearnerSummary(ctx, learnerId);
  const mode = await getSetting(ctx, "safety.age_assurance_mode");
  const familyInfo = learner.familyId ? await getFamily(ctx, learner.familyId) : null;
  const consentComplete = (await missingRequiredConsents(ctx, learnerId)).length === 0;
  const decision = decideAgeAssurance({
    mode,
    band: learner.safetyBand,
    familyLevel: familyInfo?.ageAssuranceLevel ?? "none",
    // An 18-year-old's own family does not vouch for anyone younger; only a parent's address counts.
    parentEmailVerified: familyInfo?.ownerKind === "parent" && familyInfo.ownerEmailVerified,
    consentComplete,
    appEnv: env.APP_ENV,
  });
  return { ...decision, band: learner.safetyBand, mode };
}

/**
 * Spec 3.1: a 13–15-year-old may not use Coach until their parent has completed a £0 card
 * authorisation or holds an active paid subscription; 16–17 need parent email verification and
 * consent; 18 needs nothing more. The mode comes from the `safety.age_assurance_mode` setting.
 */
export async function isAgeAssuranceSatisfied(ctx: Pick<Ctx, "db" | "now">, learnerId: string): Promise<boolean> {
  return (await getAgeAssurance(ctx, learnerId)).satisfied;
}

/**
 * Records that a family's adult has passed a check. Called by the payments slice from a verified
 * Stripe webhook (card authorisation succeeded, subscription became active) — never with a value
 * that came from a browser. The level only moves up: a lapsed subscription does not undo the fact
 * that an adult's card was once checked. TODO(legal): confirm that reading.
 */
export async function recordAgeAssurance(ctx: Ctx, familyId: string, method: AgeAssuranceMethod): Promise<void> {
  if (ctx.actor.type === "learner" || ctx.actor.type === "anonymous") {
    throw new AppError("forbidden", "You don't have permission to do that.");
  }
  if (ctx.actor.type === "parent" && (ctx.actor.familyId !== familyId || method !== "parent_email")) {
    // A parent's own session can only ever vouch for their own verified email, never for a card.
    throw new AppError("forbidden", "You don't have permission to do that.");
  }
  await ctx.db.transaction(async (tx) => {
    const rows = await tx.select({ level: family.ageAssuranceLevel }).from(family).where(eq(family.id, familyId)).for("update");
    const current = rows[0];
    if (!current) throw new AppError("not_found", "That family could not be found.");
    if (AGE_ASSURANCE_ORDER.indexOf(method) <= AGE_ASSURANCE_ORDER.indexOf(current.level)) return;
    await tx.update(family).set({ ageAssuranceLevel: method, ageAssuredAt: ctx.now, updatedAt: ctx.now }).where(eq(family.id, familyId));
    await audit(ctx, { action: "age_assurance.record", targetType: "family", targetId: familyId, meta: { method, previous: current.level } }, tx);
  });
}
