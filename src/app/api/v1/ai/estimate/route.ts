import { z } from "zod";
import { estimateCredits } from "@/server/ai/cost";
import { defaultModelGateway, toEnergyView } from "@/server/ai/deps";
import { COACH_ROUTE_ALIAS } from "@/server/ai/gateway";
import { MAX_MESSAGE_CHARS, MAX_OUTPUT_TOKENS } from "@/server/ai/proxy";
import { resolveCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getCreditBalance, getTutorMessagePrice } from "@/server/services/credits";
import { getSettings } from "@/server/settings/store";

/**
 * POST /api/v1/ai/estimate — roughly how much energy a message would use, and whether there is
 * enough. It calls no model and holds no credits. The answer is in energy only, never money.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  courseSlug: z.string().min(1).max(120),
  stepKey: z.string().min(1).max(80),
  message: z.string().max(MAX_MESSAGE_CHARS, "That message is too long for Coach. Try a shorter one."),
});

export const POST = handle(async (req) => {
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  const ctx = await resolveCtx(req.headers);
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") throw new AppError("unauthenticated", "Please sign in to carry on.");
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "Coach energy belongs to learner accounts.");
  await rateLimit(ctx, "coach.estimate", { limit: 60, windowSec: 60 });

  const [settings, minimumCredits, prices, balance] = await Promise.all([
    getSettings(ctx, ["coach.credit_value_pence", "coach.credit_margin"] as const),
    getTutorMessagePrice(ctx),
    defaultModelGateway().prices(ctx, COACH_ROUTE_ALIAS),
    getCreditBalance(ctx, ctx.actor.userId),
  ]);
  // One attempt: what a reply usually costs. The pipeline holds a little more in case it has to try twice.
  const usual = estimateCredits(
    { promptChars: 8000 + input.message.length, maxOutputTokens: MAX_OUTPUT_TOKENS, attempts: 1 },
    prices,
    { creditValuePence: settings["coach.credit_value_pence"], creditMargin: settings["coach.credit_margin"], minimumCredits },
  );
  const energy = toEnergyView(balance);
  return Response.json({ estimate: { energy: usual.credits, enough: energy.balance >= usual.credits }, energy }, { headers: { "Cache-Control": "no-store" } });
});
