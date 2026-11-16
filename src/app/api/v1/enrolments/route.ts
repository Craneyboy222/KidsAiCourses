import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { listEnrolments, startCourse } from "@/server/services/enrolment";
import { NO_STORE, learnerApiCtx } from "../_lib/learner";

/**
 * GET /api/v1/enrolments — the learner's own courses, most recently active first.
 * POST /api/v1/enrolments `{ courseSlug }` — start a course (or get the enrolment that exists).
 *
 * Starting runs the same gate as the Start button: age, parent blocks, plan, tool approvals, the
 * daily cap and quiet hours. A course the learner may not see answers 404.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ courseSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120) });

export const GET = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  return Response.json({ enrolments: await listEnrolments(ctx, ctx.actor.userId) }, NO_STORE);
});

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "enrolment.start", { limit: 30, windowSec: 3600 });
  const result = await startCourse(ctx, { learnerId: ctx.actor.userId, courseSlug: input.courseSlug });
  return Response.json(result, { status: result.created ? 201 : 200, ...NO_STORE });
});
