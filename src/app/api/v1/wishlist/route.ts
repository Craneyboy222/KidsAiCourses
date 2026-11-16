import { handle } from "@/server/http";
import { listSaved } from "@/server/services/wishlist";
import { NO_STORE, learnerApiCtx } from "../_lib/learner";

/** GET /api/v1/wishlist — the learner's saved-for-later courses, as they may see them now. */
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  return Response.json({ items: await listSaved(ctx, ctx.actor.userId) }, NO_STORE);
});
