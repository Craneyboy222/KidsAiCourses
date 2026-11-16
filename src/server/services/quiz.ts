import { and, eq, sql } from "drizzle-orm";
import { flattenSteps } from "@/content/course-utils";
import { safeParseStepConfig, type Course, type Quiz } from "@/content/schema";
import { courseProgress, type CourseProgress, type StepState } from "@/lib/learning/completion";
import { gradeQuiz, storedAnswers, type QuizResult } from "@/lib/learning/quiz-grading";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { enrolment, quiz, quizAttempt, step, stepProgress } from "@/server/db";
import { AppError } from "@/server/errors";
import { loadVersionContent } from "./course-store";
import { refreshEnrolmentCompletion } from "./enrolment";
import { assertLearningGate } from "./learning-gate";
import { resolvePreview } from "./preview";

export type QuizAttemptResult = QuizResult & {
  attemptNumber: number;
  stepStatus: StepState;
  progress: CourseProgress | null;
};

/** The quiz a `quiz` step points at, and the pass mark that applies (the step's threshold, else the quiz's own). */
export function quizForStep(content: Course, stepKey: string): { quiz: Quiz; passFraction: number } | null {
  const flat = flattenSteps(content).find((entry) => entry.step.id === stepKey);
  if (!flat || flat.step.type !== "quiz") return null;
  const parsed = safeParseStepConfig(flat.step);
  if (!parsed.success || parsed.data.type !== "quiz") return null;
  const quizId = parsed.data.config.quizId;
  const found = content.quizzes.find((entry) => entry.id === quizId);
  if (!found) return null;
  return { quiz: found, passFraction: flat.step.completion.threshold ?? found.passMark };
}

/**
 * One quiz attempt, graded here on the server against the version the learner is pinned to.
 * Retries are unlimited and there is no timer (spec 3.2). The result carries feedback for the
 * options the learner chose and whether each question was right, never the whole answer key.
 * Passing completes the step.
 */
export async function submitQuizAttempt(ctx: Ctx, input: { enrolmentId: string; stepKey: string; answers: unknown }): Promise<QuizAttemptResult> {
  const [target] = await ctx.db
    .select({ id: enrolment.id, learnerId: enrolment.learnerId, courseId: enrolment.courseId, courseVersionId: enrolment.courseVersionId })
    .from(enrolment)
    .where(eq(enrolment.id, input.enrolmentId))
    .limit(1);
  if (!target || ctx.actor.type !== "learner" || ctx.actor.userId !== target.learnerId) {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("not_found", "That course could not be found.");
  }
  assertCan(ctx.actor, "learner.quiz.attempt", { learnerId: target.learnerId });
  await assertLearningGate(ctx, target.learnerId, target.courseId);

  const content = await loadVersionContent(ctx, target.courseVersionId);
  const found = quizForStep(content, input.stepKey);
  const [stepRow] = await ctx.db
    .select({ id: step.id, disabled: step.disabled })
    .from(step)
    .where(and(eq(step.courseVersionId, target.courseVersionId), eq(step.key, input.stepKey)))
    .limit(1);
  if (!found || !stepRow) throw new AppError("not_found", "That quiz could not be found in this course.");
  if (stepRow.disabled) throw new AppError("conflict", "This quiz is switched off at the moment, so there's nothing to answer. Carry on to the next step.");
  const [quizRow] = await ctx.db.select({ id: quiz.id }).from(quiz).where(and(eq(quiz.courseVersionId, target.courseVersionId), eq(quiz.key, found.quiz.id))).limit(1);
  if (!quizRow) throw new AppError("not_found", "That quiz could not be found in this course.");

  const result = gradeQuiz(found.quiz, input.answers, found.passFraction);
  const answers = storedAnswers(found.quiz, input.answers);

  const saved = await ctx.db.transaction(async (tx) => {
    // The progress row is the lock, so two attempts sent at once are numbered one after the other.
    await tx
      .insert(stepProgress)
      .values({ enrolmentId: target.id, learnerId: target.learnerId, stepId: stepRow.id, status: "in_progress", createdAt: ctx.now, updatedAt: ctx.now })
      .onConflictDoNothing({ target: [stepProgress.enrolmentId, stepProgress.stepId] });
    const [current] = await tx.select().from(stepProgress).where(and(eq(stepProgress.enrolmentId, target.id), eq(stepProgress.stepId, stepRow.id))).for("update");
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(quizAttempt)
      .where(and(eq(quizAttempt.enrolmentId, target.id), eq(quizAttempt.stepId, stepRow.id)));
    const attemptNumber = (count?.n ?? 0) + 1;
    await tx.insert(quizAttempt).values({
      learnerId: target.learnerId,
      enrolmentId: target.id,
      quizId: quizRow.id,
      stepId: stepRow.id,
      attemptNumber,
      answers,
      score: result.score,
      passed: result.passed,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    let status: StepState = current?.status ?? "in_progress";
    if (result.passed && status !== "completed") {
      status = "completed";
      await tx
        .update(stepProgress)
        .set({ status, completedAt: ctx.now, skippedAt: null, updatedAt: ctx.now })
        .where(and(eq(stepProgress.enrolmentId, target.id), eq(stepProgress.stepId, stepRow.id)));
    } else if (status === "not_started" || status === "skipped") {
      status = "in_progress";
      await tx
        .update(stepProgress)
        .set({ status, skippedAt: null, updatedAt: ctx.now })
        .where(and(eq(stepProgress.enrolmentId, target.id), eq(stepProgress.stepId, stepRow.id)));
    }
    await tx.update(enrolment).set({ currentStepId: stepRow.id, lastActivityAt: ctx.now, updatedAt: ctx.now }).where(eq(enrolment.id, target.id));
    await refreshEnrolmentCompletion(tx, target.id, ctx.now);
    return { attemptNumber, status };
  });

  const rows = await ctx.db
    .select({ key: step.key, disabled: step.disabled, status: stepProgress.status })
    .from(step)
    .leftJoin(stepProgress, and(eq(stepProgress.stepId, step.id), eq(stepProgress.enrolmentId, target.id)))
    .where(eq(step.courseVersionId, target.courseVersionId));
  const progress = courseProgress(rows.map((row) => ({ key: row.key, disabled: row.disabled, status: row.status ?? "not_started" })));
  return { ...result, attemptNumber: saved.attemptNumber, stepStatus: saved.status, progress };
}

/**
 * Grades a quiz in a staff preview of a draft (spec 6.3: "complete a quiz … without issuing a
 * certificate or writing learner analytics"). Same grading, and NOTHING is written: no attempt, no
 * progress, no enrolment. `resolvePreview` decides who may see the draft; to anyone else the quiz
 * does not exist.
 */
export async function gradePreviewQuiz(ctx: Ctx, input: { versionId: string; stepKey: string; answers: unknown }): Promise<QuizAttemptResult> {
  const session = await resolvePreview(ctx, { versionId: input.versionId });
  const found = session ? quizForStep(session.content, input.stepKey) : null;
  if (!session || !found) throw new AppError("not_found", "That quiz could not be found.");
  const result = gradeQuiz(found.quiz, input.answers, found.passFraction);
  return { ...result, attemptNumber: 0, stepStatus: result.passed ? "completed" : "in_progress", progress: null };
}
