/**
 * Review, approval and publishing (spec 3.8, 3.9, 6.3).
 *
 * THE RULE: nothing is ever published without a recorded human approval for that exact version.
 *
 * - The rule itself is the pure function `evaluateApproval` in `publish-rules.ts`.
 * - `recordDecision` is the only way an approval record is written, and only a signed-in person
 *   may call it (`course.review` is human-only, so the system actor is refused).
 * - `publishVersion` (human-only) and `runDuePublishSchedules` (a job) share ONE code path,
 *   `publishLocked`, which re-reads the decisions, re-runs validation against the live Tool
 *   Register and calls `evaluateApproval` inside the same transaction that publishes.
 *
 * This module does not import `server-only`, so that the import scripts can run it with tsx.
 */
import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import type { Course } from "@/content/schema";
import { QA_CHECKLIST, type ValidationIssue } from "@/content/validate";
import { audit } from "@/server/audit";
import { assertCan, can, type StaffActor, type StaffRole } from "@/server/authz";
import type { Ctx } from "@/server/context";
import {
  course,
  courseIdea,
  courseVersion,
  enrolment,
  publishSchedule,
  reviewComment,
  reviewDecision,
  reviewTask,
  staffRole,
  step,
  user,
  type Db,
} from "@/server/db";
import { AppError } from "@/server/errors";
import { defineJob } from "@/server/jobs/define";
import { getSetting } from "@/server/settings";
import {
  CATALOGUE_STATUSES,
  SUPERSEDED_VERSION_STATUS,
  contentOfVersion,
  loadRecordedWaivers,
  lockCourse,
  materialiseVersion,
  syncCatalogueFields,
  validateAgainstDb,
  type CourseRow,
  type CourseStatus,
  type CourseVersionRow,
  type StoredValidation,
} from "./course-store";
import {
  evaluateApproval,
  isAiOrigin,
  type ApprovalDecisionInput,
  type ApprovalDecisionKind,
  type ApprovalEvaluation,
} from "./publish-rules";

export * from "./publish-rules";

export type ReviewDecisionRow = typeof reviewDecision.$inferSelect;
export type ReviewTaskRow = typeof reviewTask.$inferSelect;
export type PublishScheduleRow = typeof publishSchedule.$inferSelect;
export type StepRow = typeof step.$inferSelect;

/** A reviewer's answer to one QA checklist item (spec Section 7). */
export const CHECKLIST_ANSWERS = ["pass", "fail", "not_applicable"] as const;
export type ChecklistAnswer = (typeof CHECKLIST_ANSWERS)[number];

/**
 * The safety items of `QA_CHECKLIST` (spec Section 7: no real-person likeness generation, a
 * meaningful ethics checkpoint, evidence that does not need images or video of real people). On an
 * approval each of these needs an explicit `pass`: `not_applicable` is refused.
 */
export const SAFETY_CHECKLIST_KEYS = [
  "safety_no_real_person_likeness",
  "safety_ethics_checkpoint",
  "safety_evidence_no_real_people",
] as const;

export interface WaiverInput {
  /** The waiver key from a waivable validation issue, for example `setup_guide:replit`. */
  check: string;
  /** Why the check does not apply. Logged with the reviewer's name. */
  reason: string;
}

export interface RecordDecisionInput {
  kind: ApprovalDecisionKind;
  /**
   * Answers keyed by `QA_CHECKLIST` item key. An approval must answer every item, none may be
   * `fail`, and the items in `SAFETY_CHECKLIST_KEYS` must be `pass`.
   */
  checklist: Record<string, ChecklistAnswer>;
  /** Confirmation that tool-specific claims were checked against the live tool. */
  toolClaimsChecked: boolean;
  /** Explicit waivers. Only with an approval, and only for checks the validator marks as waivable. */
  waivers?: WaiverInput[];
  /** An optional note for the review thread. */
  comment?: string;
  /** Required when declining or asking for edits: the reason, or the instructions. */
  reason?: string;
  /** The reviewer confirmed the warning shown before approving a safeguarding-sensitive course alone. */
  confirmedSafeguardingSoloApproval?: boolean;
}

// ───────────────────────────── Helpers ─────────────────────────────

function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row)
    throw new AppError("internal", "Something went wrong saving that. Please try again.", {
      detail: { what },
    });
  return row;
}

function requireStaff(ctx: Ctx): StaffActor {
  if (ctx.actor.type !== "staff")
    throw new AppError("forbidden", "Only a signed-in member of staff can do that.");
  return ctx.actor;
}

const isLive = (status: CourseStatus): boolean => status === "published" || status === "needs_review";

async function readVersion(db: Db, versionId: string): Promise<CourseVersionRow> {
  const [row] = await db.select().from(courseVersion).where(eq(courseVersion.id, versionId)).limit(1);
  if (!row) throw new AppError("not_found", "That course version could not be found.");
  return row;
}

async function loadDecisions(db: Db, versionId: string, since?: Date | null): Promise<ReviewDecisionRow[]> {
  return db
    .select()
    .from(reviewDecision)
    .where(
      since
        ? and(eq(reviewDecision.courseVersionId, versionId), gte(reviewDecision.createdAt, since))
        : eq(reviewDecision.courseVersionId, versionId),
    )
    .orderBy(asc(reviewDecision.createdAt), asc(reviewDecision.id));
}

/** Gathers the facts for one version and applies the approval rule with the current site settings. */
async function evaluateStoredApproval(
  db: Db,
  version: CourseVersionRow,
  content: Course,
  decisions: readonly ReviewDecisionRow[],
): Promise<ApprovalEvaluation> {
  const [requireSecondReviewer, scope] = await Promise.all([
    getSetting({ db }, "review.require_second_reviewer_for_ai_drafts"),
    getSetting({ db }, "review.second_reviewer_scope"),
  ]);
  const usesExternalTool = content.toolRequirements.length > 0;
  return evaluateApproval({
    requireSecondReviewer,
    scope,
    origin: version.origin,
    safeguardingSensitive: content.safeguardingSensitive,
    lastEditorId: version.lastEditedBy,
    decisions: decisions.map((row): ApprovalDecisionInput => ({
      reviewerId: row.reviewerId,
      kind: row.decision,
      roles: row.reviewerRoles,
      wasLastEditor: row.reviewerWasLastEditor,
      toolClaimsChecked: row.toolClaimsChecked,
      usesExternalTool,
      confirmedSafeguardingSoloApproval: row.safeguardingSensitiveConfirmed,
    })),
  });
}

function validationError(validation: StoredValidation, lead: string): AppError {
  const errors = validation.issues.filter((item) => item.severity === "error");
  const shown = errors.slice(0, 3).map((item) => item.message);
  const more = errors.length > shown.length ? ` (and ${errors.length - shown.length} more)` : "";
  return new AppError("validation_failed", `${lead} ${shown.join(" ")}${more}`.trim(), {
    detail: { issues: errors.map((item: ValidationIssue) => ({ code: item.code, path: item.path })) },
  });
}

async function storeValidation(tx: Db, versionId: string, validation: StoredValidation): Promise<void> {
  await tx
    .update(courseVersion)
    .set({ validation: validation as unknown as Record<string, unknown> })
    .where(eq(courseVersion.id, versionId));
}

/** Validates against the live Register with the recorded waivers, and stores the result. */
async function strictValidation(
  ctx: Ctx,
  tx: Db,
  version: CourseVersionRow,
  content: Course,
): Promise<StoredValidation> {
  const waivers = [...new Set((await loadRecordedWaivers(tx, version.id)).map((waiver) => waiver.check))];
  const validation = await validateAgainstDb({ db: tx, now: ctx.now }, content, waivers);
  await storeValidation(tx, version.id, validation);
  return validation;
}

async function setDraftStatus(
  tx: Db,
  current: CourseRow,
  versionId: string,
  status: CourseStatus,
): Promise<void> {
  await tx.update(courseVersion).set({ status }).where(eq(courseVersion.id, versionId));
  // A live, taken-down or retired course keeps its status: the draft's progress never shows to learners.
  if (!CATALOGUE_STATUSES.includes(current.status)) {
    await tx.update(course).set({ status }).where(eq(course.id, current.id));
  }
}

async function closeReviewTasks(
  tx: Db,
  ctx: Ctx,
  versionId: string,
  status: "done" | "cancelled",
): Promise<void> {
  await tx
    .update(reviewTask)
    .set({ status, completedAt: ctx.now })
    .where(
      and(
        eq(reviewTask.courseVersionId, versionId),
        eq(reviewTask.kind, "course_review"),
        inArray(reviewTask.status, ["open", "in_progress"]),
      ),
    );
}

async function cancelSchedules(tx: Db, ctx: Ctx, courseId: string, note: string): Promise<number> {
  const rows = await tx
    .update(publishSchedule)
    .set({ status: "cancelled", cancelledAt: ctx.now, error: note })
    .where(and(eq(publishSchedule.courseId, courseId), eq(publishSchedule.status, "scheduled")))
    .returning({ id: publishSchedule.id });
  return rows.length;
}

async function activeLearnerCount(db: Db, courseId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrolment)
    .where(and(eq(enrolment.courseId, courseId), eq(enrolment.status, "active")));
  return row?.count ?? 0;
}

/** The version a taken-down course was showing: the one a fresh approval can restore. */
async function takenDownVersion(db: Db, courseId: string): Promise<CourseVersionRow | null> {
  const [row] = await db
    .select()
    .from(courseVersion)
    .where(and(eq(courseVersion.courseId, courseId), eq(courseVersion.status, "taken_down")))
    .orderBy(desc(courseVersion.publishedAt), desc(courseVersion.revision))
    .limit(1);
  return row ?? null;
}

// ───────────────────────────── Review ─────────────────────────────

export interface SubmitForReviewResult {
  course: CourseRow;
  version: CourseVersionRow;
  task: ReviewTaskRow;
  validation: StoredValidation;
}

/**
 * Puts the working revision into the review queue (`course.submit_for_review`): validates it
 * again, creates a `review_task` and sets status `in_review`. A draft with validation errors can
 * be submitted (it is flagged in the queue) but cannot be approved until it passes. Submitting a
 * revision that is already in review returns the existing task.
 */
export async function submitForReview(ctx: Ctx, courseId: string): Promise<SubmitForReviewResult> {
  assertCan(ctx.actor, "course.submit_for_review");
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    if (current.workingVersionId === null)
      throw new AppError("not_found", "That course has no revision to review.");
    const version = await readVersion(tx, current.workingVersionId);
    if (version.status !== "draft" && version.status !== "ai_draft" && version.status !== "in_review") {
      throw new AppError(
        "conflict",
        version.publishedAt !== null
          ? "This revision is already published. Edit the course to start a new revision, then submit that."
          : `This revision is ${version.status.replace(/_/g, " ")}. Save a new revision before submitting it for review.`,
      );
    }
    const content = contentOfVersion(version);
    const validation = await strictValidation(ctx, tx, version, content);

    const [open] = await tx
      .select()
      .from(reviewTask)
      .where(
        and(
          eq(reviewTask.courseVersionId, version.id),
          eq(reviewTask.kind, "course_review"),
          inArray(reviewTask.status, ["open", "in_progress"]),
        ),
      )
      .limit(1);
    if (version.status === "in_review" && open) return { course: current, version, task: open, validation };

    const task =
      open ??
      one(
        await tx
          .insert(reviewTask)
          .values({
            kind: "course_review",
            status: "open",
            title: `${isAiOrigin(version.origin) ? "AI-drafted — must be reviewed" : "Review"}: ${content.title} (revision ${version.revision})`,
            detail:
              validation.errors > 0
                ? `Validation found ${validation.errors} ${validation.errors === 1 ? "error" : "errors"}. This revision cannot be approved until they are fixed.`
                : null,
            courseId,
            courseVersionId: version.id,
            createdBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
            createdAt: ctx.now,
          })
          .returning(),
        "review_task",
      );
    await setDraftStatus(tx, current, version.id, "in_review");
    await audit(
      ctx,
      {
        action: "course.submit_for_review",
        targetType: "course",
        targetId: courseId,
        meta: {
          versionId: version.id,
          revision: version.revision,
          taskId: task.id,
          validationErrors: validation.errors,
        },
      },
      tx,
    );
    const [freshCourse] = await tx.select().from(course).where(eq(course.id, courseId)).limit(1);
    return { course: freshCourse ?? current, version: await readVersion(tx, version.id), task, validation };
  });
}

function assertChecklist(kind: ApprovalDecisionKind, checklist: Record<string, unknown>): void {
  const known = new Set(QA_CHECKLIST.items.map((item) => item.key));
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, answer] of Object.entries(checklist)) {
    if (!known.has(key)) fieldErrors[key] = ["This is not an item on the reviewer checklist."];
    else if (!(CHECKLIST_ANSWERS as readonly unknown[]).includes(answer))
      fieldErrors[key] = ["Answer pass, fail or not applicable."];
  }
  if (kind === "approve") {
    for (const item of QA_CHECKLIST.items) {
      const answer = Object.hasOwn(checklist, item.key) ? checklist[item.key] : undefined;
      if (answer === undefined) fieldErrors[item.key] = [`Answer "${item.label}" before approving.`];
      else if (answer === "fail")
        fieldErrors[item.key] = [`"${item.label}" is marked as failed, so the course cannot be approved.`];
      else if ((SAFETY_CHECKLIST_KEYS as readonly string[]).includes(item.key) && answer !== "pass")
        fieldErrors[item.key] = [
          `"${item.label}" is a safety check. It must pass; it cannot be marked not applicable.`,
        ];
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(
      "invalid_input",
      kind === "approve"
        ? "Every item on the reviewer checklist needs an answer, none may fail, and the safety checks must pass, before a course can be approved."
        : "Some checklist answers are not valid.",
      { fieldErrors },
    );
  }
}

export interface RecordDecisionResult {
  decision: ReviewDecisionRow;
  /** Whether this version now has the approval it needs to be published, and what is missing if not. */
  evaluation: ApprovalEvaluation;
  version: CourseVersionRow;
}

/**
 * Records one reviewer's decision on one version (`course.review`, human only).
 *
 * The record keeps the reviewer's roles at the time, whether they were the last editor, their
 * checklist answers and the checklist version, the tool-claims confirmation and any waivers. A
 * decision belongs to exactly one version: a new revision needs new approval.
 *
 * An approval is refused when the checklist is incomplete or has a failed item, when a safety item
 * (`SAFETY_CHECKLIST_KEYS`) is anything other than `pass`, when the tool-claims
 * confirmation is missing for an AI draft or a course that uses an external tool, or when the
 * version still has validation errors after the recorded waivers are applied. A waiver is accepted
 * only for a check the validator marks as waivable, and each one is written to the audit log.
 */
export async function recordDecision(
  ctx: Ctx,
  versionId: string,
  input: RecordDecisionInput,
): Promise<RecordDecisionResult> {
  assertCan(ctx.actor, "course.review");
  const reviewer = requireStaff(ctx);
  assertChecklist(input.kind, input.checklist);
  const reason = input.reason?.trim() ?? "";
  if (input.kind !== "approve" && reason === "") {
    throw new AppError(
      "invalid_input",
      input.kind === "decline" ? "Say why this version is being declined." : "Say what needs to change.",
      { fieldErrors: { reason: ["This is needed."] } },
    );
  }
  const waiverInputs = input.waivers ?? [];
  if (input.kind !== "approve" && waiverInputs.length > 0) {
    throw new AppError("invalid_input", "A waiver can only be recorded as part of an approval.");
  }

  return ctx.db.transaction(async (tx) => {
    const initial = await readVersion(tx, versionId);
    const current = await lockCourse(tx, initial.courseId);
    const version = await readVersion(tx, versionId);
    const content = contentOfVersion(version);

    // A taken-down version can be approved again, which is what `restoreCourse` needs.
    const restoring =
      current.status === "taken_down" &&
      version.status === "taken_down" &&
      (await takenDownVersion(tx, current.id))?.id === version.id;
    if (!restoring) {
      if (current.workingVersionId !== version.id) {
        throw new AppError(
          "conflict",
          "A newer revision of this course exists. Review that one instead: a decision belongs to one version.",
        );
      }
      if (version.publishedAt !== null) throw new AppError("conflict", "This version is already published.");
      if (version.status === "scheduled" && input.kind === "approve") {
        throw new AppError(
          "conflict",
          "This version is already approved and scheduled. Cancel the schedule to change its approval.",
        );
      }
      if (!["ai_draft", "in_review", "approved", "scheduled"].includes(version.status)) {
        throw new AppError(
          "conflict",
          version.status === "draft"
            ? "Submit this revision for review before recording a decision."
            : `This revision is ${version.status.replace(/_/g, " ")}. Save a new revision and review that.`,
        );
      }
    }

    const usesExternalTool = content.toolRequirements.length > 0;
    const waivers: WaiverInput[] = [];
    if (input.kind === "approve") {
      if ((isAiOrigin(version.origin) || usesExternalTool) && input.toolClaimsChecked !== true) {
        throw new AppError(
          "invalid_input",
          "Confirm that the tool-specific claims were checked against the live tool before approving.",
          {
            fieldErrors: {
              toolClaimsChecked: [
                "This confirmation is needed for an AI draft and for any course that uses an external tool.",
              ],
            },
          },
        );
      }
      // What may be waived is decided by the validator, on this version, right now.
      const unwaived = await validateAgainstDb({ db: tx, now: ctx.now }, content, []);
      const waivable = new Set(
        unwaived.issues
          .filter((item) => item.waivable && item.waiverKey !== undefined)
          .map((item) => item.waiverKey as string),
      );
      for (const waiver of waiverInputs) {
        const check = waiver.check.trim();
        const why = waiver.reason.trim();
        if (!waivable.has(check)) {
          throw new AppError(
            "invalid_input",
            `"${check}" is not a check that can be waived on this version. Fix the content instead.`,
          );
        }
        if (why === "") throw new AppError("invalid_input", `Give a reason for waiving "${check}".`);
        if (!waivers.some((existing) => existing.check === check)) waivers.push({ check, reason: why });
      }
      const recorded = (await loadRecordedWaivers(tx, version.id)).map((waiver) => waiver.check);
      const validation = await validateAgainstDb({ db: tx, now: ctx.now }, content, [
        ...new Set([...recorded, ...waivers.map((waiver) => waiver.check)]),
      ]);
      if (!validation.ok) {
        throw validationError(
          validation,
          "This version cannot be approved until its validation errors are fixed.",
        );
      }
      await storeValidation(tx, version.id, validation);
    }

    const [task] = await tx
      .select({ id: reviewTask.id })
      .from(reviewTask)
      .where(and(eq(reviewTask.courseVersionId, version.id), eq(reviewTask.kind, "course_review")))
      .orderBy(desc(reviewTask.createdAt))
      .limit(1);

    const decision = one(
      await tx
        .insert(reviewDecision)
        .values({
          reviewTaskId: task?.id ?? null,
          courseId: current.id,
          courseVersionId: version.id,
          reviewerId: reviewer.userId,
          decision: input.kind,
          checklist: input.checklist,
          checklistVersion: String(QA_CHECKLIST.version),
          toolClaimsChecked: input.toolClaimsChecked === true,
          waivers: waivers as unknown[],
          reviewerWasLastEditor: version.lastEditedBy === reviewer.userId,
          reviewerRoles: [...reviewer.roles],
          safeguardingSensitiveConfirmed: input.confirmedSafeguardingSoloApproval === true,
          reason: reason === "" ? null : reason,
          createdAt: ctx.now,
        })
        .returning(),
      "review_decision",
    );
    const comment = input.comment?.trim();
    if (comment) {
      await tx.insert(reviewComment).values({
        courseId: current.id,
        courseVersionId: version.id,
        reviewTaskId: task?.id ?? null,
        authorId: reviewer.userId,
        body: comment,
        createdAt: ctx.now,
      });
    }

    await audit(
      ctx,
      {
        action: `course.review.${input.kind}`,
        targetType: "course_version",
        targetId: version.id,
        reason: reason === "" ? undefined : reason,
        meta: {
          courseId: current.id,
          revision: version.revision,
          decisionId: decision.id,
          checklistVersion: QA_CHECKLIST.version,
          toolClaimsChecked: decision.toolClaimsChecked,
          reviewerWasLastEditor: decision.reviewerWasLastEditor,
          reviewerRoles: decision.reviewerRoles,
          safeguardingSensitive: content.safeguardingSensitive,
          safeguardingSoloConfirmed: decision.safeguardingSensitiveConfirmed,
          waivers: waivers.map((waiver) => waiver.check),
        },
      },
      tx,
    );
    for (const waiver of waivers) {
      await audit(
        ctx,
        {
          action: "course.review.waiver",
          targetType: "course_version",
          targetId: version.id,
          reason: waiver.reason,
          meta: { courseId: current.id, check: waiver.check, decisionId: decision.id },
        },
        tx,
      );
    }

    const decisions = await loadDecisions(tx, version.id, restoring ? current.takenDownAt : null);
    const evaluation = await evaluateStoredApproval(tx, version, content, decisions);

    if (!restoring) {
      if (input.kind === "approve") {
        await setDraftStatus(tx, current, version.id, evaluation.approved ? "approved" : "in_review");
        if (evaluation.approved) await closeReviewTasks(tx, ctx, version.id, "done");
      } else {
        await cancelSchedules(
          tx,
          ctx,
          current.id,
          input.kind === "decline" ? "The version was declined." : "Edits were requested.",
        );
        await setDraftStatus(
          tx,
          current,
          version.id,
          input.kind === "decline" ? "declined" : "changes_requested",
        );
        await closeReviewTasks(tx, ctx, version.id, "done");
      }
    }
    return { decision, evaluation, version: await readVersion(tx, version.id) };
  });
}

export interface ApprovalState {
  version: CourseVersionRow;
  decisions: ReviewDecisionRow[];
  evaluation: ApprovalEvaluation;
  validation: StoredValidation;
}

/** For the review screen: the decisions on a version, what approval is still missing, and fresh validation. Writes nothing. */
export async function getApprovalState(ctx: Ctx, versionId: string): Promise<ApprovalState> {
  assertCan(ctx.actor, "course.read_draft");
  const version = await readVersion(ctx.db, versionId);
  const content = contentOfVersion(version);
  const decisions = await loadDecisions(ctx.db, versionId);
  const waivers = [...new Set((await loadRecordedWaivers(ctx.db, versionId)).map((waiver) => waiver.check))];
  return {
    version,
    decisions,
    evaluation: await evaluateStoredApproval(ctx.db, version, content, decisions),
    validation: await validateAgainstDb(ctx, content, waivers),
  };
}

// ───────────────────────────── Publishing ─────────────────────────────

export interface PublishResult {
  course: CourseRow;
  version: CourseVersionRow;
  /** True when the version was already the live one and nothing was changed. */
  alreadyPublished: boolean;
  /** The version that was live before, now marked superseded. Learners enrolled on it stay on it. */
  supersededVersionId: string | null;
  /** JSON step id → `step.id`. Empty when `alreadyPublished`. */
  stepIds: Map<string, string>;
}

/**
 * The one place a version becomes live. The caller holds the course row lock (`lockCourse`) and
 * has already decided WHO may ask; this decides WHETHER the version may be published, from the
 * records in the database, inside the publishing transaction.
 */
async function publishLocked(
  ctx: Ctx,
  tx: Db,
  current: CourseRow,
  version: CourseVersionRow,
  options: { reason?: string; via: "manual" | "schedule"; scheduleId?: string },
): Promise<PublishResult> {
  if (version.publishedAt !== null && current.publishedVersionId === version.id && isLive(current.status)) {
    return {
      course: current,
      version,
      alreadyPublished: true,
      supersededVersionId: null,
      stepIds: new Map(),
    };
  }
  if (version.publishedAt !== null) {
    throw new AppError(
      "conflict",
      "This version was published before and is no longer live. Restore the course, or save a new revision and have it approved.",
    );
  }
  if (current.workingVersionId !== version.id) {
    throw new AppError(
      "conflict",
      "A newer revision of this course exists. Only the newest revision can be published, once it is approved.",
    );
  }

  // 1. A recorded human approval for THIS version, under the current settings.
  const content = contentOfVersion(version);
  const decisions = await loadDecisions(tx, version.id);
  const evaluation = await evaluateStoredApproval(tx, version, content, decisions);
  if (!evaluation.approved) {
    throw new AppError(
      "approval_required",
      `This version cannot be published yet. ${evaluation.missing.join(" ")}`.trim(),
      {
        detail: { missing: evaluation.missing, versionId: version.id },
      },
    );
  }

  // 2. Validation, again, against the live Tool Register. Only recorded waivers apply.
  const validation = await strictValidation(ctx, tx, version, content);
  if (!validation.ok)
    throw validationError(
      validation,
      "This version cannot be published because it no longer passes validation.",
    );

  // 3. Publish. Everything below succeeds together or not at all.
  const stepIds = await materialiseVersion(tx, version.id);
  const published = one(
    await tx
      .update(courseVersion)
      .set({ status: "published", publishedAt: ctx.now })
      .where(eq(courseVersion.id, version.id))
      .returning(),
    "course_version",
  );
  const supersededVersionId =
    current.publishedVersionId !== null && current.publishedVersionId !== version.id
      ? current.publishedVersionId
      : null;
  if (supersededVersionId !== null) {
    await tx
      .update(courseVersion)
      .set({ status: SUPERSEDED_VERSION_STATUS })
      .where(eq(courseVersion.id, supersededVersionId));
  }
  await tx
    .update(course)
    .set({
      status: "published",
      publishedVersionId: version.id,
      publishedAt: current.publishedAt ?? ctx.now,
      takenDownAt: null,
      takenDownReason: null,
    })
    .where(eq(course.id, current.id));
  await syncCatalogueFields(tx, current.id, content);
  if (current.sourceIdeaId !== null) {
    await tx
      .update(courseIdea)
      .set({ status: "published", courseId: current.id })
      .where(eq(courseIdea.id, current.sourceIdeaId));
  }
  await closeReviewTasks(tx, ctx, version.id, "done");
  await tx
    .update(publishSchedule)
    .set({ status: "published", publishedAt: ctx.now })
    .where(and(eq(publishSchedule.courseVersionId, version.id), eq(publishSchedule.status, "scheduled")));

  const approvals = decisions.filter((row) => row.decision === "approve");
  await audit(
    ctx,
    {
      action: "course.publish",
      targetType: "course",
      targetId: current.id,
      reason: options.reason,
      meta: {
        versionId: version.id,
        revision: version.revision,
        via: options.via,
        scheduleId: options.scheduleId ?? null,
        approvalDecisionIds: approvals.map((row) => row.id),
        approverIds: [...new Set(approvals.map((row) => row.reviewerId))],
        supersededVersionId,
        warnings: evaluation.warnings,
        waivers: validation.waivers,
      },
    },
    tx,
  );
  const [fresh] = await tx.select().from(course).where(eq(course.id, current.id)).limit(1);
  return {
    course: fresh ?? current,
    version: published,
    alreadyPublished: false,
    supersededVersionId,
    stepIds,
  };
}

/**
 * Publishes an approved version (`course.publish`, human only: the system actor is refused).
 *
 * Refuses with `approval_required`, naming what is missing, unless the version has the human
 * approval the current settings require; and with `validation_failed` if it no longer passes
 * validation against the live Tool Register (a required tool that is blocked, unverified or
 * unapproved with no approved fallback fails). On success, in one transaction: the snapshot is
 * materialised, the version is frozen with `published_at`, the course points at it, the version
 * that was live is marked superseded (learners already enrolled stay on theirs), the catalogue
 * fields are copied from this snapshot, a linked course idea becomes `published`, and the audit
 * log records who approved. Publishing the live version again changes nothing.
 */
export async function publishVersion(
  ctx: Ctx,
  versionId: string,
  options: { reason?: string } = {},
): Promise<PublishResult> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  return ctx.db.transaction(async (tx) => {
    const initial = await readVersion(tx, versionId);
    const current = await lockCourse(tx, initial.courseId);
    return publishLocked(ctx, tx, current, await readVersion(tx, versionId), {
      reason: options.reason,
      via: "manual",
    });
  });
}

/**
 * Schedules an approved version to go live later (`course.publish`, human only). Approval and
 * validation must already be complete now; both are checked again when the time comes. One
 * schedule per course: an earlier one is cancelled.
 */
export async function scheduleVersion(
  ctx: Ctx,
  versionId: string,
  publishAt: Date,
): Promise<PublishScheduleRow> {
  assertCan(ctx.actor, "course.publish");
  const scheduler = requireStaff(ctx);
  if (Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= ctx.now.getTime()) {
    throw new AppError("invalid_input", "Choose a publish time in the future.");
  }
  return ctx.db.transaction(async (tx) => {
    const initial = await readVersion(tx, versionId);
    const current = await lockCourse(tx, initial.courseId);
    const version = await readVersion(tx, versionId);
    if (version.publishedAt !== null) throw new AppError("conflict", "This version is already published.");
    if (current.workingVersionId !== version.id) {
      throw new AppError(
        "conflict",
        "A newer revision of this course exists. Only the newest revision can be scheduled, once it is approved.",
      );
    }
    const content = contentOfVersion(version);
    const decisions = await loadDecisions(tx, version.id);
    const evaluation = await evaluateStoredApproval(tx, version, content, decisions);
    if (!evaluation.approved) {
      throw new AppError(
        "approval_required",
        `This version cannot be scheduled yet. ${evaluation.missing.join(" ")}`.trim(),
        {
          detail: { missing: evaluation.missing, versionId: version.id },
        },
      );
    }
    const validation = await strictValidation(ctx, tx, version, content);
    if (!validation.ok)
      throw validationError(
        validation,
        "This version cannot be scheduled because it does not pass validation.",
      );

    await cancelSchedules(tx, ctx, current.id, "Replaced by a new schedule.");
    const schedule = one(
      await tx
        .insert(publishSchedule)
        .values({
          courseId: current.id,
          courseVersionId: version.id,
          publishAt,
          status: "scheduled",
          scheduledBy: scheduler.userId,
          createdAt: ctx.now,
        })
        .returning(),
      "publish_schedule",
    );
    await setDraftStatus(tx, current, version.id, "scheduled");
    await audit(
      ctx,
      {
        action: "course.schedule",
        targetType: "course",
        targetId: current.id,
        meta: {
          versionId: version.id,
          revision: version.revision,
          scheduleId: schedule.id,
          publishAt: publishAt.toISOString(),
          approvalDecisionIds: decisions.filter((row) => row.decision === "approve").map((row) => row.id),
        },
      },
      tx,
    );
    return schedule;
  });
}

/** Cancels a pending schedule for a version (`course.publish`). The version goes back to `approved`. */
export async function cancelSchedule(ctx: Ctx, versionId: string, reason?: string): Promise<number> {
  assertCan(ctx.actor, "course.publish");
  return ctx.db.transaction(async (tx) => {
    const initial = await readVersion(tx, versionId);
    const current = await lockCourse(tx, initial.courseId);
    const version = await readVersion(tx, versionId);
    const cancelled = await cancelSchedules(tx, ctx, current.id, reason?.trim() || "Cancelled.");
    if (version.status === "scheduled") await setDraftStatus(tx, current, version.id, "approved");
    if (cancelled > 0) {
      await audit(
        ctx,
        {
          action: "course.schedule.cancel",
          targetType: "course",
          targetId: current.id,
          reason,
          meta: { versionId },
        },
        tx,
      );
    }
    return cancelled;
  });
}

export interface ScheduleRunResult {
  due: number;
  published: number;
  failed: number;
  results: Array<{
    scheduleId: string;
    courseId: string;
    versionId: string;
    outcome: "published" | "failed" | "skipped";
    error?: string;
  }>;
}

/**
 * The scheduled-publish job. It runs as the system actor, which can never approve anything, so it
 * may only carry out what people already decided, and it checks all of it again at run time:
 *
 * - the person who scheduled the publish still has publish rights;
 * - the version is still the newest revision and still `scheduled`;
 * - no review decision of any kind has been recorded for the version since it was scheduled
 *   (approval unchanged);
 * - and then everything `publishVersion` checks: the approval rule under the current settings and
 *   validation against the live Tool Register.
 *
 * If any check fails the schedule is marked `failed` with the reason, the version goes back to
 * `in_review`, and a review task is opened. Nothing is published. Safe to run again at any time.
 */
export async function runDuePublishSchedules(ctx: Ctx): Promise<ScheduleRunResult> {
  if (ctx.actor.type !== "system" && !can(ctx.actor, "course.publish")) {
    throw new AppError("forbidden", "You don't have permission to do that.");
  }
  const due = await ctx.db
    .select({ id: publishSchedule.id })
    .from(publishSchedule)
    .where(and(eq(publishSchedule.status, "scheduled"), lte(publishSchedule.publishAt, ctx.now)))
    .orderBy(asc(publishSchedule.publishAt));
  const result: ScheduleRunResult = { due: due.length, published: 0, failed: 0, results: [] };

  for (const { id } of due) {
    const outcome = await ctx.db.transaction(async (tx) => {
      const [schedule] = await tx
        .select()
        .from(publishSchedule)
        .where(eq(publishSchedule.id, id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!schedule || schedule.status !== "scheduled" || schedule.publishAt.getTime() > ctx.now.getTime())
        return null;
      const current = await lockCourse(tx, schedule.courseId);
      const version = await readVersion(tx, schedule.courseVersionId);
      const base = { scheduleId: schedule.id, courseId: current.id, versionId: version.id };

      let failure: string | null = null;
      try {
        await assertScheduleIntact(tx, schedule, current, version);
        // A savepoint, so a refusal part-way through publishing leaves nothing behind.
        await tx.transaction((inner) =>
          publishLocked(ctx, inner, current, version, {
            via: "schedule",
            scheduleId: schedule.id,
            reason: "Scheduled publish",
          }),
        );
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        failure = error.message;
      }
      if (failure === null) return { ...base, outcome: "published" as const };

      await tx
        .update(publishSchedule)
        .set({ status: "failed", error: failure })
        .where(eq(publishSchedule.id, schedule.id));
      if (current.workingVersionId === version.id && version.status === "scheduled") {
        await setDraftStatus(tx, current, version.id, "in_review");
        await tx.insert(reviewTask).values({
          kind: "course_review",
          status: "open",
          title: `Scheduled publish did not run: ${current.title} (revision ${version.revision})`,
          detail: failure,
          courseId: current.id,
          courseVersionId: version.id,
          createdAt: ctx.now,
        });
      }
      await audit(
        ctx,
        {
          action: "course.schedule.failed",
          targetType: "course",
          targetId: current.id,
          reason: failure,
          meta: { versionId: version.id, scheduleId: schedule.id },
        },
        tx,
      );
      return { ...base, outcome: "failed" as const, error: failure };
    });
    if (outcome === null) continue;
    result.results.push(outcome);
    if (outcome.outcome === "published") result.published += 1;
    else result.failed += 1;
  }
  return result;
}

/**
 * The scheduled-publish job, for the job registry (`src/server/jobs/registry.ts`). It runs every
 * five minutes as the system actor. The summary holds counts, ids and the plain-English reason a
 * schedule did not run; never personal data.
 */
export const publishDueSchedulesJob = defineJob({
  name: "publish.run_due_schedules",
  schedule: "*/5 * * * *",
  event: "publish/run-due-schedules",
  run: async (ctx: Ctx) => ({ ...(await runDuePublishSchedules(ctx)) }),
});

/** Every job this slice owns. Add `...publishJobs` to `JOBS` in the registry. */
export const publishJobs = [publishDueSchedulesJob];

async function assertScheduleIntact(
  tx: Db,
  schedule: PublishScheduleRow,
  current: CourseRow,
  version: CourseVersionRow,
): Promise<void> {
  if (schedule.scheduledBy === null) {
    throw new AppError(
      "approval_required",
      "Nobody is recorded as having scheduled this publish, so it was not carried out.",
    );
  }
  const [scheduler] = await tx
    .select({ kind: user.kind, status: user.status })
    .from(user)
    .where(eq(user.id, schedule.scheduledBy))
    .limit(1);
  const roles = await tx
    .select({ role: staffRole.role })
    .from(staffRole)
    .where(eq(staffRole.userId, schedule.scheduledBy));
  const actor: StaffActor = {
    type: "staff",
    userId: schedule.scheduledBy,
    roles: roles.map((row): StaffRole => row.role),
    // The scheduler passed the second factor when they scheduled it; this asks only whether their role still allows it.
    twoFactorVerified: true,
  };
  if (
    !scheduler ||
    scheduler.kind !== "staff" ||
    scheduler.status !== "active" ||
    !can(actor, "course.publish")
  ) {
    throw new AppError(
      "approval_required",
      "The person who scheduled this publish no longer has publish rights, so it was not carried out.",
    );
  }
  if (current.workingVersionId !== version.id || version.status !== "scheduled") {
    throw new AppError(
      "approval_required",
      "This version is no longer the scheduled revision of the course, so it was not published.",
    );
  }
  const [later] = await tx
    .select({ id: reviewDecision.id })
    .from(reviewDecision)
    .where(
      and(eq(reviewDecision.courseVersionId, version.id), gt(reviewDecision.createdAt, schedule.createdAt)),
    )
    .limit(1);
  if (later) {
    throw new AppError(
      "approval_required",
      "A review decision was recorded after this publish was scheduled, so the approval is no longer the one that was scheduled.",
    );
  }
}

// ───────────────────────────── Taking things down ─────────────────────────────

export interface TakeDownResult {
  course: CourseRow;
  /** The version that was live. Learners enrolled on it must be shown a clear notice. */
  versionId: string | null;
  /** Learners with an active enrolment on the course. Notifying them is wired by the notifications slice. */
  affectedLearnerCount: number;
  alreadyDown: boolean;
}

async function withdraw(
  ctx: Ctx,
  courseId: string,
  reason: string,
  options: {
    action: "course.take_down" | "course.unpublish" | "course.retire";
    versionStatus: CourseStatus;
    courseStatus: CourseStatus | "from_draft";
  },
): Promise<TakeDownResult> {
  const why = reason.trim();
  if (why === "") throw new AppError("invalid_input", "Give a reason. It is kept in the audit log.");
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    const affectedLearnerCount = await activeLearnerCount(tx, courseId);
    if (!isLive(current.status) || current.publishedVersionId === null) {
      const same = options.courseStatus !== "from_draft" && current.status === options.courseStatus;
      if (same) return { course: current, versionId: null, affectedLearnerCount, alreadyDown: true };
      throw new AppError(
        "conflict",
        "This course is not live, so there is nothing to take out of the catalogue.",
      );
    }
    const versionId = current.publishedVersionId;
    await tx
      .update(courseVersion)
      .set({ status: options.versionStatus })
      .where(eq(courseVersion.id, versionId));
    await cancelSchedules(tx, ctx, courseId, "The course was withdrawn.");

    let status: CourseStatus;
    if (options.courseStatus === "from_draft") {
      // Back to wherever the newest draft is; if there is none, the course is simply a draft again.
      const working =
        current.workingVersionId !== null && current.workingVersionId !== versionId
          ? await readVersion(tx, current.workingVersionId)
          : null;
      status = working && !CATALOGUE_STATUSES.includes(working.status) ? working.status : "draft";
    } else {
      status = options.courseStatus;
    }
    const takenDown = options.action === "course.take_down";
    const updated = one(
      await tx
        .update(course)
        .set({
          status,
          publishedVersionId: null,
          takenDownAt: takenDown ? ctx.now : null,
          takenDownReason: takenDown ? why : null,
        })
        .where(eq(course.id, courseId))
        .returning(),
      "course",
    );
    await audit(
      ctx,
      {
        action: options.action,
        targetType: "course",
        targetId: courseId,
        reason: why,
        meta: { versionId, affectedLearnerCount },
      },
      tx,
    );
    return { course: updated, versionId, affectedLearnerCount, alreadyDown: false };
  });
}

/**
 * One call, immediate (`course.take_down`): the course's status becomes `taken_down` and it stops
 * being the published course, so it disappears from the catalogue and from Start in the same
 * transaction. The version learners were on is marked `taken_down` too, so the player can show
 * enrolled learners a clear notice instead of the content. Returns how many learners are affected.
 */
export async function takeDownCourse(ctx: Ctx, courseId: string, reason: string): Promise<TakeDownResult> {
  assertCan(ctx.actor, "course.take_down");
  return withdraw(ctx, courseId, reason, {
    action: "course.take_down",
    versionStatus: "taken_down",
    courseStatus: "taken_down",
  });
}

/**
 * Brings a taken-down course back exactly as it was (`course.publish`, human only). It needs a
 * FRESH approval: review decisions recorded on the taken-down version since the take-down must
 * satisfy the approval rule, and the version must pass validation against the live Tool Register
 * today. Older approvals do not count.
 */
export async function restoreCourse(ctx: Ctx, courseId: string, reason: string): Promise<CourseRow> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  const why = reason.trim();
  if (why === "") throw new AppError("invalid_input", "Give a reason. It is kept in the audit log.");
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    if (current.status !== "taken_down" || current.takenDownAt === null) {
      throw new AppError("conflict", "This course has not been taken down, so there is nothing to restore.");
    }
    const version = await takenDownVersion(tx, courseId);
    if (!version) throw new AppError("not_found", "The version that was taken down could not be found.");
    const content = contentOfVersion(version);
    const decisions = await loadDecisions(tx, version.id, current.takenDownAt);
    const evaluation = await evaluateStoredApproval(tx, version, content, decisions);
    if (!evaluation.approved) {
      throw new AppError(
        "approval_required",
        `This course needs a fresh approval, recorded after it was taken down, before it can be restored. ${evaluation.missing.join(" ")}`.trim(),
        { detail: { missing: evaluation.missing, versionId: version.id } },
      );
    }
    const validation = await strictValidation(ctx, tx, version, content);
    if (!validation.ok)
      throw validationError(
        validation,
        "This course cannot be restored because it no longer passes validation.",
      );

    await tx.update(courseVersion).set({ status: "published" }).where(eq(courseVersion.id, version.id));
    const updated = one(
      await tx
        .update(course)
        .set({
          status: "published",
          publishedVersionId: version.id,
          takenDownAt: null,
          takenDownReason: null,
        })
        .where(eq(course.id, courseId))
        .returning(),
      "course",
    );
    await audit(
      ctx,
      {
        action: "course.restore",
        targetType: "course",
        targetId: courseId,
        reason: why,
        meta: {
          versionId: version.id,
          approvalDecisionIds: decisions.filter((row) => row.decision === "approve").map((row) => row.id),
        },
      },
      tx,
    );
    return updated;
  });
}

/**
 * A planned removal from the catalogue (`course.publish`, human only). The course goes back to a
 * draft and no new learner can start it. Unlike a take-down, learners already enrolled keep their
 * version. Publishing again needs a new, approved revision.
 */
export async function unpublishCourse(ctx: Ctx, courseId: string, reason: string): Promise<TakeDownResult> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  return withdraw(ctx, courseId, reason, {
    action: "course.unpublish",
    versionStatus: SUPERSEDED_VERSION_STATUS,
    courseStatus: "from_draft",
  });
}

/** Retires a course for good (`course.publish`, human only). Learners already enrolled keep their version. */
export async function retireCourse(ctx: Ctx, courseId: string, reason: string): Promise<TakeDownResult> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  return withdraw(ctx, courseId, reason, {
    action: "course.retire",
    versionStatus: SUPERSEDED_VERSION_STATUS,
    courseStatus: "retired",
  });
}

async function setStepDisabled(
  ctx: Ctx,
  stepId: string,
  disabled: boolean,
  reason: string,
): Promise<StepRow> {
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(step).where(eq(step.id, stepId)).limit(1).for("update");
    if (!existing) throw new AppError("not_found", "That step could not be found.");
    if (existing.disabled === disabled) return existing;
    const updated = one(
      await tx
        .update(step)
        .set({
          disabled,
          disabledReason: disabled ? reason : null,
          disabledAt: disabled ? ctx.now : null,
          disabledBy: disabled && ctx.actor.type === "staff" ? ctx.actor.userId : null,
        })
        .where(eq(step.id, stepId))
        .returning(),
      "step",
    );
    await audit(
      ctx,
      {
        action: disabled ? "step.disable" : "step.enable",
        targetType: "step",
        targetId: stepId,
        reason: reason === "" ? undefined : reason,
        meta: { courseVersionId: existing.courseVersionId, key: existing.key },
      },
      tx,
    );
    return updated;
  });
}

/** Urgent take-down of one step without a new version (`course.take_down`). Takes effect at once. */
export async function disableStep(ctx: Ctx, stepId: string, reason: string): Promise<StepRow> {
  assertCan(ctx.actor, "course.take_down");
  if (reason.trim() === "")
    throw new AppError("invalid_input", "Give a reason. It is kept in the audit log.");
  return setStepDisabled(ctx, stepId, true, reason.trim());
}

/** Puts a disabled step back in front of learners, so it needs publish rights (`course.publish`, human only). */
export async function enableStep(ctx: Ctx, stepId: string, reason = ""): Promise<StepRow> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  return setStepDisabled(ctx, stepId, false, reason.trim());
}

/**
 * Flags a course for a person to look at, for example when a tool it uses changes
 * (`course.take_down`, so the tool-watching job may call it). A review task is opened and the
 * audit log records why. A live course's status becomes `needs_review` until someone clears it
 * with `clearNeedsReview`.
 *
 * This is a flag for staff, NOT a take-down (spec 3.9): the course stays in the catalogue and stays
 * startable, and `getPublishedCourseBySlug` returns it with `needsReview: true`. Only a tightening
 * of a tool's age policy blocks Start, and the start gate enforces that separately. To hide a
 * course, use `takeDownCourse`. A course that is not live keeps its status.
 */
export async function markNeedsReview(
  ctx: Ctx,
  courseId: string,
  reason: string,
): Promise<{ course: CourseRow; task: ReviewTaskRow }> {
  assertCan(ctx.actor, "course.take_down");
  const why = reason.trim();
  if (why === "") throw new AppError("invalid_input", "Say why the course needs a review.");
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    const versionId = current.publishedVersionId ?? current.workingVersionId;
    const [open] = await tx
      .select()
      .from(reviewTask)
      .where(
        and(
          eq(reviewTask.courseId, courseId),
          eq(reviewTask.kind, "course_review"),
          inArray(reviewTask.status, ["open", "in_progress"]),
          eq(reviewTask.detail, why),
        ),
      )
      .limit(1);
    const task =
      open ??
      one(
        await tx
          .insert(reviewTask)
          .values({
            kind: "course_review",
            status: "open",
            title: `Needs review: ${current.title}`,
            detail: why,
            courseId,
            courseVersionId: versionId,
            createdBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
            createdAt: ctx.now,
          })
          .returning(),
        "review_task",
      );
    let updated = current;
    if (current.status === "published") {
      updated = one(
        await tx.update(course).set({ status: "needs_review" }).where(eq(course.id, courseId)).returning(),
        "course",
      );
    }
    await audit(
      ctx,
      {
        action: "course.needs_review",
        targetType: "course",
        targetId: courseId,
        reason: why,
        meta: { taskId: task.id, statusFrom: current.status, statusTo: updated.status },
      },
      tx,
    );
    return { course: updated, task };
  });
}

/**
 * A person confirms a flagged course is fine and clears the flag (`course.publish`, human only).
 * The course must still pass validation against the live Tool Register; if it does not, fix it
 * with a new revision or take it down.
 */
export async function clearNeedsReview(ctx: Ctx, courseId: string, reason: string): Promise<CourseRow> {
  assertCan(ctx.actor, "course.publish");
  requireStaff(ctx);
  const why = reason.trim();
  if (why === "") throw new AppError("invalid_input", "Say what was checked. It is kept in the audit log.");
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    if (current.status !== "needs_review" || current.publishedVersionId === null) {
      throw new AppError("conflict", "This course is not flagged for review.");
    }
    const version = await readVersion(tx, current.publishedVersionId);
    const validation = await strictValidation(ctx, tx, version, contentOfVersion(version));
    if (!validation.ok)
      throw validationError(
        validation,
        "The review flag cannot be cleared because this course no longer passes validation.",
      );
    const updated = one(
      await tx.update(course).set({ status: "published" }).where(eq(course.id, courseId)).returning(),
      "course",
    );
    await audit(
      ctx,
      {
        action: "course.needs_review.clear",
        targetType: "course",
        targetId: courseId,
        reason: why,
        meta: { versionId: version.id },
      },
      tx,
    );
    return updated;
  });
}
