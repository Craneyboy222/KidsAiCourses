import { z } from "zod";
import { resolveCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getLearnerCoursePage, getPublicCoursePage } from "@/server/services/course-page";
import { NO_STORE } from "../../_lib/learner";

/**
 * GET /api/v1/courses/:slug — one course as an OUTLINE: what it is, what you make, modules,
 * lessons and step titles with timings. Never step content, quiz questions or answers.
 *
 * For a learner the age gate and a parent's block answer 404, exactly like a course that does not
 * exist; a paid course on the Free plan comes back `locked` with the same outline and no price.
 */
export const dynamic = "force-dynamic";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const NOT_FOUND = "That course could not be found. It may have been moved or removed.";

export const GET = handle(async (req, context: { params: Promise<{ slug: string }> }) => {
  const parsed = slugSchema.safeParse((await context.params).slug);
  if (!parsed.success) throw new AppError("not_found", NOT_FOUND);
  const ctx = await resolveCtx(req.headers);
  await rateLimit(ctx, "catalogue.course", { limit: 120, windowSec: 60 });

  if (ctx.actor.type === "learner") {
    const page = await getLearnerCoursePage(ctx, ctx.actor.userId, parsed.data);
    if (page.kind !== "ok") throw new AppError("not_found", NOT_FOUND);
    return Response.json(
      {
        course: page.course,
        courseId: page.courseId,
        locked: page.locked,
        saved: page.saved,
        enrolment: page.enrolment,
        canStart: page.gate.decision.allowed && page.gate.allowed.allowed,
        blockers: page.gate.decision.blockers,
      },
      NO_STORE,
    );
  }

  const page = await getPublicCoursePage(ctx, parsed.data);
  if (!page) throw new AppError("not_found", NOT_FOUND);
  return Response.json({ course: page.course, courseId: page.courseId }, NO_STORE);
});
