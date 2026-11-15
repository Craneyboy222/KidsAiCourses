import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
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
import { course, step } from "./content";
import { aiMessageRoleEnum, aiRequestOutcomeEnum, creditEntryTypeEnum } from "./enums";
import { family, user } from "./identity";
import { enrolment } from "./learning";
import { safeguardingCase } from "./safety";

/**
 * AI Coach, course drafting and credits (spec Section 8, 12; decision D1).
 *
 * Money: plan and job costs are whole pence. A single model call costs a fraction of a penny, so
 * `ai_request` and `spend_counter` count in MILLIPENCE (1,000 millipence = 1p) to keep the daily
 * spend cap accurate. Columns say so in their names.
 */

/**
 * Model providers approved as data processors (decision D1). A provider cannot be enabled until
 * its approval and a DPA reference are recorded: the check constraint makes that impossible to skip.
 */
export const aiProcessor = pgTable(
  "ai_processor",
  {
    id: id(),
    /** A UNIQUE constraint (not just an index) so that `model_route.provider_key` can reference it. */
    providerKey: text("provider_key").notNull().unique("ai_processor_provider_key_uq"),
    name: text("name").notNull(),
    /** What it is used for, e.g. "Coach replies", "Course drafting". */
    purpose: text("purpose").notNull(),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    dpaReference: text("dpa_reference"),
    region: text("region"),
    enabled: boolean("enabled").notNull().default(false),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    check(
      "ai_processor_enabled_needs_approval",
      sql`NOT ${t.enabled} OR (${t.approvedAt} IS NOT NULL AND ${t.dpaReference} IS NOT NULL AND length(trim(${t.dpaReference})) > 0)`,
    ),
  ],
);

/** Alias → provider and model, with ordered fallbacks (spec Section 8, step 8). */
export const modelRoute = pgTable(
  "model_route",
  {
    id: id(),
    /** e.g. `coach.default`, `draft.course`, `radar.extract`. */
    alias: text("alias").notNull(),
    /** 0 is tried first; higher numbers are fallbacks. */
    priority: integer("priority").notNull().default(0),
    providerKey: text("provider_key")
      .notNull()
      .references(() => aiProcessor.providerKey, { onDelete: "restrict", onUpdate: "cascade" }),
    model: text("model").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Timeout, temperature, max output tokens, zero-data-retention flags. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    inputPencePerMillionTokens: integer("input_pence_per_million_tokens").notNull().default(0),
    outputPencePerMillionTokens: integer("output_pence_per_million_tokens").notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("model_route_alias_priority_uq").on(t.alias, t.priority)],
);

/** What a Coach action costs in credits. Editable in Studio. */
export const creditPrice = pgTable(
  "credit_price",
  {
    id: id(),
    /** e.g. `tutor.message`. */
    key: text("key").notNull(),
    credits: integer("credits").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("credit_price_key_uq").on(t.key),
    check("credit_price_credits_nonneg", sql`${t.credits} >= 0`),
  ],
);

/** One Coach thread on one step. Parents see only counts, `topics` and safety notices, never the messages. */
export const tutorConversation = pgTable(
  "tutor_conversation",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id").references((): AnyPgColumn => enrolment.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references((): AnyPgColumn => course.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references((): AnyPgColumn => step.id, { onDelete: "set null" }),
    messageCount: integer("message_count").notNull().default(0),
    /** Coarse topic labels kept after the content is deleted. */
    topics: text("topics").array().notNull().default(emptyTextArray),
    /** Flagged conversations follow the safeguarding retention schedule and are DSL-only. */
    flagged: boolean("flagged").notNull().default(false),
    safeguardingCaseId: uuid("safeguarding_case_id").references((): AnyPgColumn => safeguardingCase.id, {
      onDelete: "set null",
    }),
    lastMessageAt: ts("last_message_at"),
    /** When the nightly sweep removed the message content. */
    contentDeletedAt: ts("content_deleted_at"),
    ...timestamps(),
  },
  (t) => [
    index("tutor_conversation_learner_idx").on(t.learnerId, t.lastMessageAt),
    index("tutor_conversation_step_idx").on(t.stepId),
  ],
);

/** Metadata for every model call: Coach, staff preview and drafting. Never holds message text. */
export const aiRequest = pgTable(
  "ai_request",
  {
    id: id(),
    /** The learner, or the staff member for preview and drafting. Null for scheduled jobs. */
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").references(() => family.id, { onDelete: "set null" }),
    /** Open text: `tutor`, `draft_course`, `edit_request`, `radar_extract`, `radar_score`, `moderation`. */
    feature: text("feature").notNull(),
    conversationId: uuid("conversation_id").references(() => tutorConversation.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references((): AnyPgColumn => course.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references((): AnyPgColumn => step.id, { onDelete: "set null" }),
    routeAlias: text("route_alias"),
    providerKey: text("provider_key"),
    model: text("model"),
    /** e.g. `coach.v1`. */
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMillipence: integer("cost_millipence").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    outcome: aiRequestOutcomeEnum("outcome").notNull(),
    /** Category labels and scores only, never the text that was moderated. */
    moderation: jsonb("moderation").$type<Record<string, unknown>>(),
    /** Staff preview runs are excluded from learner analytics. */
    isPreview: boolean("is_preview").notNull().default(false),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_request_user_idx").on(t.userId, t.createdAt),
    index("ai_request_feature_created_idx").on(t.feature, t.createdAt),
    index("ai_request_created_idx").on(t.createdAt),
  ],
);

/**
 * Coach message content, encrypted with `CONTENT_ENCRYPTION_KEY` (`encrypt(…, "content")`).
 * Persisted only where consent and retention allow; swept nightly once `expires_at` has passed.
 */
export const aiMessage = pgTable(
  "ai_message",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => tutorConversation.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    aiRequestId: uuid("ai_request_id").references(() => aiRequest.id, { onDelete: "set null" }),
    role: aiMessageRoleEnum("role").notNull(),
    /** Ciphertext in the `v1.<iv>.<tag>.<body>` format of `@/server/crypto`. */
    contentEncrypted: text("content_encrypted").notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    /** Personal data was stripped before storing. */
    redacted: boolean("redacted").notNull().default(false),
    flagged: boolean("flagged").notNull().default(false),
    /** 30 days by default, 90 with "resume chat" consent; flagged content follows the safeguarding schedule. */
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_message_conversation_idx").on(t.conversationId, t.createdAt),
    index("ai_message_learner_idx").on(t.learnerId),
    index("ai_message_expires_idx").on(t.expiresAt),
  ],
);

/**
 * APPEND-ONLY (database trigger). Every movement of Coach credits. `amount` is always positive;
 * `entry_type` says what it does: `grant` adds to the period, `reserve` holds credits before a
 * call, `commit` spends a reservation, `release` returns one, `expire` removes what is left at
 * period end. Ids are not foreign keys so the ledger never blocks account deletion.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    learnerId: uuid("learner_id").notNull(),
    familyId: uuid("family_id"),
    entryType: creditEntryTypeEnum("entry_type").notNull(),
    amount: integer("amount").notNull(),
    /** Calendar month on Free (`2026-11`), subscription anniversary period otherwise (`2026-11-15`). */
    periodKey: text("period_key").notNull(),
    /** Makes a retried request a no-op. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** For `commit` and `release`: the `reserve` entry being settled. */
    reservationId: uuid("reservation_id"),
    aiRequestId: uuid("ai_request_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_ledger_idempotency_uq").on(t.idempotencyKey),
    index("credit_ledger_learner_period_idx").on(t.learnerId, t.periodKey),
    index("credit_ledger_reservation_idx").on(t.reservationId),
    check("credit_ledger_amount_positive", sql`${t.amount} > 0`),
  ],
);

/**
 * Running totals per learner and period. Updated under `SELECT … FOR UPDATE` in the same
 * transaction as the ledger insert. The check constraint is the last line of defence against
 * overspending under concurrency.
 */
export const creditBalance = pgTable(
  "credit_balance",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    granted: integer("granted").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    spent: integer("spent").notNull().default(0),
    expired: integer("expired").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("credit_balance_learner_period_uq").on(t.learnerId, t.periodKey),
    check(
      "credit_balance_nonneg",
      sql`${t.granted} >= 0 AND ${t.reserved} >= 0 AND ${t.spent} >= 0 AND ${t.expired} >= 0`,
    ),
    check("credit_balance_never_overspent", sql`${t.reserved} + ${t.spent} + ${t.expired} <= ${t.granted}`),
  ],
);

/** AI spend per London day and feature, for the daily cap, the 80% alert and the kill switch. */
export const spendCounter = pgTable(
  "spend_counter",
  {
    id: id(),
    /** `yyyy-MM-dd` in Europe/London. */
    day: date("day", { mode: "string" }).notNull(),
    /** Feature key, or `all` for the global total. */
    feature: text("feature").notNull(),
    costMillipence: bigint("cost_millipence", { mode: "number" }).notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
    alertedAt: ts("alerted_at"),
    /** When the kill switch tripped at 100% of the cap. */
    trippedAt: ts("tripped_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("spend_counter_day_feature_uq").on(t.day, t.feature),
    check("spend_counter_nonneg", sql`${t.costMillipence} >= 0 AND ${t.requestCount} >= 0`),
  ],
);

/** Fixed-window counters for our own rate limits (per user, family and IP). Auth routes use `auth_rate_limit`. */
export const rateLimitBucket = pgTable(
  "rate_limit_bucket",
  {
    id: id(),
    /** e.g. `ai.chat:user:<uuid>`. IP addresses are hashed before they are used in a key. */
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("rate_limit_bucket_key_window_uq").on(t.key, t.windowStart),
    index("rate_limit_bucket_expires_idx").on(t.expiresAt),
  ],
);
