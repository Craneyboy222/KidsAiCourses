import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, ts } from "./_columns";
import { course, courseVersion, quiz, step } from "./content";
import {
  artefactKindEnum,
  enrolmentStatusEnum,
  moderationStateEnum,
  peopleCheckResultEnum,
  projectStatusEnum,
  projectVisibilityEnum,
  stepProgressStatusEnum,
  unlockRequestKindEnum,
  unlockRequestStatusEnum,
} from "./enums";
import { family, user } from "./identity";

/**
 * Learner activity (spec 3.2, 3.4, 12). Every table is indexed on `learner_id` and is removed with
 * the learner's account (`ON DELETE CASCADE`). Content rows they point at are `RESTRICT`: a
 * published version that has been studied can be retired but not deleted.
 */

export const enrolment = pgTable(
  "enrolment",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    /** Pinned to the version the learner started. */
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "restrict" }),
    /** Resume point. */
    currentStepId: uuid("current_step_id").references(() => step.id, { onDelete: "set null" }),
    status: enrolmentStatusEnum("status").notNull().default("active"),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    lastActivityAt: ts("last_activity_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("enrolment_learner_course_uq").on(t.learnerId, t.courseId),
    index("enrolment_learner_idx").on(t.learnerId, t.status),
    index("enrolment_version_idx").on(t.courseVersionId),
  ],
);

export const stepProgress = pgTable(
  "step_progress",
  {
    id: id(),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => step.id, { onDelete: "restrict" }),
    status: stepProgressStatusEnum("status").notNull().default("not_started"),
    /** The learner's own notes. Free text: never logged. */
    notes: text("notes"),
    /** Step-type state: video position, ticked items, setup acknowledgement, hint level reached. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    completedAt: ts("completed_at"),
    skippedAt: ts("skipped_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("step_progress_enrolment_step_uq").on(t.enrolmentId, t.stepId),
    index("step_progress_learner_idx").on(t.learnerId),
    index("step_progress_step_idx").on(t.stepId),
  ],
);

export const quizAttempt = pgTable(
  "quiz_attempt",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "restrict" }),
    stepId: uuid("step_id").references(() => step.id, { onDelete: "set null" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    /** `{ [questionKey]: optionIds }` */
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    /** Percentage, 0–100. */
    score: integer("score").notNull(),
    passed: boolean("passed").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("quiz_attempt_learner_idx").on(t.learnerId),
    index("quiz_attempt_enrolment_quiz_idx").on(t.enrolmentId, t.quizId),
    check("quiz_attempt_score_range", sql`${t.score} BETWEEN 0 AND 100`),
  ],
);

export const reflection = pgTable(
  "reflection",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => step.id, { onDelete: "restrict" }),
    /** Free text written by the learner. Never logged. */
    body: text("body").notNull(),
    moderationState: moderationStateEnum("moderation_state").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("reflection_enrolment_step_uq").on(t.enrolmentId, t.stepId),
    index("reflection_learner_idx").on(t.learnerId),
  ],
);

/** A portfolio entry: one per enrolment. Visible only to the learner and their linked parents. */
export const project = pgTable(
  "project",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    visibility: projectVisibilityEnum("visibility").notNull().default("private"),
    status: projectStatusEnum("status").notNull().default("in_progress"),
    /** The submission currently shown in the portfolio. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => projectVersion.id, {
      onDelete: "set null",
    }),
    acceptedAt: ts("accepted_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("project_enrolment_uq").on(t.enrolmentId),
    index("project_learner_idx").on(t.learnerId, t.status),
  ],
);

/** One submission attempt for a project, with its automated checks and moderation outcome. */
export const projectVersion = pgTable(
  "project_version",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** The submit step it was sent from. */
    stepId: uuid("step_id").references(() => step.id, { onDelete: "set null" }),
    /** The learner's own note, e.g. an honesty note. Free text: never logged. */
    note: text("note"),
    /** Rubric self-check: `{ [criterionKey]: "Not yet" | "Getting there" | "Nailed it" }`. Never blocks submit. */
    selfCheck: jsonb("self_check").$type<Record<string, string>>().notNull().default({}),
    moderationState: moderationStateEnum("moderation_state").notNull().default("pending"),
    /** Picked for the random human review sample: held until a person accepts it (decision D4). */
    sampled: boolean("sampled").notNull().default(false),
    /** Outcome of each automated check, by name. */
    autoChecks: jsonb("auto_checks").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    /** Null when accepted or blocked automatically. */
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("project_version_project_version_uq").on(t.projectId, t.version),
    index("project_version_learner_idx").on(t.learnerId),
    index("project_version_state_idx").on(t.moderationState, t.submittedAt),
  ],
);

/** One piece of evidence: a link we never fetch, or a file held in private storage and opened by signed URL. */
export const artefact = pgTable(
  "artefact",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    /** Null for a mid-course upload that is not part of a submission. */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    projectVersionId: uuid("project_version_id").references(() => projectVersion.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => step.id, { onDelete: "set null" }),
    kind: artefactKindEnum("kind").notNull(),
    /** For `link`: HTTPS only, never a private-network address. */
    url: text("url"),
    /** For uploads: key in the private bucket. Cleared when the file is deleted from storage. */
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    mime: text("mime"),
    moderationState: moderationStateEnum("moderation_state").notNull().default("pending"),
    peopleCheck: peopleCheckResultEnum("people_check").notNull().default("pending"),
    peopleCheckProvider: text("people_check_provider"),
    /** Possibly illegal media is quarantined, not deleted, and opens a critical safeguarding case (decision D3). */
    quarantined: boolean("quarantined").notNull().default(false),
    /** Rejected media is deleted from storage at once; the hash and metadata stay (decision D3). */
    deletedFromStorageAt: ts("deleted_from_storage_at"),
    rejectedReason: text("rejected_reason"),
    ...timestamps(),
  },
  (t) => [
    index("artefact_learner_idx").on(t.learnerId),
    index("artefact_project_version_idx").on(t.projectVersionId),
    index("artefact_enrolment_idx").on(t.enrolmentId),
    index("artefact_sha256_idx").on(t.sha256),
    check(
      "artefact_has_location",
      sql`${t.url} IS NOT NULL OR ${t.storageKey} IS NOT NULL OR ${t.deletedFromStorageAt} IS NOT NULL`,
    ),
    check("artefact_link_has_url", sql`${t.kind} <> 'link' OR ${t.url} IS NOT NULL`),
  ],
);

export const certificate = pgTable(
  "certificate",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolment.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "restrict" }),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    /** Public code for `/verify/[code]`. Random and unguessable; reveals nothing by itself. */
    verifyCode: text("verify_code").notNull(),
    /** First name or nickname, as the learner chose when it was issued. */
    displayName: text("display_name").notNull(),
    courseTitle: text("course_title").notNull(),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason"),
    revokedBy: uuid("revoked_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("certificate_verify_code_uq").on(t.verifyCode),
    uniqueIndex("certificate_enrolment_uq").on(t.enrolmentId),
    index("certificate_learner_idx").on(t.learnerId),
  ],
);

/** "Save for later". */
export const wishlist = pgTable(
  "wishlist",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("wishlist_learner_course_uq").on(t.learnerId, t.courseId)],
);

/** "Ask a parent to unlock": a paid course on the Free plan, or a Pro course when the parent requires approval. */
export const unlockRequest = pgTable(
  "unlock_request",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    kind: unlockRequestKindEnum("kind").notNull(),
    status: unlockRequestStatusEnum("status").notNull().default("pending"),
    decidedAt: ts("decided_at"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("unlock_request_learner_idx").on(t.learnerId),
    index("unlock_request_family_status_idx").on(t.familyId, t.status),
    // Only one open request per learner, course and kind.
    uniqueIndex("unlock_request_one_pending_uq")
      .on(t.learnerId, t.courseId, t.kind)
      .where(sql`${t.status} = 'pending'`),
  ],
);
