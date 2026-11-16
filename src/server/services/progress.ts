import { and, eq, sql } from "drizzle-orm";
import { flattenSteps, type FlatStep } from "@/content/course-utils";
import { safeParseStepConfig, toLearnerCourse, type Course, type LearnerCourse } from "@/content/schema";
import {
  canSkipStep,
  courseProgress,
  evaluateCompletion,
  isEvidenceRule,
  isWrittenStep,
  resumeStepKey,
  type CompletionCheck,
  type CourseProgress,
  type StepEvidence,
  type StepState,
} from "@/lib/learning/completion";
import { mergeStepData, readStepData, type StepData } from "@/lib/learning/step-data";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, enrolment, quizAttempt, reflection, step, stepProgress, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { isVideoPlayable, resolveCourseMedia } from "./course-page";
import { loadVersionContent } from "./course-store";
import { readEnrolmentView, refreshEnrolmentCompletion, type EnrolmentView } from "./enrolment";
import { gateError, gateHidden, gateOpen, gateUnavailable, getLearningGate, timeStop, type LearningGate } from "./learning-gate";

/** Longest note or written answer we store. Longer text is refused, never cut short silently. */
export const MAX_TEXT_LENGTH = 5000;

export type { StepData };

export type PlayerStepState = {
  /** The step id in the course JSON. */
  key: string;
  /** The materialised `step.id`. */
  id: string;
  status: StepState;
  disabled: boolean;
};

export type CurrentStepState = {
  data: StepData;
  notes: string;
  /** The learner's own words on a reflection or ethics checkpoint. Private to them. */
  response: string;
  quiz: { attempts: number; passed: boolean; bestScore: number | null } | null;
};

export type PlayerLoad =
  | { kind: "not_found" }
  /** No enrolment yet: the course page is where a course is started. */
  | { kind: "not_enrolled"; courseSlug: string }
  /** Taken down or unpublished: a clear notice and nothing else. */
  | { kind: "taken_down"; courseTitle: string }
  /** The gate is closed for a reason the learner is told about (a tool approval, the cap, quiet hours…). */
  | { kind: "blocked"; courseTitle: string; courseSlug: string; courseId: string; gate: LearningGate }
  | {
      kind: "ok";
      enrolment: EnrolmentView;
      course: LearnerCourse;
      steps: PlayerStepState[];
      progress: CourseProgress;
      /** Where "Continue" goes. */
      resumeKey: string | null;
      /** Present when a step key was asked for and exists. */
      current: (CurrentStepState & { key: string; id: string; disabled: boolean }) | null;
    };

/** The guide steps a `setup_guide` course step covers, or an empty list for any other step. */
export function guideStepIdsOf(flat: Pick<FlatStep, "step">): string[] {
  const parsed = safeParseStepConfig(flat.step);
  return parsed.success && parsed.data.type === "setup_guide" ? parsed.data.config.throughStepIds : [];
}

const evidenceFor = (flat: FlatStep, data: StepData, responseLength: number, quizPassed: boolean): StepEvidence => ({
  watchedFraction: data.watchedFraction,
  transcriptRead: data.transcriptRead,
  ticked: data.ticked,
  guideTicks: data.guideTicks,
  responseLength,
  quizPassed,
  evidence: data.evidence ?? "none",
});

const completionStepOf = (flat: FlatStep) => ({
  type: flat.step.type,
  rule: flat.step.completion.rule,
  threshold: flat.step.completion.threshold,
  guideStepIds: guideStepIdsOf(flat),
});

/** True when the step has a video file AND its captions in storage: a video is never shown without captions. */
async function videoPlayable(ctx: Pick<Ctx, "db">, flat: FlatStep): Promise<boolean> {
  return isVideoPlayable(await resolveCourseMedia(ctx, flat.step.assetIds ?? []));
}

type StepRow = { id: string; key: string; disabled: boolean };

async function stepRowsOf(db: Db, versionId: string): Promise<Map<string, StepRow>> {
  const rows = await db.select({ id: step.id, key: step.key, disabled: step.disabled }).from(step).where(eq(step.courseVersionId, versionId));
  return new Map(rows.map((row) => [row.key, row]));
}

async function stepStatesOf(db: Db, enrolmentId: string, content: Course, rows: Map<string, StepRow>): Promise<{ steps: PlayerStepState[]; raw: Map<string, typeof stepProgress.$inferSelect> }> {
  const progress = await db.select().from(stepProgress).where(eq(stepProgress.enrolmentId, enrolmentId));
  const byStepId = new Map(progress.map((row) => [row.stepId, row]));
  const steps: PlayerStepState[] = [];
  for (const flat of flattenSteps(content)) {
    const row = rows.get(flat.step.id);
    if (!row) continue;
    steps.push({ key: flat.step.id, id: row.id, status: byStepId.get(row.id)?.status ?? "not_started", disabled: row.disabled });
  }
  return { steps, raw: byStepId };
}

async function quizStateOf(db: Db, enrolmentId: string, stepId: string): Promise<{ attempts: number; passed: boolean; bestScore: number | null }> {
  const [row] = await db
    .select({ attempts: sql<number>`count(*)::int`, passed: sql<boolean>`coalesce(bool_or(${quizAttempt.passed}), false)`, bestScore: sql<number | null>`max(${quizAttempt.score})` })
    .from(quizAttempt)
    .where(and(eq(quizAttempt.enrolmentId, enrolmentId), eq(quizAttempt.stepId, stepId)));
  return { attempts: row?.attempts ?? 0, passed: row?.passed ?? false, bestScore: row?.bestScore ?? null };
}

/**
 * Everything the player needs for one learner and one course, behind the gate.
 *
 * The content is the version the learner STARTED (`enrolment.course_version_id`), not whatever is
 * live now, and it has been through `toLearnerCourse`: no quiz answers, no option feedback, no
 * `coachContext`, no editor notes. Nothing is written here: a page render (or a prefetch of one)
 * must never move a learner's resume point. The player says "opened" itself, through `saveStep`.
 */
export async function loadPlayer(ctx: Ctx, input: { learnerId: string; courseSlug: string; stepKey?: string }): Promise<PlayerLoad> {
  assertCan(ctx.actor, "learner.progress.read", { learnerId: input.learnerId });
  const [courseRow] = await ctx.db.select({ id: course.id, slug: course.slug, title: course.title }).from(course).where(eq(course.slug, input.courseSlug)).limit(1);
  if (!courseRow) return { kind: "not_found" };

  const [enrolled] = await ctx.db
    .select({ id: enrolment.id, courseVersionId: enrolment.courseVersionId })
    .from(enrolment)
    .where(and(eq(enrolment.learnerId, input.learnerId), eq(enrolment.courseId, courseRow.id)))
    .limit(1);

  const gate = await getLearningGate(ctx, input.learnerId, courseRow.id);
  // Too young, or blocked by a parent: exactly as if the course did not exist, enrolled or not.
  if (gateHidden(gate)) return { kind: "not_found" };
  if (!enrolled) return gateUnavailable(gate) ? { kind: "not_found" } : { kind: "not_enrolled", courseSlug: courseRow.slug };
  if (gateUnavailable(gate)) return { kind: "taken_down", courseTitle: courseRow.title };
  if (!gateOpen(gate)) return { kind: "blocked", courseTitle: courseRow.title, courseSlug: courseRow.slug, courseId: courseRow.id, gate };

  const view = await readEnrolmentView(ctx.db, enrolled.id);
  if (!view) return { kind: "not_found" };
  const content = await loadVersionContent(ctx, enrolled.courseVersionId);
  const rows = await stepRowsOf(ctx.db, enrolled.courseVersionId);
  const { steps, raw } = await stepStatesOf(ctx.db, enrolled.id, content, rows);

  let current: Extract<PlayerLoad, { kind: "ok" }>["current"] = null;
  const wanted = input.stepKey ? steps.find((entry) => entry.key === input.stepKey) : undefined;
  const flat = wanted ? flattenSteps(content).find((entry) => entry.step.id === wanted.key) : undefined;
  if (wanted && flat) {
    const stored = raw.get(wanted.id);
    let response = "";
    if (isWrittenStep(flat.step.type)) {
      const [written] = await ctx.db.select({ body: reflection.body }).from(reflection).where(and(eq(reflection.enrolmentId, enrolled.id), eq(reflection.stepId, wanted.id))).limit(1);
      response = written?.body ?? "";
    }
    current = {
      key: wanted.key,
      id: wanted.id,
      disabled: wanted.disabled,
      data: readStepData(stored?.data),
      notes: stored?.notes ?? "",
      response,
      quiz: flat.step.type === "quiz" ? await quizStateOf(ctx.db, enrolled.id, wanted.id) : null,
    };
  }

  return {
    kind: "ok",
    enrolment: view,
    course: toLearnerCourse(content),
    steps,
    progress: courseProgress(steps),
    resumeKey: resumeStepKey(steps, view.currentStepKey),
    current,
  };
}

export type SaveStepInput = {
  enrolmentId: string;
  stepKey: string;
  /** `open`: the learner is looking at this step (sets the resume point). `save`: autosave. */
  intent: "open" | "save" | "complete" | "skip";
  notes?: string;
  response?: string;
  data?: unknown;
};

export type SaveStepResult = {
  /** True when anything the learner sent was written. */
  saved: boolean;
  status: StepState;
  data: StepData;
  /** Why "complete" did not complete the step, in words for the learner. */
  completion: CompletionCheck | null;
  /** Set when the daily cap or quiet hours arrived: the work above was saved first, and learning now stops. */
  stopped: { reason: "time_cap" | "quiet_hours"; message: string } | null;
  progress: CourseProgress;
  courseCompleted: boolean;
  nextStepKey: string | null;
};

/**
 * Autosave, completion and skip for one step.
 *
 * Order matters (brief: "never lose work when the cap is reached: save first, then stop"):
 *  1. The gate. A course the learner may not use at all (too young, blocked, taken down, a tool
 *     approval withdrawn, account paused) is refused and nothing is written.
 *  2. If the only thing in the way is the daily cap or quiet hours, the learner's own words and
 *     ticks are still written, the step is NOT completed or skipped, and `stopped` says why.
 *  3. Otherwise the step is saved and, if asked, completed. Completion is decided here by
 *     `evaluateCompletion`, never by the browser. Evidence steps are completed only by
 *     `recordEvidenceOutcome`.
 */
export async function saveStep(ctx: Ctx, input: SaveStepInput): Promise<SaveStepResult> {
  const [target] = await ctx.db
    .select({ id: enrolment.id, learnerId: enrolment.learnerId, courseId: enrolment.courseId, courseVersionId: enrolment.courseVersionId, status: enrolment.status })
    .from(enrolment)
    .where(eq(enrolment.id, input.enrolmentId))
    .limit(1);
  // Not yours and not there get the same answer.
  if (!target || ctx.actor.type !== "learner" || ctx.actor.userId !== target.learnerId) {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("not_found", "That course could not be found.");
  }
  assertCan(ctx.actor, "learner.progress.write", { learnerId: target.learnerId });
  for (const [name, value] of [["notes", input.notes], ["response", input.response]] as const) {
    if (value !== undefined && value.length > MAX_TEXT_LENGTH) {
      throw new AppError("invalid_input", `That's longer than we can save (${MAX_TEXT_LENGTH.toLocaleString("en-GB")} characters). Trim it a little and it will save.`, { fieldErrors: { [name]: ["Too long"] } });
    }
  }

  const gate = await getLearningGate(ctx, target.learnerId, target.courseId);
  const stop = timeStop(gate);
  if (!gateOpen(gate) && !stop) throw gateError(gate) ?? new AppError("forbidden", "You can't open this course at the moment.");

  const content = await loadVersionContent(ctx, target.courseVersionId);
  const all = flattenSteps(content);
  const flat = all.find((entry) => entry.step.id === input.stepKey);
  const rows = await stepRowsOf(ctx.db, target.courseVersionId);
  const row = rows.get(input.stepKey);
  if (!flat || !row) throw new AppError("not_found", "That step could not be found in this course.");

  const written = isWrittenStep(flat.step.type);
  const intent = stop ? "save" : input.intent;

  const outcome = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(stepProgress).where(and(eq(stepProgress.enrolmentId, target.id), eq(stepProgress.stepId, row.id))).for("update");
    const before = readStepData(existing?.data);
    const data = row.disabled ? before : mergeStepData(before, input.data, { hintCount: flat.step.hints.length, guideStepIds: guideStepIdsOf(flat) });
    let status: StepState = existing?.status ?? "not_started";
    let completedAt = existing?.completedAt ?? null;
    let skippedAt = existing?.skippedAt ?? null;
    let completion: CompletionCheck | null = null;

    let responseLength = 0;
    if (written) {
      if (input.response !== undefined && !row.disabled) {
        const body = input.response.trim();
        responseLength = body.length;
        await tx
          .insert(reflection)
          .values({ learnerId: target.learnerId, enrolmentId: target.id, stepId: row.id, body, createdAt: ctx.now, updatedAt: ctx.now })
          .onConflictDoUpdate({ target: [reflection.enrolmentId, reflection.stepId], set: { body, moderationState: "pending", updatedAt: ctx.now } });
      } else {
        const [stored] = await tx.select({ body: reflection.body }).from(reflection).where(and(eq(reflection.enrolmentId, target.id), eq(reflection.stepId, row.id))).limit(1);
        responseLength = stored?.body.trim().length ?? 0;
      }
    }

    if (status !== "completed" && !row.disabled) {
      if (status === "not_started") status = "in_progress";
      const quizPassed = flat.step.type === "quiz" ? (await quizStateOf(tx, target.id, row.id)).passed : false;
      const check = evaluateCompletion(completionStepOf(flat), evidenceFor(flat, data, responseLength, quizPassed));
      // A video ticks itself off once enough has been watched; everything else waits to be asked.
      const selfCompleting = flat.step.type === "video" && flat.step.completion.rule === "view";
      if (!stop && !isEvidenceRule(flat.step.completion.rule) && (intent === "complete" || (selfCompleting && intent !== "skip"))) {
        // A video we cannot play must never hold a learner back: the server checks, not the browser.
        const done = check.complete || (!check.complete && check.code === "watch_more" && intent === "complete" && !(await videoPlayable(ctx, flat)));
        if (done) {
          status = "completed";
          completedAt = ctx.now;
          skippedAt = null;
        } else if (intent === "complete") completion = check;
      } else if (intent === "complete") {
        completion = check.complete ? null : check;
      }
      if (intent === "skip" && status !== "completed") {
        if (!canSkipStep(flat.step.type)) throw new AppError("invalid_input", "The last step can't be skipped. Send in your work when you're ready.");
        status = "skipped";
        skippedAt = ctx.now;
      }
    }

    const notes = input.notes !== undefined ? input.notes : (existing?.notes ?? null);
    await tx
      .insert(stepProgress)
      .values({ enrolmentId: target.id, learnerId: target.learnerId, stepId: row.id, status, notes, data, completedAt, skippedAt, createdAt: ctx.now, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: [stepProgress.enrolmentId, stepProgress.stepId], set: { status, notes, data, completedAt, skippedAt, updatedAt: ctx.now } });
    // The resume point is the step in front of the learner.
    await tx.update(enrolment).set({ currentStepId: row.id, lastActivityAt: ctx.now, updatedAt: ctx.now }).where(eq(enrolment.id, target.id));
    await refreshEnrolmentCompletion(tx, target.id, ctx.now);
    return { status, data, completion };
  });

  const { steps } = await stepStatesOf(ctx.db, target.id, content, rows);
  const progress = courseProgress(steps);
  const index = all.findIndex((entry) => entry.step.id === input.stepKey);
  return {
    saved: true,
    status: outcome.status,
    data: outcome.data,
    completion: outcome.completion,
    stopped: stop,
    progress,
    courseCompleted: progress.done,
    nextStepKey: all[index + 1]?.step.id ?? null,
  };
}
