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
import { aiRequest } from "./ai";
import {
  actorTypeEnum,
  appealStatusEnum,
  dataRequestKindEnum,
  dataRequestStatusEnum,
  enforcementKindEnum,
  moderationSeverityEnum,
  moderationSourceEnum,
  moderationStateEnum,
  moderationSubjectTypeEnum,
  moderationVerdictEnum,
  reportReasonEnum,
  reportStatusEnum,
  reportTargetTypeEnum,
  safeguardingDecisionEnum,
  safeguardingSeverityEnum,
  safeguardingStatusEnum,
  safeguardingTriggerEnum,
  supportTicketStatusEnum,
} from "./enums";
import { family, user } from "./identity";

/** Moderation, reports, safeguarding, audit and data rights (spec 3.8, 3.10, Section 9, 12). */

/** One automated check result. Holds category labels and scores, never the text or media that was checked. */
export const moderationEvent = pgTable(
  "moderation_event",
  {
    id: id(),
    subjectType: moderationSubjectTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    learnerId: uuid("learner_id").references(() => user.id, { onDelete: "cascade" }),
    /** `rules`, `gateway`, `people-detection:manual`, `link-check`, `file-check`. */
    provider: text("provider").notNull(),
    verdict: moderationVerdictEnum("verdict").notNull(),
    categories: jsonb("categories").$type<Record<string, unknown>>().notNull().default({}),
    severity: moderationSeverityEnum("severity"),
    moderationItemId: uuid("moderation_item_id").references((): AnyPgColumn => moderationItem.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("moderation_event_learner_idx").on(t.learnerId),
    index("moderation_event_subject_idx").on(t.subjectType, t.subjectId),
    index("moderation_event_created_idx").on(t.createdAt),
  ],
);

/** An entry in the human moderation queue. */
export const moderationItem = pgTable(
  "moderation_item",
  {
    id: id(),
    state: moderationStateEnum("state").notNull().default("pending"),
    severity: moderationSeverityEnum("severity").notNull().default("normal"),
    source: moderationSourceEnum("source").notNull(),
    subjectType: moderationSubjectTypeEnum("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    learnerId: uuid("learner_id").references(() => user.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").references((): AnyPgColumn => report.id, { onDelete: "set null" }),
    /** Why it is in the queue, in staff words. Never learner free text. */
    summary: text("summary"),
    /** SLA deadline, from the admin-configurable targets (spec Section 9). */
    dueAt: ts("due_at"),
    assigneeId: uuid("assignee_id").references(() => user.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    safeguardingCaseId: uuid("safeguarding_case_id").references((): AnyPgColumn => safeguardingCase.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("moderation_item_queue_idx").on(t.state, t.severity, t.dueAt),
    index("moderation_item_learner_idx").on(t.learnerId),
    index("moderation_item_assignee_idx").on(t.assigneeId),
    index("moderation_item_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

/** Raised from the Report control on every step, course, project and AI output. */
export const report = pgTable(
  "report",
  {
    id: id(),
    /** Set null on deletion so the report itself survives. */
    reporterId: uuid("reporter_id").references(() => user.id, { onDelete: "set null" }),
    targetType: reportTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id"),
    /** Where the reporter was: `{ courseSlug, stepKey, toolSlug }`. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    reason: reportReasonEnum("reason").notNull(),
    /** Optional free text from the reporter. Never logged. */
    detail: text("detail"),
    status: reportStatusEnum("status").notNull().default("open"),
    /** `someone_in_danger` always opens a case and alerts the DSL. */
    safeguardingCaseId: uuid("safeguarding_case_id").references((): AnyPgColumn => safeguardingCase.id, {
      onDelete: "set null",
    }),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    resolutionNote: text("resolution_note"),
    ...timestamps(),
  },
  (t) => [
    index("report_reporter_idx").on(t.reporterId),
    index("report_status_idx").on(t.status, t.createdAt),
    index("report_target_idx").on(t.targetType, t.targetId),
  ],
);

/**
 * DSL-only. Notes are encrypted with `SAFEGUARDING_ENCRYPTION_KEY`; reading them is break-glass and
 * writes `safeguarding_access_log` and `audit_log`. A case is kept when the account is deleted
 * (`SET NULL`), for as long as the DSL retention policy says.
 */
export const safeguardingCase = pgTable(
  "safeguarding_case",
  {
    id: id(),
    learnerId: uuid("learner_id").references(() => user.id, { onDelete: "set null" }),
    familyId: uuid("family_id").references(() => family.id, { onDelete: "set null" }),
    severity: safeguardingSeverityEnum("severity").notNull(),
    status: safeguardingStatusEnum("status").notNull().default("open"),
    trigger: safeguardingTriggerEnum("trigger").notNull(),
    reportId: uuid("report_id").references((): AnyPgColumn => report.id, { onDelete: "set null" }),
    aiRequestId: uuid("ai_request_id").references((): AnyPgColumn => aiRequest.id, { onDelete: "set null" }),
    /** Ciphertext (`encrypt(…, "safeguarding")`): a JSON array of dated notes. */
    notesEncrypted: text("notes_encrypted"),
    keyVersion: smallint("key_version").notNull().default(1),
    /** When the immediate alert to the DSL was sent. */
    alertedAt: ts("alerted_at"),
    /** Acknowledgement SLA deadline. */
    dueAt: ts("due_at"),
    acknowledgedAt: ts("acknowledged_at"),
    acknowledgedBy: uuid("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    escalatedToDeputyAt: ts("escalated_to_deputy_at"),
    decision: safeguardingDecisionEnum("decision"),
    decidedAt: ts("decided_at"),
    decidedBy: uuid("decided_by").references(() => user.id, { onDelete: "set null" }),
    closedAt: ts("closed_at"),
    /** Seeded or drill cases. Excluded from counts and never alerts anyone. */
    isTest: boolean("is_test").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("safeguarding_case_queue_idx").on(t.status, t.severity, t.createdAt),
    index("safeguarding_case_learner_idx").on(t.learnerId),
    index("safeguarding_case_unacknowledged_idx").on(t.acknowledgedAt, t.dueAt),
  ],
);

/** Every break-glass access to a case, with the reason the staff member gave. */
export const safeguardingAccessLog = pgTable(
  "safeguarding_access_log",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => safeguardingCase.id, { onDelete: "cascade" }),
    /** Restrict: a staff account that has opened a case is deactivated, never deleted. */
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** `view_notes`, `add_note`, `decide`, `export`. */
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("safeguarding_access_log_case_idx").on(t.caseId, t.createdAt),
    index("safeguarding_access_log_staff_idx").on(t.staffUserId),
    check("safeguarding_access_log_reason_present", sql`length(trim(${t.reason})) > 0`),
  ],
);

/** A staff action against an account: warnings, restrictions, locks, bans and their appeals. */
export const enforcementAction = pgTable(
  "enforcement_action",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: enforcementKindEnum("kind").notNull(),
    reason: text("reason").notNull(),
    staffUserId: uuid("staff_user_id").references(() => user.id, { onDelete: "set null" }),
    moderationItemId: uuid("moderation_item_id").references(() => moderationItem.id, {
      onDelete: "set null",
    }),
    safeguardingCaseId: uuid("safeguarding_case_id").references(() => safeguardingCase.id, {
      onDelete: "set null",
    }),
    expiresAt: ts("expires_at"),
    liftedAt: ts("lifted_at"),
    liftedBy: uuid("lifted_by").references(() => user.id, { onDelete: "set null" }),
    appealStatus: appealStatusEnum("appeal_status").notNull().default("none"),
    appealNote: text("appeal_note"),
    appealDecidedBy: uuid("appeal_decided_by").references(() => user.id, { onDelete: "set null" }),
    appealDecidedAt: ts("appeal_decided_at"),
    ...timestamps(),
  },
  (t) => [
    index("enforcement_action_user_idx").on(t.userId, t.createdAt),
    index("enforcement_action_appeal_idx").on(t.appealStatus),
  ],
);

/**
 * APPEND-ONLY (database trigger). Every staff mutation, safeguarding access and change to consent,
 * entitlement or publication. Ids are plain values, not foreign keys, so the log outlives what it
 * describes. `meta` must never contain secrets or learner free text.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorType: actorTypeEnum("actor_type").notNull(),
    /** `user.id`, or null for anonymous and system actors. */
    actorId: uuid("actor_id"),
    /** Job name for a system actor. */
    actorLabel: text("actor_label"),
    /** `area.verb`, from `src/server/authz/actions.ts`. */
    action: text("action").notNull(),
    targetType: text("target_type"),
    /** A uuid, or a natural key such as a setting or flag key. */
    targetId: text("target_id"),
    reason: text("reason"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action, t.createdAt),
  ],
);

/** A parent's (or adult learner's) request to download or delete data. Deletion has a 14-day undo. */
export const dataRequest = pgTable(
  "data_request",
  {
    id: id(),
    kind: dataRequestKindEnum("kind").notNull(),
    status: dataRequestStatusEnum("status").notNull().default("requested"),
    /** Kept (as null ids) after the deletion it describes, as the record that it was done. */
    familyId: uuid("family_id").references(() => family.id, { onDelete: "set null" }),
    /** The child the request is about. Null means the whole family account. */
    learnerId: uuid("learner_id").references(() => user.id, { onDelete: "set null" }),
    requestedBy: uuid("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** For `delete`: nothing is removed before this time, and the request can be cancelled until then. */
    undoUntil: ts("undo_until"),
    /** For `export`: the ZIP in private storage and when the download link stops working. */
    exportStorageKey: text("export_storage_key"),
    exportExpiresAt: ts("export_expires_at"),
    processedAt: ts("processed_at"),
    cancelledAt: ts("cancelled_at"),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    index("data_request_family_idx").on(t.familyId),
    index("data_request_learner_idx").on(t.learnerId),
    index("data_request_due_idx").on(t.kind, t.status, t.undoUntil),
  ],
);

/** Retention periods (spec Section 9), enforced by the nightly job. Editable in Studio. */
export const retentionPolicy = pgTable(
  "retention_policy",
  {
    id: id(),
    /** e.g. `tutor_conversation_default`, `ai_metadata`, `audit_log`, `pending_teen_account`. */
    key: text("key").notNull(),
    days: integer("days").notNull(),
    description: text("description").notNull(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("retention_policy_key_uq").on(t.key),
    check("retention_policy_days_positive", sql`${t.days} > 0`),
  ],
);

export const supportTicket = pgTable(
  "support_ticket",
  {
    id: id(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    familyId: uuid("family_id").references(() => family.id, { onDelete: "set null" }),
    /** For a signed-out adult writing in. Never collected from a learner. */
    contactEmail: text("contact_email"),
    category: text("category"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: supportTicketStatusEnum("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => user.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default(emptyTextArray),
    resolutionNote: text("resolution_note"),
    resolvedAt: ts("resolved_at"),
    ...timestamps(),
  },
  (t) => [
    index("support_ticket_user_idx").on(t.userId),
    index("support_ticket_queue_idx").on(t.status, t.createdAt),
  ],
);
