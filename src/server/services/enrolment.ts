// CONTRACT — owner: learning slice. See _contract.ts.
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { firstStep } from "@/content/course-utils";
import { isEvidenceRule } from "@/lib/learning/completion";
import { assertCan, can } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, enrolment, step, stepProgress, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getPublishedCourseBySlug } from "./course-store";
import { assertLearnerAccess } from "./learning-access";
import { assertLearningGate } from "./learning-gate";

export type EnrolmentView = {
  id: string;
  learnerId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseVersionId: string;
  status: "active" | "completed" | "withdrawn";
  currentStepKey: string | null;
  completedSteps: number;
  totalSteps: number;
  startedAt: Date;
  completedAt: Date | null;
};

/** `EnrolmentView` plus when the learner last did anything, for lists ordered by recency. */
export type EnrolmentListItem = EnrolmentView & { lastActivityAt: Date | null };

// A step switched off by staff is not required: it is left out of both counts (see `courseProgress`).
// Written with explicit table names: Drizzle leaves the table off a column in a single-table query,
// which inside a subquery would silently point at the wrong table.
const totalSteps = sql<number>`(select count(*)::int from "step" s where s.course_version_id = "enrolment"."course_version_id" and not s.disabled)`;
const completedSteps = sql<number>`(select count(*)::int from "step_progress" sp join "step" s on s.id = sp.step_id where sp.enrolment_id = "enrolment"."id" and sp.status = 'completed' and not s.disabled)`;
const currentStepKey = sql<string | null>`(select s.key from "step" s where s.id = "enrolment"."current_step_id")`;

async function selectViews(db: Db, where: SQL | undefined): Promise<EnrolmentListItem[]> {
  return db
    .select({
      id: enrolment.id,
      learnerId: enrolment.learnerId,
      courseId: enrolment.courseId,
      courseSlug: course.slug,
      courseTitle: course.title,
      courseVersionId: enrolment.courseVersionId,
      status: enrolment.status,
      currentStepKey,
      completedSteps,
      totalSteps,
      startedAt: enrolment.startedAt,
      completedAt: enrolment.completedAt,
      lastActivityAt: enrolment.lastActivityAt,
    })
    .from(enrolment)
    .innerJoin(course, eq(course.id, enrolment.courseId))
    .where(where)
    .orderBy(sql`${enrolment.lastActivityAt} desc nulls last`, desc(enrolment.startedAt));
}

const toView = ({ lastActivityAt: _lastActivityAt, ...view }: EnrolmentListItem): EnrolmentView => view;

/** For services that have already checked who is asking. */
export async function readEnrolmentView(db: Db, enrolmentId: string): Promise<EnrolmentView | null> {
  const [row] = await selectViews(db, eq(enrolment.id, enrolmentId));
  return row ? toView(row) : null;
}

export async function getEnrolment(ctx: Ctx, learnerId: string, courseId: string): Promise<EnrolmentView | null> {
  await assertLearnerAccess(ctx, "learner.progress.read", learnerId);
  const [row] = await selectViews(ctx.db, and(eq(enrolment.learnerId, learnerId), eq(enrolment.courseId, courseId)));
  return row ? toView(row) : null;
}

export async function getEnrolmentById(ctx: Ctx, enrolmentId: string): Promise<EnrolmentView | null> {
  const [row] = await selectViews(ctx.db, eq(enrolment.id, enrolmentId));
  if (!row) return null;
  // Somebody else's enrolment answers exactly like one that does not exist.
  try {
    await assertLearnerAccess(ctx, "learner.progress.read", row.learnerId);
  } catch (error) {
    if (error instanceof AppError && error.code === "forbidden") return null;
    throw error;
  }
  return toView(row);
}

/** Most recently active first. */
export async function listEnrolmentItems(ctx: Ctx, learnerId: string): Promise<EnrolmentListItem[]> {
  await assertLearnerAccess(ctx, "learner.progress.read", learnerId);
  return selectViews(ctx.db, eq(enrolment.learnerId, learnerId));
}

export async function listEnrolments(ctx: Ctx, learnerId: string): Promise<EnrolmentView[]> {
  return (await listEnrolmentItems(ctx, learnerId)).map(toView);
}

/**
 * Starts a course, or returns the enrolment that already exists. The gate runs first, every time,
 * so a direct request is refused exactly as the button is.
 *
 * Starting pins `course_version_id` to the version that is live at this moment: a later publish
 * never moves a learner who has started (spec 3.2). `course.enrolment_count` (the aggregate behind
 * the "popular" sort) goes up by one, once.
 */
export async function startCourse(ctx: Ctx, input: { learnerId: string; courseSlug: string }): Promise<{ enrolment: EnrolmentView; created: boolean }> {
  assertCan(ctx.actor, "learner.course.start", { learnerId: input.learnerId });
  const published = await getPublishedCourseBySlug(ctx, input.courseSlug);
  if (!published) throw new AppError("not_found", "That course could not be found. It may have been moved or removed.");
  await assertLearningGate(ctx, input.learnerId, published.course.id);

  const first = firstStep(published.content);
  const created = await ctx.db.transaction(async (tx) => {
    const [firstRow] = first
      ? await tx.select({ id: step.id }).from(step).where(and(eq(step.courseVersionId, published.version.id), eq(step.key, first.step.id))).limit(1)
      : [];
    const inserted = await tx
      .insert(enrolment)
      .values({
        learnerId: input.learnerId,
        courseId: published.course.id,
        courseVersionId: published.version.id,
        currentStepId: firstRow?.id ?? null,
        status: "active",
        startedAt: ctx.now,
        lastActivityAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: [enrolment.learnerId, enrolment.courseId] })
      .returning({ id: enrolment.id });
    if (inserted.length === 0) return false;
    await tx.update(course).set({ enrolmentCount: sql`${course.enrolmentCount} + 1` }).where(eq(course.id, published.course.id));
    return true;
  });

  const [row] = await selectViews(ctx.db, and(eq(enrolment.learnerId, input.learnerId), eq(enrolment.courseId, published.course.id)));
  if (!row) throw new AppError("internal", "We couldn't start that course. Nothing was lost. Try again in a moment.");
  return { enrolment: toView(row), created };
}

/**
 * Marks the enrolment completed when every step that counts is done, and reopens it when one is
 * no longer done (a rejected submission). Call it inside the transaction that changed a step.
 */
export async function refreshEnrolmentCompletion(tx: Db, enrolmentId: string, now: Date): Promise<void> {
  const [row] = await tx
    .select({ status: enrolment.status, total: totalSteps, completed: completedSteps })
    .from(enrolment)
    .where(eq(enrolment.id, enrolmentId))
    .limit(1);
  if (!row || row.status === "withdrawn") return;
  const done = row.total > 0 && row.completed >= row.total;
  if (done && row.status !== "completed") {
    await tx.update(enrolment).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(enrolment.id, enrolmentId));
  } else if (!done && row.status === "completed") {
    await tx.update(enrolment).set({ status: "active", completedAt: null, updatedAt: now }).where(eq(enrolment.id, enrolmentId));
  }
}

/**
 * Called by the submissions slice when evidence for an `upload` or `submit` step changes state.
 * `submitted` completes rules `evidence_submitted` and `submit`; `accepted` completes `upload_approved`;
 * `rejected` reopens the step. Marks the course completed when every required step is done.
 *
 * The caller is the learner (sending work in), staff deciding a moderation item, or a job. A
 * learner's browser cannot reach this: evidence steps are never completed through autosave.
 */
export async function recordEvidenceOutcome(ctx: Ctx, input: { enrolmentId: string; stepId: string; outcome: "submitted" | "accepted" | "rejected" }): Promise<EnrolmentView> {
  const [target] = await ctx.db
    .select({ learnerId: enrolment.learnerId, courseVersionId: enrolment.courseVersionId })
    .from(enrolment)
    .where(eq(enrolment.id, input.enrolmentId))
    .limit(1);
  if (!target) throw new AppError("not_found", "That course could not be found.");
  const { actor } = ctx;
  if (actor.type === "learner") {
    assertCan(actor, "learner.submission.create", { learnerId: target.learnerId });
    // A learner sends work in. Only a reviewer, or the automatic checks, can accept or reject it.
    if (input.outcome !== "submitted") throw new AppError("forbidden", "You don't have permission to do that.");
  } else if (actor.type !== "system" && !can(actor, "moderation.decide")) {
    throw new AppError("forbidden", "You don't have permission to do that.");
  }

  const [stepRow] = await ctx.db
    .select({ id: step.id, rule: step.completionRule })
    .from(step)
    .where(and(eq(step.id, input.stepId), eq(step.courseVersionId, target.courseVersionId)))
    .limit(1);
  if (!stepRow || !isEvidenceRule(stepRow.rule)) throw new AppError("not_found", "That step could not be found in this course.");

  const completes = input.outcome === "accepted" || (input.outcome === "submitted" && stepRow.rule !== "upload_approved");
  const status = completes ? ("completed" as const) : ("in_progress" as const);
  const evidence = sql`jsonb_build_object('evidence', ${input.outcome}::text)`;

  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(stepProgress)
      .values({
        enrolmentId: input.enrolmentId,
        learnerId: target.learnerId,
        stepId: stepRow.id,
        status,
        data: { evidence: input.outcome },
        completedAt: completes ? ctx.now : null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [stepProgress.enrolmentId, stepProgress.stepId],
        set: {
          status,
          data: sql`${stepProgress.data} || ${evidence}`,
          completedAt: completes ? sql`coalesce(${stepProgress.completedAt}, ${ctx.now.toISOString()}::timestamptz)` : null,
          skippedAt: null,
          updatedAt: ctx.now,
        },
      });
    await tx.update(enrolment).set({ lastActivityAt: ctx.now, updatedAt: ctx.now }).where(eq(enrolment.id, input.enrolmentId));
    await refreshEnrolmentCompletion(tx, input.enrolmentId, ctx.now);
  });

  const view = await readEnrolmentView(ctx.db, input.enrolmentId);
  if (!view) throw new AppError("not_found", "That course could not be found.");
  return view;
}
