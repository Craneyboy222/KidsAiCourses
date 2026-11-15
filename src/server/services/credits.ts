// CONTRACT — owner: Coach slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type CreditBalance = { balance: number; monthlyAllowance: number; periodKey: string; resetsAt: Date };

/** Coach credits for the current period. Unused credits do not roll over (spec 3.5). */
export async function getCreditBalance(_ctx: Ctx, _learnerId: string): Promise<CreditBalance> {
  return notImplemented("credits.getCreditBalance");
}
/** Adds credits through the append-only ledger (promo credit grants, support goodwill). Idempotent on `idempotencyKey`. */
export async function grantCredits(_ctx: Ctx, _input: { learnerId: string; amount: number; reason: string; idempotencyKey: string }): Promise<CreditBalance> {
  return notImplemented("credits.grantCredits");
}
