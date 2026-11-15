import { pgEnum } from "drizzle-orm/pg-core";
import { PATHWAYS, SAFETY_BANDS, STAFF_ROLES, USER_STATUSES } from "../../authz/actor";

/**
 * Postgres enums for closed sets. Sets the spec says must stay open (`user.kind`, consent keys,
 * notification types, feature-flag rules, AI feature keys) are `text` columns instead.
 *
 * An enum type cannot share a name with a table (Postgres creates a row type per table), so an
 * enum that would collide is suffixed, e.g. `staff_role_name` for the `staff_role` table.
 */

// ── Identity ────────────────────────────────────────────────────────────────
/** Values come from `src/server/authz/actor.ts`, the single definition. */
export const userStatusEnum = pgEnum("user_status", USER_STATUSES);
export const safetyBandEnum = pgEnum("safety_band", SAFETY_BANDS);
export const pathwayEnum = pgEnum("pathway", PATHWAYS);
export const staffRoleEnum = pgEnum("staff_role_name", STAFF_ROLES);

export const FAMILY_ROLES = ["parent", "learner"] as const;
export const familyRoleEnum = pgEnum("family_role", FAMILY_ROLES);

/** How far the family's adult has been age-assured (spec 3.1, `AGE_ASSURANCE_MODE`). */
export const AGE_ASSURANCE_LEVELS = [
  "none",
  "parent_email",
  "card_authorisation",
  "paid_subscription",
] as const;
export const ageAssuranceLevelEnum = pgEnum("age_assurance_level", AGE_ASSURANCE_LEVELS);

export const CERTIFICATE_NAME_CHOICES = ["nickname", "first_name"] as const;
export const certificateNameChoiceEnum = pgEnum("certificate_name_choice", CERTIFICATE_NAME_CHOICES);

export const PARENT_LINK_STATUSES = ["pending", "approved", "declined", "expired"] as const;
export const parentLinkStatusEnum = pgEnum("parent_link_status", PARENT_LINK_STATUSES);

export const CONSENT_ACTIONS = ["granted", "revoked"] as const;
export const consentActionEnum = pgEnum("consent_action", CONSENT_ACTIONS);

// ── Content ─────────────────────────────────────────────────────────────────
export const COURSE_ORIGINS = ["hand_made", "ai_radar", "ai_on_demand"] as const;
export const courseOriginEnum = pgEnum("course_origin", COURSE_ORIGINS);

/** Spec Section 6 `CourseStatus`. Used by both `course` and `course_version`. */
export const COURSE_STATUSES = [
  "ai_draft",
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "needs_review",
  "taken_down",
  "retired",
  "declined",
] as const;
export const courseStatusEnum = pgEnum("course_status", COURSE_STATUSES);

export const DIFFICULTIES = ["starter", "builder", "pro"] as const;
export const difficultyEnum = pgEnum("difficulty", DIFFICULTIES);

export const STEP_TYPES = [
  "video",
  "read",
  "setup_guide",
  "external_task",
  "upload",
  "quiz",
  "ethics_checkpoint",
  "reflection",
  "checkpoint",
  "submit",
] as const;
export const stepTypeEnum = pgEnum("step_type", STEP_TYPES);

export const COMPLETION_RULES = [
  "view",
  "quiz_pass",
  "self_tick",
  "setup_acknowledged",
  "upload_approved",
  "evidence_submitted",
  "submit",
] as const;
export const completionRuleEnum = pgEnum("completion_rule", COMPLETION_RULES);

export const QUIZ_QUESTION_KINDS = ["single", "multi", "order", "spot_the_problem"] as const;
export const quizQuestionKindEnum = pgEnum("quiz_question_kind", QUIZ_QUESTION_KINDS);

export const GUIDE_STEP_KINDS = [
  "create_account",
  "verify_email",
  "choose_free_plan",
  "privacy_settings",
  "do_in_tool",
  "export",
  "other",
] as const;
export const guideStepKindEnum = pgEnum("guide_step_kind", GUIDE_STEP_KINDS);

export const ASSET_KINDS = [
  "video",
  "image",
  "audio",
  "captions_vtt",
  "transcript_md",
  "template_zip",
  "dataset_csv",
  "font",
  "guide_screenshot",
] as const;
export const assetKindEnum = pgEnum("asset_kind", ASSET_KINDS);

export const ASSET_LICENCES = ["owned", "cc0", "cc_by", "licensed_platform_only"] as const;
export const assetLicenceEnum = pgEnum("asset_licence", ASSET_LICENCES);

export const TAG_KINDS = ["category", "interest", "career", "skill"] as const;
export const tagKindEnum = pgEnum("tag_kind", TAG_KINDS);

// ── Tools, Radar and course generation ──────────────────────────────────────
export const UNDER18_POLICIES = ["allowed", "parent_consent_required", "parent_operated", "blocked"] as const;
export const under18PolicyEnum = pgEnum("under18_policy", UNDER18_POLICIES);

export const TOOL_STATUSES = ["candidate", "pending_verification", "approved", "blocked", "retired"] as const;
export const toolStatusEnum = pgEnum("tool_status", TOOL_STATUSES);

export const TOOL_APPROVAL_STATUSES = ["pending", "approved", "declined", "revoked"] as const;
export const toolApprovalStatusEnum = pgEnum("tool_approval_status", TOOL_APPROVAL_STATUSES);

/** Spec 6.3 `tools.watch` impact classification. */
export const TOOL_CHANGE_IMPACTS = [
  "age_policy",
  "pricing",
  "interface",
  "api_deprecation",
  "feature_change",
  "outage",
  "none",
] as const;
export const toolChangeImpactEnum = pgEnum("tool_change_impact", TOOL_CHANGE_IMPACTS);

export const TOOL_CHANGE_STATUSES = ["open", "triaged", "resolved", "dismissed"] as const;
export const toolChangeStatusEnum = pgEnum("tool_change_status", TOOL_CHANGE_STATUSES);

export const RADAR_CANDIDATE_STATUSES = [
  "new",
  "enriched",
  "scored",
  "watching",
  "drafting",
  "drafted",
  "dismissed",
] as const;
export const radarCandidateStatusEnum = pgEnum("radar_candidate_status", RADAR_CANDIDATE_STATUSES);

export const COURSE_IDEA_STATUSES = ["idea", "drafting", "drafted", "published", "dismissed"] as const;
export const courseIdeaStatusEnum = pgEnum("course_idea_status", COURSE_IDEA_STATUSES);

export const GENERATION_JOB_KINDS = ["radar_auto", "on_demand"] as const;
export const generationJobKindEnum = pgEnum("generation_job_kind", GENERATION_JOB_KINDS);

/** Shared by `generation_job` and `edit_request`. */
export const GENERATION_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const generationStatusEnum = pgEnum("generation_status", GENERATION_STATUSES);

export const REVIEW_TASK_KINDS = [
  "course_review",
  "guide_review",
  "tool_verification",
  "tool_change",
] as const;
export const reviewTaskKindEnum = pgEnum("review_task_kind", REVIEW_TASK_KINDS);

export const REVIEW_TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export const reviewTaskStatusEnum = pgEnum("review_task_status", REVIEW_TASK_STATUSES);

export const REVIEW_DECISIONS = ["approve", "request_edits", "decline"] as const;
export const reviewDecisionEnum = pgEnum("review_decision_kind", REVIEW_DECISIONS);

export const PUBLISH_SCHEDULE_STATUSES = ["scheduled", "published", "cancelled", "failed"] as const;
export const publishScheduleStatusEnum = pgEnum("publish_schedule_status", PUBLISH_SCHEDULE_STATUSES);

// ── Learning ────────────────────────────────────────────────────────────────
export const ENROLMENT_STATUSES = ["active", "completed", "withdrawn"] as const;
export const enrolmentStatusEnum = pgEnum("enrolment_status", ENROLMENT_STATUSES);

export const STEP_PROGRESS_STATUSES = ["not_started", "in_progress", "completed", "skipped"] as const;
export const stepProgressStatusEnum = pgEnum("step_progress_status", STEP_PROGRESS_STATUSES);

/** Only `private` exists at launch. A gallery is a future addition (spec Section 19): do not add values now. */
export const PROJECT_VISIBILITIES = ["private"] as const;
export const projectVisibilityEnum = pgEnum("project_visibility", PROJECT_VISIBILITIES);

export const PROJECT_STATUSES = ["in_progress", "awaiting_review", "accepted", "blocked"] as const;
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);

export const ARTEFACT_KINDS = ["link", "screenshot", "file", "video"] as const;
export const artefactKindEnum = pgEnum("artefact_kind", ARTEFACT_KINDS);

/**
 * Result of the "does this show a real person?" check (spec 3.4, decision D3).
 * `declared_no_people` is the learner's declaration on a link, which we never fetch.
 */
export const PEOPLE_CHECK_RESULTS = [
  "not_applicable",
  "pending",
  "clear",
  "people_suspected",
  "needs_human",
  "declared_no_people",
] as const;
export const peopleCheckResultEnum = pgEnum("people_check_result", PEOPLE_CHECK_RESULTS);

export const UNLOCK_REQUEST_KINDS = ["paid_course", "pro_course"] as const;
export const unlockRequestKindEnum = pgEnum("unlock_request_kind", UNLOCK_REQUEST_KINDS);

export const UNLOCK_REQUEST_STATUSES = ["pending", "approved", "declined", "cancelled"] as const;
export const unlockRequestStatusEnum = pgEnum("unlock_request_status", UNLOCK_REQUEST_STATUSES);

// ── AI and credits ──────────────────────────────────────────────────────────
export const CREDIT_ENTRY_TYPES = ["reserve", "commit", "release", "grant", "expire"] as const;
export const creditEntryTypeEnum = pgEnum("credit_entry_type", CREDIT_ENTRY_TYPES);

export const AI_REQUEST_OUTCOMES = [
  "ok",
  "refused",
  "blocked_input",
  "blocked_output",
  "crisis",
  "denied",
  "rate_limited",
  "error",
] as const;
export const aiRequestOutcomeEnum = pgEnum("ai_request_outcome", AI_REQUEST_OUTCOMES);

export const AI_MESSAGE_ROLES = ["user", "assistant"] as const;
export const aiMessageRoleEnum = pgEnum("ai_message_role", AI_MESSAGE_ROLES);

// ── Safety ──────────────────────────────────────────────────────────────────
/** Spec Section 9: `pending` → `approved` | `blocked` | `escalated`. */
export const MODERATION_STATES = ["pending", "approved", "blocked", "escalated"] as const;
export const moderationStateEnum = pgEnum("moderation_state", MODERATION_STATES);

/** Spec Section 9 SLA tiers. */
export const MODERATION_SEVERITIES = ["critical", "high", "normal"] as const;
export const moderationSeverityEnum = pgEnum("moderation_severity", MODERATION_SEVERITIES);

export const MODERATION_SOURCES = ["auto", "report", "sample", "submission"] as const;
export const moderationSourceEnum = pgEnum("moderation_source", MODERATION_SOURCES);

export const MODERATION_SUBJECT_TYPES = [
  "artefact",
  "project_version",
  "reflection",
  "step_note",
  "ai_input",
  "ai_output",
  "username",
  "nickname",
  "report",
] as const;
export const moderationSubjectTypeEnum = pgEnum("moderation_subject_type", MODERATION_SUBJECT_TYPES);

export const MODERATION_VERDICTS = ["clean", "flagged", "blocked"] as const;
export const moderationVerdictEnum = pgEnum("moderation_verdict", MODERATION_VERDICTS);

export const REPORT_TARGET_TYPES = ["step", "course", "project", "ai_output", "tool_guide"] as const;
export const reportTargetTypeEnum = pgEnum("report_target_type", REPORT_TARGET_TYPES);

export const REPORT_REASONS = [
  "someone_in_danger",
  "guide_mismatch",
  "unsafe_or_upsetting",
  "wrong_or_broken",
  "ai_said_something_wrong",
  "privacy",
  "other",
] as const;
export const reportReasonEnum = pgEnum("report_reason", REPORT_REASONS);

export const REPORT_STATUSES = ["open", "triaged", "resolved", "dismissed"] as const;
export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);

export const SAFEGUARDING_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const safeguardingSeverityEnum = pgEnum("safeguarding_severity", SAFEGUARDING_SEVERITIES);

export const SAFEGUARDING_STATUSES = ["open", "acknowledged", "in_progress", "escalated", "closed"] as const;
export const safeguardingStatusEnum = pgEnum("safeguarding_status", SAFEGUARDING_STATUSES);

/** Spec Section 9 DSL workflow triggers, plus decision D3 (possibly illegal media). */
export const SAFEGUARDING_TRIGGERS = [
  "crisis_classifier",
  "disclosure",
  "danger_report",
  "moderator_escalation",
  "illegal_media",
  "manual",
] as const;
export const safeguardingTriggerEnum = pgEnum("safeguarding_trigger", SAFEGUARDING_TRIGGERS);

export const SAFEGUARDING_DECISIONS = [
  "no_further_action",
  "parent_contacted",
  "external_referral",
  "account_restricted",
  "account_closed",
] as const;
export const safeguardingDecisionEnum = pgEnum("safeguarding_decision", SAFEGUARDING_DECISIONS);

export const ENFORCEMENT_KINDS = [
  "warning",
  "coach_restricted",
  "paused",
  "locked",
  "unlocked",
  "banned",
  "unbanned",
  "account_closed",
  "content_removed",
] as const;
export const enforcementKindEnum = pgEnum("enforcement_kind", ENFORCEMENT_KINDS);

export const APPEAL_STATUSES = ["none", "open", "upheld", "rejected"] as const;
export const appealStatusEnum = pgEnum("appeal_status", APPEAL_STATUSES);

/** Mirrors `Actor["type"]`. */
export const ACTOR_TYPES = ["anonymous", "system", "learner", "parent", "staff"] as const;
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);

export const DATA_REQUEST_KINDS = ["export", "delete"] as const;
export const dataRequestKindEnum = pgEnum("data_request_kind", DATA_REQUEST_KINDS);

export const DATA_REQUEST_STATUSES = [
  "requested",
  "processing",
  "ready",
  "completed",
  "cancelled",
  "failed",
] as const;
export const dataRequestStatusEnum = pgEnum("data_request_status", DATA_REQUEST_STATUSES);

export const SUPPORT_TICKET_STATUSES = ["open", "waiting", "resolved", "closed"] as const;
export const supportTicketStatusEnum = pgEnum("support_ticket_status", SUPPORT_TICKET_STATUSES);

// ── Billing and CMS ─────────────────────────────────────────────────────────
export const BILLING_INTERVALS = ["month", "year"] as const;
export const billingIntervalEnum = pgEnum("billing_interval", BILLING_INTERVALS);

export const STRIPE_EVENT_STATUSES = ["received", "processed", "failed", "ignored"] as const;
export const stripeEventStatusEnum = pgEnum("stripe_event_status", STRIPE_EVENT_STATUSES);

/** Spec Section 11 promo codes. */
export const PROMO_KINDS = [
  "percent_off",
  "amount_off",
  "free_period",
  "credit_grant",
  "plan_unlock",
] as const;
export const promoKindEnum = pgEnum("promo_kind", PROMO_KINDS);

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms"] as const;
export const notificationChannelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNELS);

export const PAGE_KINDS = ["marketing", "legal", "help", "snippet"] as const;
export const pageKindEnum = pgEnum("page_kind", PAGE_KINDS);

/** Legal pages have adult and teen versions (spec Section 5). */
export const PAGE_AUDIENCES = ["everyone", "adult", "teen"] as const;
export const pageAudienceEnum = pgEnum("page_audience", PAGE_AUDIENCES);

export const PAGE_VERSION_STATUSES = ["draft", "published", "archived"] as const;
export const pageVersionStatusEnum = pgEnum("page_version_status", PAGE_VERSION_STATUSES);

// ── System ──────────────────────────────────────────────────────────────────
export const JOB_RUN_STATUSES = ["running", "succeeded", "failed", "skipped"] as const;
export const jobRunStatusEnum = pgEnum("job_run_status", JOB_RUN_STATUSES);
