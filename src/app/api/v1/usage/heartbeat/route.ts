import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { recordHeartbeat } from "@/server/services/usage";
import { NO_STORE, learnerApiCtx } from "../../_lib/learner";

/**
 * POST /api/v1/usage/heartbeat `{ seconds }` — active learning time (spec 3.2, 3.6).
 *
 * The player sends how long the tab has been VISIBLE since its last beat; nothing is sent while
 * the tab is hidden. The server bounds the number by its own clock (see `creditableSeconds`), adds
 * it to today's total and answers whether learning may carry on: at the daily cap or in quiet
 * hours the answer is `{ allowed: false, reason, message }` and the player saves, then stops.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ seconds: z.number().min(0).max(3600) });

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "usage.heartbeat", { limit: 20, windowSec: 60 });
  return Response.json(await recordHeartbeat(ctx, ctx.actor.userId, input.seconds), NO_STORE);
});
