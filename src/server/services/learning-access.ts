import { eq } from "drizzle-orm";
import { assertCan, type Action } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { familyMember } from "@/server/db";

/** The family a learner belongs to, or null for a teen-first account that has no family yet. */
export async function familyIdOf(ctx: Pick<Ctx, "db">, learnerId: string): Promise<string | null> {
  const [row] = await ctx.db.select({ familyId: familyMember.familyId }).from(familyMember).where(eq(familyMember.userId, learnerId)).limit(1);
  return row?.familyId ?? null;
}

/**
 * The one ownership check for learning records: a learner on their own records, a parent inside
 * their own family, staff by role. The family is looked up from the learner, never taken from
 * request input, so a parent cannot name somebody else's child.
 */
export async function assertLearnerAccess(ctx: Ctx, action: Action, learnerId: string): Promise<void> {
  const familyId = ctx.actor.type === "parent" ? await familyIdOf(ctx, learnerId) : null;
  assertCan(ctx.actor, action, { learnerId, familyId });
}
