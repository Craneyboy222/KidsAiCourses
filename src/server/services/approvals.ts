// CONTRACT — owner: parents slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

/**
 * Everything waiting for a parent's decision: tool consents, parent-operated account
 * confirmations and unlock requests (spec 3.6). Used for the badge in the parent shell.
 */
export async function countPendingApprovals(_ctx: Ctx, _familyId: string): Promise<number> {
  return notImplemented("approvals.countPendingApprovals");
}
