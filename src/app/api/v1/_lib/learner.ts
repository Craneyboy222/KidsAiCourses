import type { LearnerActor } from "@/server/authz";
import { resolveCtx, type Ctx } from "@/server/context";
import { AppError } from "@/server/errors";

/** The signed-in learner behind an API request. Anyone else is turned away before a service runs. */
export async function learnerApiCtx(req: Request): Promise<Ctx<LearnerActor>> {
  const ctx = await resolveCtx(req.headers);
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") throw new AppError("unauthenticated", "Please sign in to carry on.");
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That's for learner accounts.");
  return { ...ctx, actor: ctx.actor };
}

/** Responses about one learner are never stored by a browser or a proxy. */
export const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

