import { z } from "zod";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { removeSaved, saveForLater } from "@/server/services/wishlist";
import { NO_STORE, learnerApiCtx } from "../../_lib/learner";

/**
 * PUT /api/v1/wishlist/:courseId — save a course for later. DELETE removes it.
 * Saving a course the learner may not see (too young, blocked, not live) answers 404.
 */
export const dynamic = "force-dynamic";

async function courseIdOf(context: { params: Promise<{ courseId: string }> }): Promise<string> {
  const parsed = z.uuid().safeParse((await context.params).courseId);
  if (!parsed.success) throw new AppError("not_found", "That course could not be found. It may have been moved or removed.");
  return parsed.data;
}

export const PUT = handle(async (req, context: { params: Promise<{ courseId: string }> }) => {
  const ctx = await learnerApiCtx(req);
  const courseId = await courseIdOf(context);
  await rateLimit(ctx, "wishlist.write", { limit: 60, windowSec: 60 });
  return Response.json(await saveForLater(ctx, ctx.actor.userId, courseId), NO_STORE);
});

export const DELETE = handle(async (req, context: { params: Promise<{ courseId: string }> }) => {
  const ctx = await learnerApiCtx(req);
  const courseId = await courseIdOf(context);
  await rateLimit(ctx, "wishlist.write", { limit: 60, windowSec: 60 });
  return Response.json(await removeSaved(ctx, ctx.actor.userId, courseId), NO_STORE);
});
