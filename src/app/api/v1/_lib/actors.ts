import type { LearnerActor, ParentActor, StaffActor } from "@/server/authz";
import { resolveCtx, type Ctx } from "@/server/context";
import { AppError } from "@/server/errors";

/**
 * Who is behind an API request, for routes that are not learner-only (see `learner.ts` for those).
 * These turn the wrong kind of account away early; the service behind each route still makes the
 * real ownership check.
 */
export async function sessionApiCtx(req: Request): Promise<Ctx<LearnerActor | ParentActor | StaffActor>> {
  const ctx = await resolveCtx(req.headers);
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") throw new AppError("unauthenticated", "Please sign in to carry on.");
  return { ...ctx, actor: ctx.actor };
}

export async function parentApiCtx(req: Request): Promise<Ctx<ParentActor>> {
  const ctx = await sessionApiCtx(req);
  if (ctx.actor.type !== "parent") throw new AppError("forbidden", "That's for parent and carer accounts.");
  return { ...ctx, actor: ctx.actor };
}

export async function staffApiCtx(req: Request): Promise<Ctx<StaffActor>> {
  const ctx = await sessionApiCtx(req);
  if (ctx.actor.type !== "staff") throw new AppError("forbidden", "You don't have permission to do that.");
  if (!ctx.actor.twoFactorVerified) throw new AppError("two_factor_required", "Enter your two-step code to carry on.");
  return { ...ctx, actor: ctx.actor };
}

/** The learner a request is about: the signed-in learner, or the child a parent or member of staff names. */
export function learnerIdFor(ctx: Ctx<LearnerActor | ParentActor | StaffActor>, req: Request): string {
  if (ctx.actor.type === "learner") return ctx.actor.userId;
  const asked = new URL(req.url).searchParams.get("learnerId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(asked)) throw new AppError("invalid_input", "Say which learner you mean with ?learnerId=.");
  return asked;
}
