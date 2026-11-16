import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { submitQuizAttempt } from "@/server/services/quiz";
import { NO_STORE, learnerApiCtx } from "../../../../../_lib/learner";

/**
 * POST /api/v1/enrolments/:id/steps/:stepKey/quiz-attempts — one quiz attempt.
 *
 * Body: `{ answers: { [questionId]: optionId[] } }` (for an `order` question, the ids in the
 * learner's order). Graded on the server. The answer says which questions were right and gives
 * the feedback for the options chosen; it never includes the answer key. Retries are unlimited.
 */
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid(), stepKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).max(64) });
const bodySchema = z.strictObject({ answers: z.record(z.string().max(64), z.array(z.string().max(64)).max(50)) });

export const POST = handle(async (req, context: { params: Promise<{ id: string; stepKey: string }> }) => {
  const ctx = await learnerApiCtx(req);
  const params = paramsSchema.parse(await context.params);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "quiz.attempt", { limit: 30, windowSec: 60 });
  const result = await submitQuizAttempt(ctx, { enrolmentId: params.id, stepKey: params.stepKey, answers: input.answers });
  return Response.json(result, NO_STORE);
});
