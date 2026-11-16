"use server";

import { z } from "zod";
import type { QuizOutcome } from "@/components/course/player/store";
import { runAction } from "@/server/action";
import { getCtx } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { gradePreviewQuiz } from "@/server/services/quiz";

const inputSchema = z.object({
  versionId: z.uuid(),
  stepKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).max(64),
  answers: z.record(z.string().max(64), z.array(z.string().max(64)).max(50)),
});

/**
 * Marks a quiz inside a staff preview of a draft. It reads the draft through `resolvePreview`
 * (staff with `course.preview` only; to anyone else the quiz does not exist) and writes nothing:
 * no attempt, no progress, no enrolment, no analytics. Not a mutation, so it lives with the view
 * that calls it rather than under `src/app`.
 */
export async function gradePreviewQuizAction(versionId: string, stepKey: string, answers: Record<string, string[]>): Promise<QuizOutcome> {
  const result = await runAction(async () => {
    const input = inputSchema.parse({ versionId, stepKey, answers });
    const ctx = await getCtx();
    await rateLimit(ctx, "preview.quiz", { limit: 60, windowSec: 60 });
    return gradePreviewQuiz(ctx, input);
  });
  return result.ok ? result.data : { error: result.error.message };
}
