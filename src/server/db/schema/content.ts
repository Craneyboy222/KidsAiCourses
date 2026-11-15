import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { emptyTextArray, id, timestamps, ts, tsvector } from "./_columns";
import {
  assetKindEnum,
  assetLicenceEnum,
  completionRuleEnum,
  courseOriginEnum,
  courseStatusEnum,
  difficultyEnum,
  guideStepKindEnum,
  pathwayEnum,
  quizQuestionKindEnum,
  stepTypeEnum,
  tagKindEnum,
} from "./enums";
import { user } from "./identity";
import { courseIdea, generationJob, radarCandidate, tool } from "./tools-radar";

/**
 * Courses (spec Section 6 and 12, docs/ARCHITECTURE.md "Courses and versions").
 *
 * `course` is the stable identity. `course_version.snapshot` is the canonical content. On approval
 * the publish service materialises a snapshot into `module`, `lesson`, `step`, `quiz`,
 * `quiz_question`, `rubric_criterion`, `course_tool`, `tool_guide` and `tool_guide_step`, all keyed
 * by `course_version_id`. In those tables `key` is the id used inside the course JSON.
 */

export const course = pgTable(
  "course",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    origin: courseOriginEnum("origin").notNull().default("hand_made"),
    status: courseStatusEnum("status").notNull().default("draft"),
    /** The version learners see. Null until first publish and after take-down. */
    publishedVersionId: uuid("published_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    /** The newest draft revision being edited or reviewed. */
    workingVersionId: uuid("working_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    sourceCandidateId: uuid("source_candidate_id").references((): AnyPgColumn => radarCandidate.id, {
      onDelete: "set null",
    }),
    sourceIdeaId: uuid("source_idea_id").references((): AnyPgColumn => courseIdea.id, {
      onDelete: "set null",
    }),
    generationJobId: uuid("generation_job_id").references((): AnyPgColumn => generationJob.id, {
      onDelete: "set null",
    }),

    // Catalogue fields, copied from the published snapshot by the publish service so that the
    // catalogue, search and the age gate never have to open the JSON.
    tagline: text("tagline"),
    whatYouMake: text("what_you_make"),
    /** One of the 24 category slugs (`tag` rows of kind `category`). */
    category: text("category"),
    difficulty: difficultyEnum("difficulty"),
    pathways: pathwayEnum("pathways")
      .array()
      .notNull()
      .default(sql`'{}'::pathway[]`),
    /** Hard gate: a learner younger than this never sees or opens the course. */
    minAge: smallint("min_age").notNull().default(13),
    isFree: boolean("is_free").notNull().default(false),
    estimatedMinutes: integer("estimated_minutes"),
    interests: text("interests").array().notNull().default(emptyTextArray),
    careers: text("careers").array().notNull().default(emptyTextArray),
    /** Tool slugs required by the published version, for the "tool type" filter. */
    toolSlugs: text("tool_slugs").array().notNull().default(emptyTextArray),
    safeguardingSensitive: boolean("safeguarding_sensitive").notNull().default(false),
    lastVerifiedAt: ts("last_verified_at"),
    guidesLastVerifiedAt: ts("guides_last_verified_at"),
    publishedAt: ts("published_at"),
    takenDownAt: ts("taken_down_at"),
    takenDownReason: text("taken_down_reason"),
    /** Count of enrolments, for the "popular" sort. An aggregate only: never per-learner. */
    enrolmentCount: integer("enrolment_count").notNull().default(0),
    /** Postgres full-text search over title, tagline and what-you-make. */
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${course.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${course.tagline}, '')), 'B') || setweight(to_tsvector('english', coalesce(${course.whatYouMake}, '')), 'C')`,
    ),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("course_slug_uq").on(t.slug),
    index("course_status_idx").on(t.status),
    index("course_catalogue_idx").on(t.status, t.category, t.minAge),
    index("course_published_at_idx").on(t.publishedAt),
    index("course_search_idx").using("gin", t.search),
    index("course_interests_idx").using("gin", t.interests),
    check("course_min_age_range", sql`${t.minAge} BETWEEN 13 AND 18`),
  ],
);

export const courseVersion = pgTable(
  "course_version",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    /** 1, 2, 3 … per course. Every save, inline edit or AI regeneration inserts `revision + 1`. */
    revision: integer("revision").notNull(),
    /** The `version` string from the course JSON, shown to editors. */
    semver: text("semver").notNull().default("0.1.0"),
    status: courseStatusEnum("status").notNull().default("draft"),
    /** Canonical content. Always parses with the Zod `Course` schema. Frozen by trigger once published. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    /** Result of the last validation run: `{ ok, issues: [...] }`. Null means not yet validated. */
    validation: jsonb("validation").$type<Record<string, unknown>>(),
    /** Internal only: evidence URLs and reviewer notes. Never shown to learners. */
    editorNotes: text("editor_notes"),
    /** Unverified claims, e.g. `[{ path, claim }]`, shown as `[VERIFY]` in the review view. */
    verifyFlags: jsonb("verify_flags").$type<unknown[]>().notNull().default([]),
    origin: courseOriginEnum("origin").notNull().default("hand_made"),
    generationJobId: uuid("generation_job_id").references((): AnyPgColumn => generationJob.id, {
      onDelete: "set null",
    }),
    sourceCandidateId: uuid("source_candidate_id").references((): AnyPgColumn => radarCandidate.id, {
      onDelete: "set null",
    }),
    sourceIdeaId: uuid("source_idea_id").references((): AnyPgColumn => courseIdea.id, {
      onDelete: "set null",
    }),
    /** Model, prompt template version, cost and retry count for an AI-written revision. */
    generationMeta: jsonb("generation_meta").$type<Record<string, unknown>>(),
    /** The revision this one was made from (edit, regeneration or restore). */
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    /** Whoever last changed the content. The two-person rule compares this with the approver. Null for an untouched AI draft. */
    lastEditedBy: uuid("last_edited_by").references(() => user.id, { onDelete: "set null" }),
    materialisedAt: ts("materialised_at"),
    publishedAt: ts("published_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("course_version_course_revision_uq").on(t.courseId, t.revision),
    index("course_version_course_status_idx").on(t.courseId, t.status),
    check("course_version_revision_positive", sql`${t.revision} >= 1`),
  ],
);

/** Table `module`. The export is `courseModule` because `module` is a reserved name in CommonJS scripts. */
export const courseModule = pgTable(
  "module",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("module_version_key_uq").on(t.courseVersionId, t.key),
    index("module_version_position_idx").on(t.courseVersionId, t.position),
  ],
);

export const lesson = pgTable(
  "lesson",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => courseModule.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("lesson_version_key_uq").on(t.courseVersionId, t.key),
    index("lesson_module_position_idx").on(t.moduleId, t.position),
  ],
);

export const step = pgTable(
  "step",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    type: stepTypeEnum("type").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    body: text("body"),
    /** `asset.key` values. */
    assetKeys: text("asset_keys").array().notNull().default(emptyTextArray),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    completionRule: completionRuleEnum("completion_rule").notNull(),
    completionThreshold: integer("completion_threshold"),
    /** Hidden context for Coach. Never sent to the browser. */
    coachContext: text("coach_context"),
    hints: text("hints").array().notNull().default(emptyTextArray),
    /** Set on `setup_guide` and `external_task` steps. */
    toolSlug: text("tool_slug"),
    /** Urgent take-down of one step without a new version. */
    disabled: boolean("disabled").notNull().default(false),
    disabledReason: text("disabled_reason"),
    disabledAt: ts("disabled_at"),
    disabledBy: uuid("disabled_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("step_version_key_uq").on(t.courseVersionId, t.key),
    index("step_lesson_position_idx").on(t.lessonId, t.position),
    index("step_tool_slug_idx").on(t.toolSlug),
  ],
);

export const quiz = pgTable(
  "quiz",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    /** Percentage, 0–100. */
    passMark: integer("pass_mark").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("quiz_version_key_uq").on(t.courseVersionId, t.key),
    check("quiz_pass_mark_range", sql`${t.passMark} BETWEEN 0 AND 100`),
  ],
);

export const quizQuestion = pgTable(
  "quiz_question",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: quizQuestionKindEnum("kind").notNull(),
    prompt: text("prompt").notNull(),
    /** `[{ id, text, correct, feedback }]`. `correct` must never reach the browser before an attempt is marked. */
    options: jsonb("options").$type<unknown[]>().notNull(),
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("quiz_question_quiz_key_uq").on(t.quizId, t.key)],
);

export const rubricCriterion = pgTable(
  "rubric_criterion",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** `[{ label: "Not yet" | "Getting there" | "Nailed it", descriptor }]` */
    levels: jsonb("levels").$type<unknown[]>().notNull(),
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("rubric_criterion_version_key_uq").on(t.courseVersionId, t.key)],
);

/** A version's `toolRequirements`. Tool display facts are never copied here: they are read from `tool` at request time. */
export const courseTool = pgTable(
  "course_tool",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    /** Restrict: a tool used by a materialised course is retired, never deleted. */
    toolId: uuid("tool_id")
      .notNull()
      .references((): AnyPgColumn => tool.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    required: boolean("required").notNull().default(true),
    fallbackToolId: uuid("fallback_tool_id").references((): AnyPgColumn => tool.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("course_tool_version_tool_uq").on(t.courseVersionId, t.toolId),
    index("course_tool_tool_idx").on(t.toolId),
    index("course_tool_course_idx").on(t.courseId),
  ],
);

export const toolGuide = pgTable(
  "tool_guide",
  {
    id: id(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references(() => courseVersion.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references((): AnyPgColumn => tool.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    lastVerifiedAt: ts("last_verified_at"),
    /** Set by an editor or by `tools.impact` when the tool changes. */
    stale: boolean("stale").notNull().default(false),
    staleReason: text("stale_reason"),
    staleMarkedAt: ts("stale_marked_at"),
    /** A reviewed waiver for a missing guide section: `{ sections, reason, reviewerId, at }`. */
    waiver: jsonb("waiver").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tool_guide_version_key_uq").on(t.courseVersionId, t.key),
    index("tool_guide_tool_idx").on(t.toolId),
  ],
);

export const toolGuideStep = pgTable(
  "tool_guide_step",
  {
    id: id(),
    toolGuideId: uuid("tool_guide_id")
      .notNull()
      .references(() => toolGuide.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    kind: guideStepKindEnum("kind").notNull(),
    body: text("body").notNull(),
    /** `asset.key` values of kind `guide_screenshot`. */
    screenshotAssetKeys: text("screenshot_asset_keys").array().notNull().default(emptyTextArray),
    ...timestamps(),
  },
  (t) => [uniqueIndex("tool_guide_step_guide_key_uq").on(t.toolGuideId, t.key)],
);

/** Licensed platform media (videos, captions, transcripts, templates, screenshots). Not learner uploads: those are `artefact`. */
export const asset = pgTable(
  "asset",
  {
    id: id(),
    /** The asset id used in course JSON, e.g. `snap-trailer`. */
    key: text("key").notNull(),
    kind: assetKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    licence: assetLicenceEnum("licence").notNull(),
    attribution: text("attribution"),
    /** Required for images. */
    altText: text("alt_text"),
    durationSec: integer("duration_sec"),
    mime: text("mime"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("asset_key_uq").on(t.key), index("asset_kind_idx").on(t.kind)],
);

/** Controlled vocabularies: the 24 categories, 16 interests, plus careers and skills. Courses refer to tags by slug. */
export const tag = pgTable(
  "tag",
  {
    id: id(),
    kind: tagKindEnum("kind").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("tag_kind_slug_uq").on(t.kind, t.slug)],
);
