import "server-only";
import { notFound, redirect } from "next/navigation";
import type { LearnerActor } from "@/server/authz";
import { getCtx, type Ctx } from "@/server/context";
import { isAppError } from "@/server/errors";
import { getBillingOverview, type BillingOverview } from "@/server/services/billing";
import { resolveAfterSignIn } from "@/server/services/sign-in";

/**
 * The two billing pages for an 18-year-old who owns their own account (spec Section 11: "An
 * 18-year-old can subscribe themselves to Family").
 *
 * For every other learner these pages do not exist: a learner under 18, or an 18-year-old whose
 * plan belongs to a parent, gets the ordinary "not found" page, which says nothing about plans or
 * money. The decision is `getBillingOverview`'s (through `resolveBillingAccount`), not this file's.
 */
export async function requireAdultBillingPage(path: string): Promise<{ ctx: Ctx<LearnerActor>; overview: BillingOverview }> {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect(`/signin?next=${encodeURIComponent(path)}`);
  if (ctx.actor.type !== "learner") redirect((await resolveAfterSignIn(ctx)).path);
  const learnerCtx = { ...ctx, actor: ctx.actor };
  try {
    return { ctx: learnerCtx, overview: await getBillingOverview(learnerCtx) };
  } catch (error) {
    if (isAppError(error) && (error.code === "forbidden" || error.code === "paused")) notFound();
    throw error;
  }
}
