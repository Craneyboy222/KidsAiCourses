import { resolveCtx } from "@/server/context";
import { toEnergyView } from "@/server/ai/deps";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { getCreditBalance } from "@/server/services/credits";

/**
 * GET /api/v1/ai/credits — the learner's own Coach energy for the meter.
 * Whole numbers of energy and a reset date. Never a price: under-18s do not see money.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const ctx = await resolveCtx(req.headers);
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") throw new AppError("unauthenticated", "Please sign in to carry on.");
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "Coach energy belongs to learner accounts.");
  const balance = await getCreditBalance(ctx, ctx.actor.userId);
  return Response.json({ energy: toEnergyView(balance) }, { headers: { "Cache-Control": "no-store" } });
});
