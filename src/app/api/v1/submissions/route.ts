import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSubmissionState, submitWork } from "@/server/services/submission";
import { NO_STORE, learnerApiCtx } from "../_lib/learner";

/**
 * GET /api/v1/submissions?enrolmentId=&stepId= — where the learner is with an evidence step.
 * POST /api/v1/submissions `{ enrolmentId, stepId, title?, note?, selfCheck }` — hand in. The answer
 * is `accepted` or `awaiting_review`; nothing is in the portfolio, and no certificate is issued,
 * until it is accepted.
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({ enrolmentId: z.uuid(), stepId: z.uuid() });
const bodySchema = z.strictObject({ enrolmentId: z.uuid(), stepId: z.uuid(), title: z.string().max(400).optional(), note: z.string().max(4000).optional(), selfCheck: z.record(z.string().max(64), z.string().max(40)).optional() });

export const GET = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ submission: await getSubmissionState(ctx, query) }, NO_STORE);
});

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "submission.submit", { limit: 10, windowSec: 3600 });
  return Response.json(await submitWork(ctx, input), NO_STORE);
});
