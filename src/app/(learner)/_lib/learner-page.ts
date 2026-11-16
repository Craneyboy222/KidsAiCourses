import { redirect } from "next/navigation";
import type { LearnerActor } from "@/server/authz";
import { getCtx, type Ctx } from "@/server/context";
import { getLearnerSummary, type LearnerSummary } from "@/server/services/family";
import { WAITING_PATH, resolveAfterSignIn } from "@/server/services/sign-in";

export type LearnerPage = {
  ctx: Ctx<LearnerActor>;
  learnerId: string;
  summary: LearnerSummary;
  /** False while the account is paused: pages show the notice instead of content, and services would refuse anyway. */
  active: boolean;
};

/**
 * The start of every learner page: who is asking, or a redirect.
 *
 * Signed out → sign in (and come back). A parent or staff member → their own home. A teen still
 * waiting for a parent → the waiting page. An active learner who has not finished onboarding →
 * onboarding (a layout cannot do this one: it also wraps the onboarding page itself).
 *
 * This is the real check on each page. The layout's own redirect is only there so the frame never
 * renders for the wrong person.
 */
export async function requireLearnerPage(path: string): Promise<LearnerPage> {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect(`/signin?next=${encodeURIComponent(path)}`);
  if (ctx.actor.type !== "learner") redirect((await resolveAfterSignIn(ctx)).path);
  const actor = ctx.actor;
  if (actor.status === "pending_parent") redirect(WAITING_PATH);
  const summary = await getLearnerSummary(ctx, actor.userId);
  const active = actor.status === "active";
  if (active && !summary.onboardingCompleted) redirect("/onboarding");
  return { ctx: { ...ctx, actor }, learnerId: actor.userId, summary, active };
}
