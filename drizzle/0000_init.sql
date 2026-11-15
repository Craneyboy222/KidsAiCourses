CREATE TYPE "public"."actor_type" AS ENUM('anonymous', 'system', 'learner', 'parent', 'staff');--> statement-breakpoint
CREATE TYPE "public"."age_assurance_level" AS ENUM('none', 'parent_email', 'card_authorisation', 'paid_subscription');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_request_outcome" AS ENUM('ok', 'refused', 'blocked_input', 'blocked_output', 'crisis', 'denied', 'rate_limited', 'error');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('none', 'open', 'upheld', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."artefact_kind" AS ENUM('link', 'screenshot', 'file', 'video');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('video', 'image', 'audio', 'captions_vtt', 'transcript_md', 'template_zip', 'dataset_csv', 'font', 'guide_screenshot');--> statement-breakpoint
CREATE TYPE "public"."asset_licence" AS ENUM('owned', 'cc0', 'cc_by', 'licensed_platform_only');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."certificate_name_choice" AS ENUM('nickname', 'first_name');--> statement-breakpoint
CREATE TYPE "public"."completion_rule" AS ENUM('view', 'quiz_pass', 'self_tick', 'setup_acknowledged', 'upload_approved', 'evidence_submitted', 'submit');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."course_idea_status" AS ENUM('idea', 'drafting', 'drafted', 'published', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."course_origin" AS ENUM('hand_made', 'ai_radar', 'ai_on_demand');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('ai_draft', 'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'needs_review', 'taken_down', 'retired', 'declined');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_type" AS ENUM('reserve', 'commit', 'release', 'grant', 'expire');--> statement-breakpoint
CREATE TYPE "public"."data_request_kind" AS ENUM('export', 'delete');--> statement-breakpoint
CREATE TYPE "public"."data_request_status" AS ENUM('requested', 'processing', 'ready', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('starter', 'builder', 'pro');--> statement-breakpoint
CREATE TYPE "public"."enforcement_kind" AS ENUM('warning', 'coach_restricted', 'paused', 'locked', 'unlocked', 'banned', 'unbanned', 'account_closed', 'content_removed');--> statement-breakpoint
CREATE TYPE "public"."enrolment_status" AS ENUM('active', 'completed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."family_role" AS ENUM('parent', 'learner');--> statement-breakpoint
CREATE TYPE "public"."generation_job_kind" AS ENUM('radar_auto', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."guide_step_kind" AS ENUM('create_account', 'verify_email', 'choose_free_plan', 'privacy_settings', 'do_in_tool', 'export', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."moderation_severity" AS ENUM('critical', 'high', 'normal');--> statement-breakpoint
CREATE TYPE "public"."moderation_source" AS ENUM('auto', 'report', 'sample', 'submission');--> statement-breakpoint
CREATE TYPE "public"."moderation_state" AS ENUM('pending', 'approved', 'blocked', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."moderation_subject_type" AS ENUM('artefact', 'project_version', 'reflection', 'step_note', 'ai_input', 'ai_output', 'username', 'nickname', 'report');--> statement-breakpoint
CREATE TYPE "public"."moderation_verdict" AS ENUM('clean', 'flagged', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."page_audience" AS ENUM('everyone', 'adult', 'teen');--> statement-breakpoint
CREATE TYPE "public"."page_kind" AS ENUM('marketing', 'legal', 'help', 'snippet');--> statement-breakpoint
CREATE TYPE "public"."page_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."parent_link_status" AS ENUM('pending', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."pathway" AS ENUM('ks3', 'ks4', 'sixth_form');--> statement-breakpoint
CREATE TYPE "public"."people_check_result" AS ENUM('not_applicable', 'pending', 'clear', 'people_suspected', 'needs_human', 'declared_no_people');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('in_progress', 'awaiting_review', 'accepted', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('percent_off', 'amount_off', 'free_period', 'credit_grant', 'plan_unlock');--> statement-breakpoint
CREATE TYPE "public"."publish_schedule_status" AS ENUM('scheduled', 'published', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."quiz_question_kind" AS ENUM('single', 'multi', 'order', 'spot_the_problem');--> statement-breakpoint
CREATE TYPE "public"."radar_candidate_status" AS ENUM('new', 'enriched', 'scored', 'watching', 'drafting', 'drafted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('someone_in_danger', 'guide_mismatch', 'unsafe_or_upsetting', 'wrong_or_broken', 'ai_said_something_wrong', 'privacy', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'triaged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('step', 'course', 'project', 'ai_output', 'tool_guide');--> statement-breakpoint
CREATE TYPE "public"."review_decision_kind" AS ENUM('approve', 'request_edits', 'decline');--> statement-breakpoint
CREATE TYPE "public"."review_task_kind" AS ENUM('course_review', 'guide_review', 'tool_verification', 'tool_change');--> statement-breakpoint
CREATE TYPE "public"."review_task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_decision" AS ENUM('no_further_action', 'parent_contacted', 'external_referral', 'account_restricted', 'account_closed');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_status" AS ENUM('open', 'acknowledged', 'in_progress', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_trigger" AS ENUM('crisis_classifier', 'disclosure', 'danger_report', 'moderator_escalation', 'illegal_media', 'manual');--> statement-breakpoint
CREATE TYPE "public"."safety_band" AS ENUM('teen_13_15', 'teen_16_17', 'adult_18');--> statement-breakpoint
CREATE TYPE "public"."staff_role_name" AS ENUM('editor', 'reviewer', 'safety_reviewer', 'moderator', 'dsl', 'support', 'admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."step_progress_status" AS ENUM('not_started', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('video', 'read', 'setup_guide', 'external_task', 'upload', 'quiz', 'ethics_checkpoint', 'reflection', 'checkpoint', 'submit');--> statement-breakpoint
CREATE TYPE "public"."stripe_event_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'waiting', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('category', 'interest', 'career', 'skill');--> statement-breakpoint
CREATE TYPE "public"."tool_approval_status" AS ENUM('pending', 'approved', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."tool_change_impact" AS ENUM('age_policy', 'pricing', 'interface', 'api_deprecation', 'feature_change', 'outage', 'none');--> statement-breakpoint
CREATE TYPE "public"."tool_change_status" AS ENUM('open', 'triaged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."tool_status" AS ENUM('candidate', 'pending_verification', 'approved', 'blocked', 'retired');--> statement-breakpoint
CREATE TYPE "public"."under18_policy" AS ENUM('allowed', 'parent_consent_required', 'parent_operated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."unlock_request_kind" AS ENUM('paid_course', 'pro_course');--> statement-breakpoint
CREATE TYPE "public"."unlock_request_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_parent', 'active', 'paused', 'locked', 'banned', 'pending_deletion', 'deleted');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"required" boolean NOT NULL,
	"default_by_band" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"family_id" uuid,
	"consent_key" text NOT NULL,
	"consent_version" integer NOT NULL,
	"action" "consent_action" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"method" text DEFAULT 'consent_centre' NOT NULL,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"age_assurance_level" "age_assurance_level" DEFAULT 'none' NOT NULL,
	"age_assured_at" timestamp with time zone,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "family_role" NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"birth_month" smallint NOT NULL,
	"birth_year" smallint NOT NULL,
	"safety_band" "safety_band" NOT NULL,
	"safety_band_checked_at" timestamp with time zone,
	"pathway" "pathway" NOT NULL,
	"nickname" text NOT NULL,
	"first_name" text,
	"avatar_seed" text NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"a11y" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"certificate_name_choice" "certificate_name_choice" DEFAULT 'nickname' NOT NULL,
	"independence_offered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_profile_birth_month_range" CHECK ("learner_profile"."birth_month" BETWEEN 1 AND 12),
	CONSTRAINT "learner_profile_birth_year_range" CHECK ("learner_profile"."birth_year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "parent_control" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"daily_minutes_cap" integer,
	"quiet_start_min" smallint,
	"quiet_end_min" smallint,
	"blocked_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"blocked_course_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"require_approval_for_pro" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_control_cap_range" CHECK ("parent_control"."daily_minutes_cap" IS NULL OR "parent_control"."daily_minutes_cap" BETWEEN 1 AND 1440),
	CONSTRAINT "parent_control_quiet_range" CHECK (("parent_control"."quiet_start_min" IS NULL AND "parent_control"."quiet_end_min" IS NULL) OR ("parent_control"."quiet_start_min" BETWEEN 0 AND 1439 AND "parent_control"."quiet_end_min" BETWEEN 0 AND 1439))
);
--> statement-breakpoint
CREATE TABLE "parent_link_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"parent_email" "citext" NOT NULL,
	"token_hash" text NOT NULL,
	"status" "parent_link_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"send_count" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone,
	"two_factor_verified" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role_name" NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"day" date NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_day_seconds_nonneg" CHECK ("usage_day"."seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" "citext",
	"kind" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"failed_signin_count" integer DEFAULT 0 NOT NULL,
	"failed_signin_window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_placeholder_email_learner_only" CHECK ("user"."email" NOT LIKE '%@learner.invalid' OR "user"."kind" = 'learner'),
	CONSTRAINT "user_failed_signin_count_nonneg" CHECK ("user"."failed_signin_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"licence" "asset_licence" NOT NULL,
	"attribution" text,
	"alt_text" text,
	"duration_sec" integer,
	"mime" text,
	"size_bytes" bigint,
	"sha256" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"origin" "course_origin" DEFAULT 'hand_made' NOT NULL,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"working_version_id" uuid,
	"source_candidate_id" uuid,
	"source_idea_id" uuid,
	"generation_job_id" uuid,
	"tagline" text,
	"what_you_make" text,
	"category" text,
	"difficulty" "difficulty",
	"pathways" "pathway"[] DEFAULT '{}'::pathway[] NOT NULL,
	"min_age" smallint DEFAULT 13 NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"estimated_minutes" integer,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"careers" text[] DEFAULT '{}'::text[] NOT NULL,
	"tool_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"safeguarding_sensitive" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"guides_last_verified_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"taken_down_at" timestamp with time zone,
	"taken_down_reason" text,
	"enrolment_count" integer DEFAULT 0 NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("course"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("course"."tagline", '')), 'B') || setweight(to_tsvector('english', coalesce("course"."what_you_make", '')), 'C')) STORED,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_min_age_range" CHECK ("course"."min_age" BETWEEN 13 AND 18)
);
--> statement-breakpoint
CREATE TABLE "course_tool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"fallback_tool_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"semver" text DEFAULT '0.1.0' NOT NULL,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"validation" jsonb,
	"editor_notes" text,
	"verify_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" "course_origin" DEFAULT 'hand_made' NOT NULL,
	"generation_job_id" uuid,
	"source_candidate_id" uuid,
	"source_idea_id" uuid,
	"generation_meta" jsonb,
	"parent_version_id" uuid,
	"change_summary" text,
	"created_by" uuid,
	"last_edited_by" uuid,
	"materialised_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_version_revision_positive" CHECK ("course_version"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"pass_mark" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_pass_mark_range" CHECK ("quiz"."pass_mark" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "quiz_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "quiz_question_kind" NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"levels" jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" "step_type" NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"body" text,
	"asset_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completion_rule" "completion_rule" NOT NULL,
	"completion_threshold" integer,
	"coach_context" text,
	"hints" text[] DEFAULT '{}'::text[] NOT NULL,
	"tool_slug" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "tag_kind" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_version_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_reason" text,
	"stale_marked_at" timestamp with time zone,
	"waiver" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_guide_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_guide_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "guide_step_kind" NOT NULL,
	"body" text NOT NULL,
	"screenshot_asset_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_idea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"min_age" smallint DEFAULT 13 NOT NULL,
	"pathways" "pathway"[] DEFAULT '{}'::pathway[] NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"watch_note" text,
	"careers" text,
	"suggested_for_launch" boolean DEFAULT false NOT NULL,
	"status" "course_idea_status" DEFAULT 'idea' NOT NULL,
	"course_id" uuid,
	"dismissed_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_idea_min_age_range" CHECK ("course_idea"."min_age" BETWEEN 13 AND 18)
);
--> statement-breakpoint
CREATE TABLE "edit_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"result_version_id" uuid,
	"instructions" text NOT NULL,
	"scope" jsonb DEFAULT '{"whole":true}'::jsonb NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"cost_pence" integer DEFAULT 0 NOT NULL,
	"model" text,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "generation_job_kind" NOT NULL,
	"trigger" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"cost_pence" integer DEFAULT 0 NOT NULL,
	"model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"course_id" uuid,
	"result_version_id" uuid,
	"candidate_id" uuid,
	"idea_id" uuid,
	"error" text,
	"idempotency_key" text,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_job_cost_nonneg" CHECK ("generation_job"."cost_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "preview_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"course_version_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"status" "publish_schedule_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_by" uuid,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vendor_domain" text,
	"canonical_url" text,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer,
	"score_breakdown" jsonb,
	"score_explanation" text,
	"scored_at" timestamp with time zone,
	"age_restricted" boolean DEFAULT false NOT NULL,
	"proposed_under18_policy" "under18_policy",
	"status" "radar_candidate_status" DEFAULT 'new' NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"tool_id" uuid,
	"enriched_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismissed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_candidate_score_range" CHECK ("radar_candidate"."score" IS NULL OR "radar_candidate"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "radar_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"text" text,
	"published_at" timestamp with time zone,
	"raw" jsonb,
	"content_hash" text NOT NULL,
	"normalised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_mention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"requires_owner_approval" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_source_enabled_needs_approval" CHECK (NOT ("radar_source"."enabled" AND "radar_source"."requires_owner_approval") OR "radar_source"."approved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "review_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"review_task_id" uuid,
	"author_id" uuid,
	"anchor" jsonb,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_task_id" uuid,
	"course_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision_kind" NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checklist_version" text,
	"tool_claims_checked" boolean DEFAULT false NOT NULL,
	"waivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_was_last_editor" boolean DEFAULT false NOT NULL,
	"reviewer_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"safeguarding_sensitive_confirmed" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_task_kind" NOT NULL,
	"status" "review_task_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"course_id" uuid,
	"course_version_id" uuid,
	"tool_id" uuid,
	"tool_guide_key" text,
	"tool_change_event_id" uuid,
	"report_id" uuid,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"vendor_domain" text,
	"official_url" text,
	"allowed_url_prefixes" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost" text,
	"free_tier" text,
	"min_age" smallint,
	"consent_rule" text,
	"under18_policy" "under18_policy",
	"parent_operated_allowed_recorded_by" uuid,
	"parent_operated_allowed_recorded_at" timestamp with time zone,
	"notes" text,
	"status" "tool_status" DEFAULT 'candidate' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watch_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_candidate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_min_age_range" CHECK ("tool"."min_age" IS NULL OR "tool"."min_age" BETWEEN 0 AND 21),
	CONSTRAINT "tool_parent_operated_recorded" CHECK ("tool"."under18_policy" IS DISTINCT FROM 'parent_operated' OR "tool"."parent_operated_allowed_recorded_at" IS NOT NULL),
	CONSTRAINT "tool_approved_has_policy" CHECK ("tool"."status" <> 'approved' OR "tool"."under18_policy" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "tool_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"status" "tool_approval_status" DEFAULT 'pending' NOT NULL,
	"policy_at_decision" "under18_policy",
	"parent_operated_confirmed" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_change_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"page_url" text NOT NULL,
	"page_kind" text,
	"old_hash" text,
	"new_hash" text,
	"diff_summary" text,
	"impact" "tool_change_impact" DEFAULT 'none' NOT NULL,
	"status" "tool_change_status" DEFAULT 'open' NOT NULL,
	"blocks_start" boolean DEFAULT false NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triaged_by" uuid,
	"triaged_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_substitute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"substitute_tool_id" uuid NOT NULL,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_substitute_not_self" CHECK ("tool_substitute"."tool_id" <> "tool_substitute"."substitute_tool_id")
);
--> statement-breakpoint
CREATE TABLE "artefact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"project_id" uuid,
	"project_version_id" uuid,
	"step_id" uuid,
	"kind" "artefact_kind" NOT NULL,
	"url" text,
	"storage_key" text,
	"sha256" text,
	"size_bytes" bigint,
	"mime" text,
	"moderation_state" "moderation_state" DEFAULT 'pending' NOT NULL,
	"people_check" "people_check_result" DEFAULT 'pending' NOT NULL,
	"people_check_provider" text,
	"quarantined" boolean DEFAULT false NOT NULL,
	"deleted_from_storage_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artefact_has_location" CHECK ("artefact"."url" IS NOT NULL OR "artefact"."storage_key" IS NOT NULL OR "artefact"."deleted_from_storage_at" IS NOT NULL),
	CONSTRAINT "artefact_link_has_url" CHECK ("artefact"."kind" <> 'link' OR "artefact"."url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"project_id" uuid,
	"verify_code" text NOT NULL,
	"display_name" text NOT NULL,
	"course_title" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrolment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"course_version_id" uuid NOT NULL,
	"current_step_id" uuid,
	"status" "enrolment_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"status" "project_status" DEFAULT 'in_progress' NOT NULL,
	"current_version_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"step_id" uuid,
	"note" text,
	"self_check" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moderation_state" "moderation_state" DEFAULT 'pending' NOT NULL,
	"sampled" boolean DEFAULT false NOT NULL,
	"auto_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"step_id" uuid,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"answers" jsonb NOT NULL,
	"score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempt_score_range" CHECK ("quiz_attempt"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "reflection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"body" text NOT NULL,
	"moderation_state" "moderation_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"status" "step_progress_status" DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unlock_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "unlock_request_kind" NOT NULL,
	"status" "unlock_request_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"ai_request_id" uuid,
	"role" "ai_message_role" NOT NULL,
	"content_encrypted" text NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"redacted" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_processor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"dpa_reference" text,
	"region" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_processor_provider_key_uq" UNIQUE("provider_key"),
	CONSTRAINT "ai_processor_enabled_needs_approval" CHECK (NOT "ai_processor"."enabled" OR ("ai_processor"."approved_at" IS NOT NULL AND "ai_processor"."dpa_reference" IS NOT NULL AND length(trim("ai_processor"."dpa_reference")) > 0))
);
--> statement-breakpoint
CREATE TABLE "ai_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"family_id" uuid,
	"feature" text NOT NULL,
	"conversation_id" uuid,
	"course_id" uuid,
	"step_id" uuid,
	"route_alias" text,
	"provider_key" text,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_millipence" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"outcome" "ai_request_outcome" NOT NULL,
	"moderation" jsonb,
	"is_preview" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"granted" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"spent" integer DEFAULT 0 NOT NULL,
	"expired" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balance_nonneg" CHECK ("credit_balance"."granted" >= 0 AND "credit_balance"."reserved" >= 0 AND "credit_balance"."spent" >= 0 AND "credit_balance"."expired" >= 0),
	CONSTRAINT "credit_balance_never_overspent" CHECK ("credit_balance"."reserved" + "credit_balance"."spent" + "credit_balance"."expired" <= "credit_balance"."granted")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"family_id" uuid,
	"entry_type" "credit_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"period_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reservation_id" uuid,
	"ai_request_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_amount_positive" CHECK ("credit_ledger"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"credits" integer NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_price_credits_nonneg" CHECK ("credit_price"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"provider_key" text NOT NULL,
	"model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_pence_per_million_tokens" integer DEFAULT 0 NOT NULL,
	"output_pence_per_million_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"feature" text NOT NULL,
	"cost_millipence" bigint DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"tripped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_counter_nonneg" CHECK ("spend_counter"."cost_millipence" >= 0 AND "spend_counter"."request_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tutor_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"enrolment_id" uuid,
	"course_id" uuid,
	"step_id" uuid,
	"message_count" integer DEFAULT 0 NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"safeguarding_case_id" uuid,
	"last_message_at" timestamp with time zone,
	"content_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"reason" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "data_request_kind" NOT NULL,
	"status" "data_request_status" DEFAULT 'requested' NOT NULL,
	"family_id" uuid,
	"learner_id" uuid,
	"requested_by" uuid,
	"undo_until" timestamp with time zone,
	"export_storage_key" text,
	"export_expires_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enforcement_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "enforcement_kind" NOT NULL,
	"reason" text NOT NULL,
	"staff_user_id" uuid,
	"moderation_item_id" uuid,
	"safeguarding_case_id" uuid,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"appeal_status" "appeal_status" DEFAULT 'none' NOT NULL,
	"appeal_note" text,
	"appeal_decided_by" uuid,
	"appeal_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "moderation_subject_type" NOT NULL,
	"subject_id" uuid,
	"learner_id" uuid,
	"provider" text NOT NULL,
	"verdict" "moderation_verdict" NOT NULL,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" "moderation_severity",
	"moderation_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" "moderation_state" DEFAULT 'pending' NOT NULL,
	"severity" "moderation_severity" DEFAULT 'normal' NOT NULL,
	"source" "moderation_source" NOT NULL,
	"subject_type" "moderation_subject_type" NOT NULL,
	"subject_id" uuid,
	"learner_id" uuid,
	"report_id" uuid,
	"summary" text,
	"due_at" timestamp with time zone,
	"assignee_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"safeguarding_case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"safeguarding_case_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"days" integer NOT NULL,
	"description" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policy_days_positive" CHECK ("retention_policy"."days" > 0)
);
--> statement-breakpoint
CREATE TABLE "safeguarding_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safeguarding_access_log_reason_present" CHECK (length(trim("safeguarding_access_log"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "safeguarding_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid,
	"family_id" uuid,
	"severity" "safeguarding_severity" NOT NULL,
	"status" "safeguarding_status" DEFAULT 'open' NOT NULL,
	"trigger" "safeguarding_trigger" NOT NULL,
	"report_id" uuid,
	"ai_request_id" uuid,
	"notes_encrypted" text,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"alerted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"escalated_to_deputy_at" timestamp with time zone,
	"decision" "safeguarding_decision",
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"closed_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"family_id" uuid,
	"contact_email" text,
	"category" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "support_ticket_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"deliver_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "page_kind" NOT NULL,
	"audience" "page_audience" DEFAULT 'everyone' NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "page_version_status" DEFAULT 'draft' NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly_pence" integer DEFAULT 0 NOT NULL,
	"price_annual_pence" integer DEFAULT 0 NOT NULL,
	"founding_monthly_pence" integer,
	"founding_annual_pence" integer,
	"founding_lock_months" integer,
	"seats" integer NOT NULL,
	"extra_seat_price_pence" integer,
	"coach_credits" integer DEFAULT 0 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_product_id" text,
	"stripe_price_monthly_id" text,
	"stripe_price_annual_id" text,
	"stripe_price_founding_monthly_id" text,
	"stripe_price_founding_annual_id" text,
	"stripe_price_extra_seat_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_nonneg" CHECK ("plan"."price_monthly_pence" >= 0 AND "plan"."price_annual_pence" >= 0 AND "plan"."seats" >= 1 AND "plan"."coach_credits" >= 0 AND "plan"."trial_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promo_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "citext" NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"percent_off" smallint,
	"amount_off_pence" integer,
	"free_days" integer,
	"credit_grant" integer,
	"unlock_plan_id" uuid,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_code_percent_range" CHECK ("promo_code"."percent_off" IS NULL OR "promo_code"."percent_off" BETWEEN 1 AND 100),
	CONSTRAINT "promo_code_within_cap" CHECK ("promo_code"."max_redemptions" IS NULL OR "promo_code"."redemption_count" <= "promo_code"."max_redemptions")
);
--> statement-breakpoint
CREATE TABLE "promo_redemption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"redeemed_by" uuid,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"status" "stripe_event_status" DEFAULT 'received' NOT NULL,
	"event_created_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" text NOT NULL,
	"interval" "billing_interval",
	"extra_seats" integer DEFAULT 0 NOT NULL,
	"is_founding" boolean DEFAULT false NOT NULL,
	"founding_locked_until" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_extra_seats_nonneg" CHECK ("subscription"."extra_seats" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" "job_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"attempt" integer DEFAULT 1 NOT NULL,
	"cost_pence" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_run_cost_nonneg" CHECK ("job_run"."cost_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "metric_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"day" date NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_counter_count_nonneg" CHECK ("metric_counter"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family" ADD CONSTRAINT "family_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_code" ADD CONSTRAINT "invite_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profile" ADD CONSTRAINT "learner_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_control" ADD CONSTRAINT "parent_control_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_control" ADD CONSTRAINT "parent_control_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_control" ADD CONSTRAINT "parent_control_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_link_request" ADD CONSTRAINT "parent_link_request_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_link_request" ADD CONSTRAINT "parent_link_request_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role" ADD CONSTRAINT "staff_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role" ADD CONSTRAINT "staff_role_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_day" ADD CONSTRAINT "usage_day_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_published_version_id_course_version_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_working_version_id_course_version_id_fk" FOREIGN KEY ("working_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_source_candidate_id_radar_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."radar_candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_source_idea_id_course_idea_id_fk" FOREIGN KEY ("source_idea_id") REFERENCES "public"."course_idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_generation_job_id_generation_job_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tool" ADD CONSTRAINT "course_tool_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tool" ADD CONSTRAINT "course_tool_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tool" ADD CONSTRAINT "course_tool_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tool" ADD CONSTRAINT "course_tool_fallback_tool_id_tool_id_fk" FOREIGN KEY ("fallback_tool_id") REFERENCES "public"."tool"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_generation_job_id_generation_job_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_source_candidate_id_radar_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."radar_candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_source_idea_id_course_idea_id_fk" FOREIGN KEY ("source_idea_id") REFERENCES "public"."course_idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_parent_version_id_course_version_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_version" ADD CONSTRAINT "course_version_last_edited_by_user_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_disabled_by_user_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_guide" ADD CONSTRAINT "tool_guide_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_guide" ADD CONSTRAINT "tool_guide_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_guide_step" ADD CONSTRAINT "tool_guide_step_tool_guide_id_tool_guide_id_fk" FOREIGN KEY ("tool_guide_id") REFERENCES "public"."tool_guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_idea" ADD CONSTRAINT "course_idea_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_idea" ADD CONSTRAINT "course_idea_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request" ADD CONSTRAINT "edit_request_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request" ADD CONSTRAINT "edit_request_source_version_id_course_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request" ADD CONSTRAINT "edit_request_result_version_id_course_version_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request" ADD CONSTRAINT "edit_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_result_version_id_course_version_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_candidate_id_radar_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."radar_candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_idea_id_course_idea_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."course_idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_token" ADD CONSTRAINT "preview_token_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_token" ADD CONSTRAINT "preview_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_token" ADD CONSTRAINT "preview_token_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_template" ADD CONSTRAINT "prompt_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_scheduled_by_user_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_candidate" ADD CONSTRAINT "radar_candidate_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_candidate" ADD CONSTRAINT "radar_candidate_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_item" ADD CONSTRAINT "radar_item_source_id_radar_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."radar_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_mention" ADD CONSTRAINT "radar_mention_candidate_id_radar_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."radar_candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_mention" ADD CONSTRAINT "radar_mention_item_id_radar_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."radar_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_source" ADD CONSTRAINT "radar_source_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment" ADD CONSTRAINT "review_comment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment" ADD CONSTRAINT "review_comment_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment" ADD CONSTRAINT "review_comment_review_task_id_review_task_id_fk" FOREIGN KEY ("review_task_id") REFERENCES "public"."review_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment" ADD CONSTRAINT "review_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment" ADD CONSTRAINT "review_comment_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_review_task_id_review_task_id_fk" FOREIGN KEY ("review_task_id") REFERENCES "public"."review_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_tool_change_event_id_tool_change_event_id_fk" FOREIGN KEY ("tool_change_event_id") REFERENCES "public"."tool_change_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_task" ADD CONSTRAINT "review_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_parent_operated_allowed_recorded_by_user_id_fk" FOREIGN KEY ("parent_operated_allowed_recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_source_candidate_id_radar_candidate_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."radar_candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_change_event" ADD CONSTRAINT "tool_change_event_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_change_event" ADD CONSTRAINT "tool_change_event_triaged_by_user_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_substitute" ADD CONSTRAINT "tool_substitute_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_substitute" ADD CONSTRAINT "tool_substitute_substitute_tool_id_tool_id_fk" FOREIGN KEY ("substitute_tool_id") REFERENCES "public"."tool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefact" ADD CONSTRAINT "artefact_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefact" ADD CONSTRAINT "artefact_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefact" ADD CONSTRAINT "artefact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefact" ADD CONSTRAINT "artefact_project_version_id_project_version_id_fk" FOREIGN KEY ("project_version_id") REFERENCES "public"."project_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artefact" ADD CONSTRAINT "artefact_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_course_version_id_course_version_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_current_step_id_step_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_current_version_id_project_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."project_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version" ADD CONSTRAINT "project_version_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_progress" ADD CONSTRAINT "step_progress_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_progress" ADD CONSTRAINT "step_progress_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_progress" ADD CONSTRAINT "step_progress_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_request" ADD CONSTRAINT "unlock_request_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_request" ADD CONSTRAINT "unlock_request_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_request" ADD CONSTRAINT "unlock_request_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_request" ADD CONSTRAINT "unlock_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_tutor_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."tutor_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_ai_request_id_ai_request_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_processor" ADD CONSTRAINT "ai_processor_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_conversation_id_tutor_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."tutor_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request" ADD CONSTRAINT "ai_request_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_route" ADD CONSTRAINT "model_route_provider_key_ai_processor_provider_key_fk" FOREIGN KEY ("provider_key") REFERENCES "public"."ai_processor"("provider_key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tutor_conversation" ADD CONSTRAINT "tutor_conversation_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversation" ADD CONSTRAINT "tutor_conversation_enrolment_id_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversation" ADD CONSTRAINT "tutor_conversation_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversation" ADD CONSTRAINT "tutor_conversation_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversation" ADD CONSTRAINT "tutor_conversation_safeguarding_case_id_safeguarding_case_id_fk" FOREIGN KEY ("safeguarding_case_id") REFERENCES "public"."safeguarding_case"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_moderation_item_id_moderation_item_id_fk" FOREIGN KEY ("moderation_item_id") REFERENCES "public"."moderation_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_safeguarding_case_id_safeguarding_case_id_fk" FOREIGN KEY ("safeguarding_case_id") REFERENCES "public"."safeguarding_case"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enforcement_action" ADD CONSTRAINT "enforcement_action_appeal_decided_by_user_id_fk" FOREIGN KEY ("appeal_decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_event" ADD CONSTRAINT "moderation_event_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_event" ADD CONSTRAINT "moderation_event_moderation_item_id_moderation_item_id_fk" FOREIGN KEY ("moderation_item_id") REFERENCES "public"."moderation_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_item" ADD CONSTRAINT "moderation_item_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_item" ADD CONSTRAINT "moderation_item_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_item" ADD CONSTRAINT "moderation_item_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_item" ADD CONSTRAINT "moderation_item_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_item" ADD CONSTRAINT "moderation_item_safeguarding_case_id_safeguarding_case_id_fk" FOREIGN KEY ("safeguarding_case_id") REFERENCES "public"."safeguarding_case"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_safeguarding_case_id_safeguarding_case_id_fk" FOREIGN KEY ("safeguarding_case_id") REFERENCES "public"."safeguarding_case"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_access_log" ADD CONSTRAINT "safeguarding_access_log_case_id_safeguarding_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safeguarding_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_access_log" ADD CONSTRAINT "safeguarding_access_log_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_learner_id_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_ai_request_id_ai_request_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_case" ADD CONSTRAINT "safeguarding_case_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_current_version_id_page_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."page_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_unlock_plan_id_plan_id_fk" FOREIGN KEY ("unlock_plan_id") REFERENCES "public"."plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_promo_code_id_promo_code_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uq" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limit_key_uq" ON "auth_rate_limit" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definition_key_version_uq" ON "consent_definition" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "consent_record_learner_key_idx" ON "consent_record" USING btree ("learner_id","consent_key","created_at");--> statement-breakpoint
CREATE INDEX "consent_record_family_idx" ON "consent_record" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "family_owner_idx" ON "family" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_stripe_customer_uq" ON "family" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_member_user_uq" ON "family_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "family_member_family_idx" ON "family_member" USING btree ("family_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_code_hash_uq" ON "invite_code" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "invite_code_learner_idx" ON "invite_code" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "invite_code_family_idx" ON "invite_code" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learner_profile_user_uq" ON "learner_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learner_profile_band_idx" ON "learner_profile" USING btree ("safety_band");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_control_learner_uq" ON "parent_control" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "parent_control_family_idx" ON "parent_control" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_link_request_token_uq" ON "parent_link_request" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "parent_link_request_learner_idx" ON "parent_link_request" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "parent_link_request_status_expires_idx" ON "parent_link_request" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uq" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_role_user_role_uq" ON "staff_role" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "staff_role_role_idx" ON "staff_role" USING btree ("role");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_day_learner_day_uq" ON "usage_day" USING btree ("learner_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user" USING btree ("username");--> statement-breakpoint
CREATE INDEX "user_kind_status_idx" ON "user" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "user_last_active_idx" ON "user" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_key_uq" ON "asset" USING btree ("key");--> statement-breakpoint
CREATE INDEX "asset_kind_idx" ON "asset" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "course_slug_uq" ON "course" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "course_status_idx" ON "course" USING btree ("status");--> statement-breakpoint
CREATE INDEX "course_catalogue_idx" ON "course" USING btree ("status","category","min_age");--> statement-breakpoint
CREATE INDEX "course_published_at_idx" ON "course" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "course_search_idx" ON "course" USING gin ("search");--> statement-breakpoint
CREATE INDEX "course_interests_idx" ON "course" USING gin ("interests");--> statement-breakpoint
CREATE UNIQUE INDEX "course_tool_version_tool_uq" ON "course_tool" USING btree ("course_version_id","tool_id");--> statement-breakpoint
CREATE INDEX "course_tool_tool_idx" ON "course_tool" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "course_tool_course_idx" ON "course_tool" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_version_course_revision_uq" ON "course_version" USING btree ("course_id","revision");--> statement-breakpoint
CREATE INDEX "course_version_course_status_idx" ON "course_version" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_version_key_uq" ON "lesson" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE INDEX "lesson_module_position_idx" ON "lesson" USING btree ("module_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "module_version_key_uq" ON "module" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE INDEX "module_version_position_idx" ON "module" USING btree ("course_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_version_key_uq" ON "quiz" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_question_quiz_key_uq" ON "quiz_question" USING btree ("quiz_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_criterion_version_key_uq" ON "rubric_criterion" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "step_version_key_uq" ON "step" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE INDEX "step_lesson_position_idx" ON "step" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE INDEX "step_tool_slug_idx" ON "step" USING btree ("tool_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_kind_slug_uq" ON "tag" USING btree ("kind","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_guide_version_key_uq" ON "tool_guide" USING btree ("course_version_id","key");--> statement-breakpoint
CREATE INDEX "tool_guide_tool_idx" ON "tool_guide" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_guide_step_guide_key_uq" ON "tool_guide_step" USING btree ("tool_guide_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "course_idea_key_uq" ON "course_idea" USING btree ("idea_key");--> statement-breakpoint
CREATE INDEX "course_idea_status_idx" ON "course_idea" USING btree ("status");--> statement-breakpoint
CREATE INDEX "course_idea_category_idx" ON "course_idea" USING btree ("category");--> statement-breakpoint
CREATE INDEX "edit_request_course_idx" ON "edit_request" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "edit_request_status_idx" ON "edit_request" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_job_idempotency_uq" ON "generation_job" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_job_status_idx" ON "generation_job" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "generation_job_candidate_idx" ON "generation_job" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_token_hash_uq" ON "preview_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "preview_token_version_idx" ON "preview_token" USING btree ("course_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_template_key_version_uq" ON "prompt_template" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_template_one_active_uq" ON "prompt_template" USING btree ("key") WHERE "prompt_template"."active";--> statement-breakpoint
CREATE INDEX "publish_schedule_due_idx" ON "publish_schedule" USING btree ("status","publish_at");--> statement-breakpoint
CREATE INDEX "publish_schedule_version_idx" ON "publish_schedule" USING btree ("course_version_id");--> statement-breakpoint
CREATE INDEX "radar_candidate_domain_idx" ON "radar_candidate" USING btree ("vendor_domain");--> statement-breakpoint
CREATE INDEX "radar_candidate_status_score_idx" ON "radar_candidate" USING btree ("status","score");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_item_source_external_uq" ON "radar_item" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "radar_item_hash_idx" ON "radar_item" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "radar_item_pending_idx" ON "radar_item" USING btree ("normalised_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_mention_candidate_item_uq" ON "radar_mention" USING btree ("candidate_id","item_id");--> statement-breakpoint
CREATE INDEX "radar_mention_item_idx" ON "radar_mention" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_source_key_uq" ON "radar_source" USING btree ("key");--> statement-breakpoint
CREATE INDEX "review_comment_version_idx" ON "review_comment" USING btree ("course_version_id","created_at");--> statement-breakpoint
CREATE INDEX "review_decision_version_idx" ON "review_decision" USING btree ("course_version_id","decision");--> statement-breakpoint
CREATE INDEX "review_decision_course_idx" ON "review_decision" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "review_decision_reviewer_idx" ON "review_decision" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "review_task_queue_idx" ON "review_task" USING btree ("status","kind","created_at");--> statement-breakpoint
CREATE INDEX "review_task_course_idx" ON "review_task" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "review_task_assignee_idx" ON "review_task" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_slug_uq" ON "tool" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tool_status_idx" ON "tool" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_vendor_domain_idx" ON "tool" USING btree ("vendor_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_approval_learner_tool_course_uq" ON "tool_approval" USING btree ("learner_id","tool_id","course_id");--> statement-breakpoint
CREATE INDEX "tool_approval_learner_idx" ON "tool_approval" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "tool_approval_family_status_idx" ON "tool_approval" USING btree ("family_id","status");--> statement-breakpoint
CREATE INDEX "tool_approval_tool_idx" ON "tool_approval" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tool_change_event_tool_status_idx" ON "tool_change_event" USING btree ("tool_id","status");--> statement-breakpoint
CREATE INDEX "tool_change_event_status_idx" ON "tool_change_event" USING btree ("status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_substitute_pair_uq" ON "tool_substitute" USING btree ("tool_id","substitute_tool_id");--> statement-breakpoint
CREATE INDEX "artefact_learner_idx" ON "artefact" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "artefact_project_version_idx" ON "artefact" USING btree ("project_version_id");--> statement-breakpoint
CREATE INDEX "artefact_enrolment_idx" ON "artefact" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "artefact_sha256_idx" ON "artefact" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_verify_code_uq" ON "certificate" USING btree ("verify_code");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_enrolment_uq" ON "certificate" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "certificate_learner_idx" ON "certificate" USING btree ("learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_learner_course_uq" ON "enrolment" USING btree ("learner_id","course_id");--> statement-breakpoint
CREATE INDEX "enrolment_learner_idx" ON "enrolment" USING btree ("learner_id","status");--> statement-breakpoint
CREATE INDEX "enrolment_version_idx" ON "enrolment" USING btree ("course_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_enrolment_uq" ON "project" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "project_learner_idx" ON "project" USING btree ("learner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_version_project_version_uq" ON "project_version" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_version_learner_idx" ON "project_version" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "project_version_state_idx" ON "project_version" USING btree ("moderation_state","submitted_at");--> statement-breakpoint
CREATE INDEX "quiz_attempt_learner_idx" ON "quiz_attempt" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "quiz_attempt_enrolment_quiz_idx" ON "quiz_attempt" USING btree ("enrolment_id","quiz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_enrolment_step_uq" ON "reflection" USING btree ("enrolment_id","step_id");--> statement-breakpoint
CREATE INDEX "reflection_learner_idx" ON "reflection" USING btree ("learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_progress_enrolment_step_uq" ON "step_progress" USING btree ("enrolment_id","step_id");--> statement-breakpoint
CREATE INDEX "step_progress_learner_idx" ON "step_progress" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "step_progress_step_idx" ON "step_progress" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "unlock_request_learner_idx" ON "unlock_request" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "unlock_request_family_status_idx" ON "unlock_request" USING btree ("family_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "unlock_request_one_pending_uq" ON "unlock_request" USING btree ("learner_id","course_id","kind") WHERE "unlock_request"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_learner_course_uq" ON "wishlist" USING btree ("learner_id","course_id");--> statement-breakpoint
CREATE INDEX "ai_message_conversation_idx" ON "ai_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_learner_idx" ON "ai_message" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "ai_message_expires_idx" ON "ai_message" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_request_user_idx" ON "ai_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_request_feature_created_idx" ON "ai_request" USING btree ("feature","created_at");--> statement-breakpoint
CREATE INDEX "ai_request_created_idx" ON "ai_request" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balance_learner_period_uq" ON "credit_balance" USING btree ("learner_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_uq" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_learner_period_idx" ON "credit_ledger" USING btree ("learner_id","period_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_reservation_idx" ON "credit_ledger" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_price_key_uq" ON "credit_price" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "model_route_alias_priority_uq" ON "model_route" USING btree ("alias","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_bucket_key_window_uq" ON "rate_limit_bucket" USING btree ("key","window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_bucket_expires_idx" ON "rate_limit_bucket" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_counter_day_feature_uq" ON "spend_counter" USING btree ("day","feature");--> statement-breakpoint
CREATE INDEX "tutor_conversation_learner_idx" ON "tutor_conversation" USING btree ("learner_id","last_message_at");--> statement-breakpoint
CREATE INDEX "tutor_conversation_step_idx" ON "tutor_conversation" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "data_request_family_idx" ON "data_request" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "data_request_learner_idx" ON "data_request" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "data_request_due_idx" ON "data_request" USING btree ("kind","status","undo_until");--> statement-breakpoint
CREATE INDEX "enforcement_action_user_idx" ON "enforcement_action" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "enforcement_action_appeal_idx" ON "enforcement_action" USING btree ("appeal_status");--> statement-breakpoint
CREATE INDEX "moderation_event_learner_idx" ON "moderation_event" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "moderation_event_subject_idx" ON "moderation_event" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "moderation_event_created_idx" ON "moderation_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_item_queue_idx" ON "moderation_item" USING btree ("state","severity","due_at");--> statement-breakpoint
CREATE INDEX "moderation_item_learner_idx" ON "moderation_item" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "moderation_item_assignee_idx" ON "moderation_item" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "moderation_item_subject_idx" ON "moderation_item" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "report_reporter_idx" ON "report" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "report" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policy_key_uq" ON "retention_policy" USING btree ("key");--> statement-breakpoint
CREATE INDEX "safeguarding_access_log_case_idx" ON "safeguarding_access_log" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "safeguarding_access_log_staff_idx" ON "safeguarding_access_log" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "safeguarding_case_queue_idx" ON "safeguarding_case" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "safeguarding_case_learner_idx" ON "safeguarding_case" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "safeguarding_case_unacknowledged_idx" ON "safeguarding_case" USING btree ("acknowledged_at","due_at");--> statement-breakpoint
CREATE INDEX "support_ticket_user_idx" ON "support_ticket" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_ticket_queue_idx" ON "support_ticket" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_key_channel_version_uq" ON "email_template" USING btree ("key","channel","version");--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_one_active_uq" ON "email_template" USING btree ("key","channel") WHERE "email_template"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_key_uq" ON "feature_flag" USING btree ("key");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_idx" ON "notification" USING btree ("channel","sent_at","deliver_after");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uq" ON "notification" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "page_slug_audience_uq" ON "page" USING btree ("slug","audience");--> statement-breakpoint
CREATE INDEX "page_kind_idx" ON "page" USING btree ("kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "page_version_page_version_uq" ON "page_version" USING btree ("page_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_key_uq" ON "plan" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_code_code_uq" ON "promo_code" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemption_code_family_uq" ON "promo_redemption" USING btree ("promo_code_id","family_id");--> statement-breakpoint
CREATE INDEX "promo_redemption_family_idx" ON "promo_redemption" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_setting_key_uq" ON "site_setting" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_permission_user_action_uq" ON "staff_permission" USING btree ("user_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_event_event_id_uq" ON "stripe_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "stripe_event_status_idx" ON "stripe_event" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_id_uq" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_family_idx" ON "subscription" USING btree ("family_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_idempotency_uq" ON "job_run" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "job_run_job_started_idx" ON "job_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "job_run_status_idx" ON "job_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_counter_key_day_uq" ON "metric_counter" USING btree ("key","day");