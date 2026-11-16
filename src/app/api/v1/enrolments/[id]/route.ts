import { z } from "zod";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { getEnrolmentById } from "@/server/services/enrolment";
import { loadPlayer } from "@/server/services/progress";
import { NO_STORE, learnerApiCtx } from "../../_lib/learner";

/**
 * GET /api/v1/enrolments/:id — one of the learner's own enrolments with the state of every step,
 * so any device can resume at the exact step. Behind the same gate as the player. No course
 * content is returned here.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req, context: { params: Promise<{ id: string }> }) => {
  const ctx = await learnerApiCtx(req);
  const id = z.uuid().safeParse((await context.params).id);
  const enrolment = id.success ? await getEnrolmentById(ctx, id.data) : null;
  if (!enrolment || enrolment.learnerId !== ctx.actor.userId) throw new AppError("not_found", "That course could not be found.");
  const player = await loadPlayer(ctx, { learnerId: ctx.actor.userId, courseSlug: enrolment.courseSlug });
  if (player.kind === "blocked") {
    const [blocker] = player.gate.decision.blockers;
    const message = player.gate.allowed.allowed ? (blocker?.message ?? "You can't open this course at the moment.") : player.gate.allowed.message;
    throw new AppError("forbidden", message);
  }
  if (player.kind !== "ok") throw new AppError("not_found", "That course could not be found.");
  return Response.json({ enrolment: player.enrolment, steps: player.steps, progress: player.progress, resumeStepKey: player.resumeKey }, NO_STORE);
});
