import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { MAX_TEXT_LENGTH, saveStep } from "@/server/services/progress";
import { NO_STORE, learnerApiCtx } from "../../../../_lib/learner";

/**
 * PUT /api/v1/enrolments/:id/steps/:stepKey — autosave, complete or skip one step.
 *
 * Body: `{ intent: "open" | "save" | "complete" | "skip", notes?, response?, data? }`.
 * The server decides whether the step is complete; the browser only says what happened.
 * When the daily cap or quiet hours arrive, what was sent is SAVED and the answer carries
 * `stopped`, so no work is lost. A course the learner may no longer use is refused.
 */
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid(), stepKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).max(64) });

const bodySchema = z.strictObject({
  intent: z.enum(["open", "save", "complete", "skip"]),
  notes: z.string().max(MAX_TEXT_LENGTH, "That note is too long to save. Trim it a little.").optional(),
  response: z.string().max(MAX_TEXT_LENGTH, "That's too long to save. Trim it a little.").optional(),
  data: z
    .strictObject({
      watchedFraction: z.number().min(0).max(1).optional(),
      position: z.number().min(0).optional(),
      speed: z.number().optional(),
      transcriptRead: z.boolean().optional(),
      guideTicks: z.array(z.string().max(64)).max(100).optional(),
      ticked: z.boolean().optional(),
      hintLevel: z.number().int().min(0).max(50).optional(),
    })
    .optional(),
});

export const PUT = handle(async (req, context: { params: Promise<{ id: string; stepKey: string }> }) => {
  const ctx = await learnerApiCtx(req);
  const params = paramsSchema.parse(await context.params);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  // Far above what a person produces (a save every few seconds), low enough to stop a runaway script.
  await rateLimit(ctx, "progress.save", { limit: 240, windowSec: 60 });
  const result = await saveStep(ctx, { enrolmentId: params.id, stepKey: params.stepKey, ...input });
  return Response.json(result, NO_STORE);
});
