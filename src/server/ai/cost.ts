/**
 * Money and energy maths for Coach (spec Section 8, "Credits").
 *
 * Units: provider prices are whole pence per million tokens; one model call costs a fraction of a
 * penny, so request costs are whole MILLIPENCE (1,000 millipence = 1p), always rounded UP so the
 * daily spend cap can never be under-counted. Credits ("AI energy") are whole numbers.
 * Learners never see any of the money figures: only energy.
 */

export type TokenPrices = { inputPencePerMillionTokens: number; outputPencePerMillionTokens: number };
export type TokenUsage = { inputTokens: number; outputTokens: number };
export type CreditPricing = {
  /** `coach.credit_value_pence`: what one credit is worth. Default 0.1p. */
  creditValuePence: number;
  /** `coach.credit_margin`: multiplier on model cost. Default 1.3. */
  creditMargin: number;
  /** `credit_price` for `tutor.message`: the least a reply ever costs. Default 1. */
  minimumCredits: number;
};

export const DEFAULT_CREDIT_PRICING: CreditPricing = { creditValuePence: 0.1, creditMargin: 1.3, minimumCredits: 1 };

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Cost of one model call in millipence, rounded up. */
export function costMillipence(usage: TokenUsage, prices: TokenPrices): number {
  const pence =
    (whole(usage.inputTokens) * Math.max(0, prices.inputPencePerMillionTokens) +
      whole(usage.outputTokens) * Math.max(0, prices.outputPencePerMillionTokens)) /
    1_000_000;
  // Guard against floating-point dust before rounding up (0.30000000000000004 → 1 would overcharge).
  return Math.ceil(Number((pence * 1000).toFixed(6)));
}

/** Credits for a model cost: cost × margin ÷ credit value, rounded up, never below the minimum. */
export function creditsForCost(millipence: number, pricing: CreditPricing = DEFAULT_CREDIT_PRICING): number {
  const minimum = Math.max(0, Math.ceil(pricing.minimumCredits));
  if (!(pricing.creditValuePence > 0) || !(millipence > 0)) return minimum;
  const pence = (millipence / 1000) * Math.max(1, pricing.creditMargin);
  return Math.max(minimum, Math.ceil(Number((pence / pricing.creditValuePence).toFixed(6))));
}

/** A rough token count for text we are about to send: about four characters a token, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The most a reply could cost, used for the reservation: the whole prompt in, the full output
 * allowance out, and twice over because a blocked reply is regenerated once.
 */
export function estimateCredits(
  input: { promptChars: number; maxOutputTokens: number; attempts?: number },
  prices: TokenPrices,
  pricing: CreditPricing = DEFAULT_CREDIT_PRICING,
): { credits: number; millipence: number } {
  const attempts = Math.max(1, input.attempts ?? 2);
  const millipence =
    costMillipence({ inputTokens: Math.ceil(Math.max(0, input.promptChars) / 4), outputTokens: Math.max(0, input.maxOutputTokens) }, prices) * attempts;
  return { credits: creditsForCost(millipence, pricing), millipence };
}

/** What to take from a reservation once the real cost is known: never more than was reserved. */
export function creditsToCommit(reserved: number, actualMillipence: number, pricing: CreditPricing = DEFAULT_CREDIT_PRICING): number {
  return Math.max(0, Math.min(Math.max(0, Math.floor(reserved)), creditsForCost(actualMillipence, pricing)));
}

export type SpendLevel = "ok" | "alert" | "tripped";

/** Where today's spend sits against the cap: alert from 80%, tripped from 100%. A cap of 0 trips at once. */
export function spendLevel(spentMillipence: number, capPence: number): SpendLevel {
  const cap = Math.max(0, capPence) * 1000;
  if (spentMillipence >= cap) return "tripped";
  if (spentMillipence >= cap * 0.8) return "alert";
  return "ok";
}

/** The energy meter: a whole-number level from 0 to 100, with no money in it. */
export function energyPercent(balance: number, allowance: number): number {
  if (!(allowance > 0)) return balance > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((balance / allowance) * 100)));
}
