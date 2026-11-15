import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { createdAt, emptyTextArray, id, timestamps, ts } from "./_columns";
import { course, courseVersion } from "./content";
import {
  courseIdeaStatusEnum,
  difficultyEnum,
  generationJobKindEnum,
  generationStatusEnum,
  pathwayEnum,
  publishScheduleStatusEnum,
  radarCandidateStatusEnum,
  reviewDecisionEnum,
  reviewTaskKindEnum,
  reviewTaskStatusEnum,
  toolApprovalStatusEnum,
  toolChangeImpactEnum,
  toolChangeStatusEnum,
  toolStatusEnum,
  under18PolicyEnum,
} from "./enums";
import { family, user } from "./identity";
import { report } from "./safety";

/**
 * Tool Register, Tool Radar and the AI course creation engine (spec 3.3, 3.9, 6.3, 12).
 * The Register holds external tools learners build in. Coach and drafting model providers are
 * processors, recorded in `ai_processor`, never here (decision D1).
 */

export const tool = pgTable(
  "tool",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    vendorDomain: text("vendor_domain"),
    officialUrl: text("official_url"),
    /** Allow-list for every learner-facing link to this tool. A link must start with one of these. */
    allowedUrlPrefixes: text("allowed_url_prefixes").array().notNull().default(emptyTextArray),
    /** Free text shown in "Tools you'll need", e.g. "Free plan is enough; Pro is £8 a month". */
    cost: text("cost"),
    freeTier: text("free_tier"),
    /** Minimum age under the vendor's terms. Null means not yet verified, which is never treated as "allowed". */
    minAge: smallint("min_age"),
    consentRule: text("consent_rule"),
    /** Null until a human sets it. A course using the tool cannot go live while this is null. */
    under18Policy: under18PolicyEnum("under18_policy"),
    /** Who recorded that the vendor allows a parent-operated account, and when. Required for `parent_operated`. */
    parentOperatedAllowedRecordedBy: uuid("parent_operated_allowed_recorded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    parentOperatedAllowedRecordedAt: ts("parent_operated_allowed_recorded_at"),
    notes: text("notes"),
    status: toolStatusEnum("status").notNull().default("candidate"),
    lastCheckedAt: ts("last_checked_at"),
    verifiedBy: uuid("verified_by").references(() => user.id, { onDelete: "set null" }),
    verifiedAt: ts("verified_at"),
    /** Quoted evidence with URLs: `[{ field, quote, url, fetchedAt }]`. */
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    /** Pages `tools.watch` fetches: `[{ kind, url, hash, checkedAt }]`. */
    watchPages: jsonb("watch_pages").$type<unknown[]>().notNull().default([]),
    sourceCandidateId: uuid("source_candidate_id").references((): AnyPgColumn => radarCandidate.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tool_slug_uq").on(t.slug),
    index("tool_status_idx").on(t.status),
    index("tool_vendor_domain_idx").on(t.vendorDomain),
    check("tool_min_age_range", sql`${t.minAge} IS NULL OR ${t.minAge} BETWEEN 0 AND 21`),
    // Spec 3.3: parent_operated only once a reviewer has recorded that it is allowed.
    check(
      "tool_parent_operated_recorded",
      sql`${t.under18Policy} IS DISTINCT FROM 'parent_operated' OR ${t.parentOperatedAllowedRecordedAt} IS NOT NULL`,
    ),
    // An approved tool always has a human-set policy.
    check("tool_approved_has_policy", sql`${t.status} <> 'approved' OR ${t.under18Policy} IS NOT NULL`),
  ],
);

export const toolSubstitute = pgTable(
  "tool_substitute",
  {
    id: id(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tool.id, { onDelete: "cascade" }),
    substituteToolId: uuid("substitute_tool_id")
      .notNull()
      .references(() => tool.id, { onDelete: "cascade" }),
    note: text("note"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tool_substitute_pair_uq").on(t.toolId, t.substituteToolId),
    check("tool_substitute_not_self", sql`${t.toolId} <> ${t.substituteToolId}`),
  ],
);

export const toolChangeEvent = pgTable(
  "tool_change_event",
  {
    id: id(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tool.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    pageKind: text("page_kind"),
    oldHash: text("old_hash"),
    newHash: text("new_hash"),
    diffSummary: text("diff_summary"),
    impact: toolChangeImpactEnum("impact").notNull().default("none"),
    status: toolChangeStatusEnum("status").notNull().default("open"),
    /** A tightening of age policy blocks Start for affected learners until a human has triaged it. */
    blocksStart: boolean("blocks_start").notNull().default(false),
    detectedAt: ts("detected_at").notNull().defaultNow(),
    triagedBy: uuid("triaged_by").references(() => user.id, { onDelete: "set null" }),
    triagedAt: ts("triaged_at"),
    resolutionNote: text("resolution_note"),
    ...timestamps(),
  },
  (t) => [
    index("tool_change_event_tool_status_idx").on(t.toolId, t.status),
    index("tool_change_event_status_idx").on(t.status, t.detectedAt),
  ],
);

/** A parent's approval of one tool, for one course, for one learner (spec 3.3). */
export const toolApproval = pgTable(
  "tool_approval",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tool.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    status: toolApprovalStatusEnum("status").notNull().default("pending"),
    /** The Register policy when the parent decided, so a later tightening can be detected. */
    policyAtDecision: under18PolicyEnum("policy_at_decision"),
    /** For `parent_operated`: the parent confirmed they will run the account themselves. */
    parentOperatedConfirmed: boolean("parent_operated_confirmed").notNull().default(false),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: ts("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tool_approval_learner_tool_course_uq").on(t.learnerId, t.toolId, t.courseId),
    index("tool_approval_learner_idx").on(t.learnerId),
    index("tool_approval_family_status_idx").on(t.familyId, t.status),
    index("tool_approval_tool_idx").on(t.toolId),
  ],
);

export const radarSource = pgTable(
  "radar_source",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** Adapter id in `src/server/radar`, e.g. `hacker_news`, `rss`, `hugging_face`. */
    adapter: text("adapter").notNull(),
    /** Adapter settings (feeds, search terms, rate limits). Never secrets: tokens stay in environment variables. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** Cron expression in Europe/London. */
    schedule: text("schedule").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Sources such as Product Hunt and GitHub need the owner's go-ahead before they can be enabled. */
    requiresOwnerApproval: boolean("requires_owner_approval").notNull().default(false),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    lastRunAt: ts("last_run_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("radar_source_key_uq").on(t.key),
    check(
      "radar_source_enabled_needs_approval",
      sql`NOT (${t.enabled} AND ${t.requiresOwnerApproval}) OR ${t.approvedAt} IS NOT NULL`,
    ),
  ],
);

export const radarItem = pgTable(
  "radar_item",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => radarSource.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    text: text("text"),
    publishedAt: ts("published_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    contentHash: text("content_hash").notNull(),
    /** Set once `radar.normalise` has turned the item into a candidate or a mention. */
    normalisedAt: ts("normalised_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("radar_item_source_external_uq").on(t.sourceId, t.externalId),
    index("radar_item_hash_idx").on(t.contentHash),
    index("radar_item_pending_idx").on(t.normalisedAt, t.createdAt),
  ],
);

export const radarCandidate = pgTable(
  "radar_candidate",
  {
    id: id(),
    name: text("name").notNull(),
    /** First dedupe key. */
    vendorDomain: text("vendor_domain"),
    canonicalUrl: text("canonical_url"),
    /** Structured facts from enrichment. Unknowns stay absent: never guessed. */
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
    /** `[{ field, quote, url }]` */
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    /** 0–100. */
    score: integer("score"),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, unknown>>(),
    scoreExplanation: text("score_explanation"),
    scoredAt: ts("scored_at"),
    /** Hard gate: no acceptable under-18 route, so the score is capped and drafting needs a review first. */
    ageRestricted: boolean("age_restricted").notNull().default(false),
    /** Proposed by enrichment for an editor to confirm on the Tool Register. */
    proposedUnder18Policy: under18PolicyEnum("proposed_under18_policy"),
    status: radarCandidateStatusEnum("status").notNull().default("new"),
    mentionCount: integer("mention_count").notNull().default(0),
    toolId: uuid("tool_id").references((): AnyPgColumn => tool.id, { onDelete: "set null" }),
    enrichedAt: ts("enriched_at"),
    dismissedAt: ts("dismissed_at"),
    dismissedBy: uuid("dismissed_by").references(() => user.id, { onDelete: "set null" }),
    dismissedReason: text("dismissed_reason"),
    ...timestamps(),
  },
  (t) => [
    index("radar_candidate_domain_idx").on(t.vendorDomain),
    index("radar_candidate_status_score_idx").on(t.status, t.score),
    check("radar_candidate_score_range", sql`${t.score} IS NULL OR ${t.score} BETWEEN 0 AND 100`),
  ],
);

export const radarMention = pgTable(
  "radar_mention",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => radarCandidate.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => radarItem.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("radar_mention_candidate_item_uq").on(t.candidateId, t.itemId),
    index("radar_mention_item_idx").on(t.itemId),
  ],
);

/** The ideas backlog, seeded from `content/course-ideas.json` (decisions D5–D7). */
export const courseIdea = pgTable(
  "course_idea",
  {
    id: id(),
    /** Stable public id, e.g. `IDEA-001`. */
    ideaKey: text("idea_key").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    /** Category slug. */
    category: text("category").notNull(),
    difficulty: difficultyEnum("difficulty").notNull(),
    minAge: smallint("min_age").notNull().default(13),
    pathways: pathwayEnum("pathways")
      .array()
      .notNull()
      .default(sql`'{}'::pathway[]`),
    /** `{ age18Tools, safeguarding, examIntegrity }` */
    flags: jsonb("flags").$type<Record<string, boolean>>().notNull().default({}),
    watchNote: text("watch_note"),
    careers: text("careers"),
    suggestedForLaunch: boolean("suggested_for_launch").notNull().default(false),
    status: courseIdeaStatusEnum("status").notNull().default("idea"),
    courseId: uuid("course_id").references((): AnyPgColumn => course.id, { onDelete: "set null" }),
    dismissedReason: text("dismissed_reason"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("course_idea_key_uq").on(t.ideaKey),
    index("course_idea_status_idx").on(t.status),
    index("course_idea_category_idx").on(t.category),
    check("course_idea_min_age_range", sql`${t.minAge} BETWEEN 13 AND 18`),
  ],
);

export const generationJob = pgTable(
  "generation_job",
  {
    id: id(),
    kind: generationJobKindEnum("kind").notNull(),
    /** What started it: `score_threshold`, `subject`, `tool_name`, `idea_id` or `manual_candidate`. */
    trigger: text("trigger").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    status: generationStatusEnum("status").notNull().default("queued"),
    costPence: integer("cost_pence").notNull().default(0),
    model: text("model"),
    attempts: integer("attempts").notNull().default(0),
    courseId: uuid("course_id").references((): AnyPgColumn => course.id, { onDelete: "set null" }),
    resultVersionId: uuid("result_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    candidateId: uuid("candidate_id").references((): AnyPgColumn => radarCandidate.id, {
      onDelete: "set null",
    }),
    ideaId: uuid("idea_id").references((): AnyPgColumn => courseIdea.id, { onDelete: "set null" }),
    error: text("error"),
    /** Makes a retried job a no-op. */
    idempotencyKey: text("idempotency_key"),
    /** Null for `radar_auto`. */
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("generation_job_idempotency_uq").on(t.idempotencyKey),
    index("generation_job_status_idx").on(t.status, t.createdAt),
    index("generation_job_candidate_idx").on(t.candidateId),
    check("generation_job_cost_nonneg", sql`${t.costPence} >= 0`),
  ],
);

/** "Request edits": plain-English instructions the AI applies to a whole draft or a chosen scope. */
export const editRequest = pgTable(
  "edit_request",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references((): AnyPgColumn => courseVersion.id, { onDelete: "cascade" }),
    resultVersionId: uuid("result_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    instructions: text("instructions").notNull(),
    /** `{ whole: true }` or `{ modules: [...], lessons: [...], steps: [...] }` by key. */
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({ whole: true }),
    status: generationStatusEnum("status").notNull().default("queued"),
    costPence: integer("cost_pence").notNull().default(0),
    model: text("model"),
    error: text("error"),
    requestedBy: uuid("requested_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    ...timestamps(),
  },
  (t) => [
    index("edit_request_course_idx").on(t.courseId, t.createdAt),
    index("edit_request_status_idx").on(t.status),
  ],
);

/** Signed, time-limited, revocable staff preview link for a draft. Only the hash is stored. */
export const previewToken = pgTable(
  "preview_token",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references((): AnyPgColumn => courseVersion.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: ts("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => user.id, { onDelete: "set null" }),
    lastUsedAt: ts("last_used_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("preview_token_hash_uq").on(t.tokenHash),
    index("preview_token_version_idx").on(t.courseVersionId),
  ],
);

/** An item in the editors' queue: a draft to review, a guide to re-check, a tool to verify or a change to triage. */
export const reviewTask = pgTable(
  "review_task",
  {
    id: id(),
    kind: reviewTaskKindEnum("kind").notNull(),
    status: reviewTaskStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    detail: text("detail"),
    courseId: uuid("course_id").references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    courseVersionId: uuid("course_version_id").references((): AnyPgColumn => courseVersion.id, {
      onDelete: "set null",
    }),
    toolId: uuid("tool_id").references(() => tool.id, { onDelete: "cascade" }),
    /** `tool_guide.key` for a guide-review task. */
    toolGuideKey: text("tool_guide_key"),
    toolChangeEventId: uuid("tool_change_event_id").references(() => toolChangeEvent.id, {
      onDelete: "set null",
    }),
    /** The guide-mismatch report that raised this task. */
    reportId: uuid("report_id").references((): AnyPgColumn => report.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => user.id, { onDelete: "set null" }),
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("review_task_queue_idx").on(t.status, t.kind, t.createdAt),
    index("review_task_course_idx").on(t.courseId),
    index("review_task_assignee_idx").on(t.assigneeId),
  ],
);

/**
 * The human sign-off record. The publish service refuses any version without an `approve` row
 * from a person. Rows are written once and not edited.
 */
export const reviewDecision = pgTable(
  "review_decision",
  {
    id: id(),
    reviewTaskId: uuid("review_task_id").references(() => reviewTask.id, { onDelete: "set null" }),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references((): AnyPgColumn => courseVersion.id, { onDelete: "cascade" }),
    /** Restrict: an approval must always name its human. Staff accounts with approvals are deactivated, not deleted. */
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: reviewDecisionEnum("decision").notNull(),
    /** Answers to the QA checklist (spec Section 7), keyed by checklist item. */
    checklist: jsonb("checklist").$type<Record<string, unknown>>().notNull().default({}),
    checklistVersion: text("checklist_version"),
    /** Confirmation that tool-specific claims were checked against the live tool. */
    toolClaimsChecked: boolean("tool_claims_checked").notNull().default(false),
    /** Explicit, logged waivers: `[{ check, reason }]`. */
    waivers: jsonb("waivers").$type<unknown[]>().notNull().default([]),
    /** True when the reviewer was also the last person to edit this version (two-person rule). */
    reviewerWasLastEditor: boolean("reviewer_was_last_editor").notNull().default(false),
    /** Staff roles the reviewer held at the time, e.g. to prove a `safety_reviewer` signed off. */
    reviewerRoles: text("reviewer_roles").array().notNull().default(emptyTextArray),
    /** The reviewer confirmed the warning shown before approving a safeguarding-sensitive course alone. */
    safeguardingSensitiveConfirmed: boolean("safeguarding_sensitive_confirmed").notNull().default(false),
    /** Decline reason, or the instructions for requested edits. */
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [
    index("review_decision_version_idx").on(t.courseVersionId, t.decision),
    index("review_decision_course_idx").on(t.courseId),
    index("review_decision_reviewer_idx").on(t.reviewerId),
  ],
);

export const reviewComment = pgTable(
  "review_comment",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references((): AnyPgColumn => courseVersion.id, { onDelete: "cascade" }),
    reviewTaskId: uuid("review_task_id").references(() => reviewTask.id, { onDelete: "set null" }),
    authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Where the comment points, e.g. `{ module, lesson, step }` by key. */
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    body: text("body").notNull(),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("review_comment_version_idx").on(t.courseVersionId, t.createdAt)],
);

export const publishSchedule = pgTable(
  "publish_schedule",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => course.id, { onDelete: "cascade" }),
    courseVersionId: uuid("course_version_id")
      .notNull()
      .references((): AnyPgColumn => courseVersion.id, { onDelete: "cascade" }),
    publishAt: ts("publish_at").notNull(),
    status: publishScheduleStatusEnum("status").notNull().default("scheduled"),
    scheduledBy: uuid("scheduled_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: ts("published_at"),
    cancelledAt: ts("cancelled_at"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    index("publish_schedule_due_idx").on(t.status, t.publishAt),
    index("publish_schedule_version_idx").on(t.courseVersionId),
  ],
);

/** Versioned prompts: Coach system prompt and safety preamble, drafting, Radar extraction and scoring, edit requests. */
export const promptTemplate = pgTable(
  "prompt_template",
  {
    id: id(),
    /** e.g. `coach.system`, `draft.course`, `radar.extract`. */
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Exactly one version per key is active. */
    active: boolean("active").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("prompt_template_key_version_uq").on(t.key, t.version),
    uniqueIndex("prompt_template_one_active_uq")
      .on(t.key)
      .where(sql`${t.active}`),
  ],
);
