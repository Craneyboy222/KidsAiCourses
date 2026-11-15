import { sql } from "drizzle-orm";
import {
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
import type { UserKind } from "../../authz/actor";
import { citext, createdAt, emptyTextArray, emptyUuidArray, id, timestamps, ts } from "./_columns";
import {
  ageAssuranceLevelEnum,
  certificateNameChoiceEnum,
  consentActionEnum,
  familyRoleEnum,
  parentLinkStatusEnum,
  pathwayEnum,
  safetyBandEnum,
  staffRoleEnum,
  userStatusEnum,
} from "./enums";

/**
 * Identity, family and consent (spec Section 12, 3.1, 3.6).
 *
 * `user`, `session`, `account`, `verification`, `two_factor` and `auth_rate_limit` are owned by
 * Better Auth. Their TypeScript property names must match Better Auth's field names exactly
 * (`emailVerified`, `userId`, `expiresAt`, …) because the Drizzle adapter addresses columns by
 * property name. Database column names stay snake_case.
 *
 * Throughout the schema `learner_id` means `user.id` of a user whose kind is `learner`.
 */

/** Domain of the internal placeholder address given to learners, who have no email (see `auth/learner-email.ts`). */
export const LEARNER_EMAIL_DOMAIN = "learner.invalid";

export const user = pgTable(
  "user",
  {
    id: id(),
    /** Display name. For a learner this is the nickname, never a full name. */
    name: text("name").notNull(),
    /**
     * Better Auth 1.7 requires a unique, non-null email. Learners have none, so they hold an internal,
     * non-routable `<uuid>@learner.invalid` placeholder that is never shown, returned or sent to.
     * Read it only through `userEmail()` in `@/server/auth/learner-email`.
     */
    email: text("email").notNull(),
    /** True for learners: there is no address to verify, and Better Auth refuses sign-in otherwise. */
    emailVerified: boolean("email_verified").notNull().default(false),
    /** Better Auth core field. Unused: avatars are generated from `learner_profile.avatar_seed`, never photographs. */
    image: text("image"),
    /** Learners sign in with this. Case-insensitive, unique, checked for personal information and profanity. */
    username: citext("username"),
    /** `learner` | `parent` | `staff`. Text, not an enum: the spec keeps `user.kind` open. Unknown kinds are treated as signed out. */
    kind: text("kind").$type<UserKind>().notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    statusReason: text("status_reason"),
    /** Better Auth two-factor plugin. Required for staff. */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    /** Failed sign-ins inside the current 15-minute window (see `auth/lockout.ts`). */
    failedSigninCount: integer("failed_signin_count").notNull().default(0),
    failedSigninWindowStartedAt: ts("failed_signin_window_started_at"),
    /** Sign-in is refused until this time. Separate from `status = 'locked'`, which is a deliberate lock by a parent or staff. */
    lockedUntil: ts("locked_until"),
    /** Drives the 24-month inactivity retention rule. */
    lastActiveAt: ts("last_active_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("user_email_uq").on(t.email),
    uniqueIndex("user_username_uq").on(t.username),
    index("user_kind_status_idx").on(t.kind, t.status),
    index("user_last_active_idx").on(t.lastActiveAt),
    // A placeholder address may only ever sit on a learner account.
    check(
      "user_placeholder_email_learner_only",
      sql`${t.email} NOT LIKE '%@learner.invalid' OR ${t.kind} = 'learner'`,
    ),
    check("user_failed_signin_count_nonneg", sql`${t.failedSigninCount} >= 0`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    /**
     * Hard ceiling for the session, set at sign-in for staff (12 hours, spec 3.1). A database trigger
     * stops any refresh from moving `expires_at` past it.
     */
    absoluteExpiresAt: ts("absolute_expires_at"),
    /** True only when this session was created by completing a second-factor challenge. */
    twoFactorVerified: boolean("two_factor_verified").notNull().default(false),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("session_token_uq").on(t.token),
    index("session_user_idx").on(t.userId),
    index("session_expires_idx").on(t.expiresAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** For the `credential` provider this is the user id. */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    /** Password hash (scrypt). Never selected by application code. */
    password: text("password"),
    ...timestamps(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("verification_identifier_idx").on(t.identifier),
    index("verification_expires_idx").on(t.expiresAt),
  ],
);

/** Better Auth two-factor plugin (`twoFactor` model): TOTP secret and backup codes, both encrypted by Better Auth. */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: ts("locked_until"),
    ...timestamps(),
  },
  (t) => [index("two_factor_user_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
);

/** Better Auth rate limiter (`rateLimit` model) for auth routes. Our own limits use `rate_limit_bucket`. */
export const authRateLimit = pgTable(
  "auth_rate_limit",
  {
    id: id(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("auth_rate_limit_key_uq").on(t.key)],
);

export const staffRole = pgTable(
  "staff_role",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: staffRoleEnum("role").notNull(),
    grantedBy: uuid("granted_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("staff_role_user_role_uq").on(t.userId, t.role),
    index("staff_role_role_idx").on(t.role),
  ],
);

export const learnerProfile = pgTable(
  "learner_profile",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Month and year only: we never hold a full date of birth. */
    birthMonth: smallint("birth_month").notNull(),
    birthYear: smallint("birth_year").notNull(),
    /** Derived from birth month and year by `services/age.ts`; recalculated by the daily job. */
    safetyBand: safetyBandEnum("safety_band").notNull(),
    safetyBandCheckedAt: ts("safety_band_checked_at"),
    /** Content discovery only. `min_age` on a course is enforced whatever the pathway. */
    pathway: pathwayEnum("pathway").notNull(),
    nickname: text("nickname").notNull(),
    /** Optional, only so a certificate can show a first name if the learner chooses. */
    firstName: text("first_name"),
    avatarSeed: text("avatar_seed").notNull(),
    interests: text("interests").array().notNull().default(emptyTextArray),
    /** Accessibility preferences: text size, contrast, reduced motion, dyslexia-friendly mode, captions. */
    a11y: jsonb("a11y").$type<Record<string, unknown>>().notNull().default({}),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    certificateNameChoice: certificateNameChoiceEnum("certificate_name_choice").notNull().default("nickname"),
    /** Set when an 18-year-old has been offered account independence (spec 3.1). */
    independenceOfferedAt: ts("independence_offered_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("learner_profile_user_uq").on(t.userId),
    index("learner_profile_band_idx").on(t.safetyBand),
    check("learner_profile_birth_month_range", sql`${t.birthMonth} BETWEEN 1 AND 12`),
    check("learner_profile_birth_year_range", sql`${t.birthYear} BETWEEN 1900 AND 2200`),
  ],
);

export const family = pgTable(
  "family",
  {
    id: id(),
    /** The paying adult: a parent or carer, or an 18-year-old holding their own account. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id"),
    ageAssuranceLevel: ageAssuranceLevelEnum("age_assurance_level").notNull().default("none"),
    ageAssuredAt: ts("age_assured_at"),
    /**
     * `plan.key` of the current entitlement. A cache kept by the Stripe webhook handler: `subscription`
     * is the source of truth, so there is deliberately no foreign key.
     */
    plan: text("plan").notNull().default("free"),
    ...timestamps(),
  },
  (t) => [
    index("family_owner_idx").on(t.ownerUserId),
    uniqueIndex("family_stripe_customer_uq").on(t.stripeCustomerId),
  ],
);

export const familyMember = pgTable(
  "family_member",
  {
    id: id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: familyRoleEnum("role").notNull(),
    addedBy: uuid("added_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    // One family per account: the Actor carries a single familyId.
    uniqueIndex("family_member_user_uq").on(t.userId),
    index("family_member_family_idx").on(t.familyId, t.role),
  ],
);

/** Teen-first sign-up: the account stays `pending_parent` until the parent follows the emailed link. */
export const parentLinkRequest = pgTable(
  "parent_link_request",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentEmail: citext("parent_email").notNull(),
    /** SHA-256 of the emailed token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    status: parentLinkStatusEnum("status").notNull().default("pending"),
    /** Seven days after sign-up; the nightly job then deletes the unapproved account. */
    expiresAt: ts("expires_at").notNull(),
    lastSentAt: ts("last_sent_at"),
    sendCount: integer("send_count").notNull().default(0),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("parent_link_request_token_uq").on(t.tokenHash),
    index("parent_link_request_learner_idx").on(t.learnerId),
    index("parent_link_request_status_expires_idx").on(t.status, t.expiresAt),
  ],
);

/** One-time code a parent gives a child to set their own password. Valid 72 hours, single use. */
export const inviteCode = pgTable(
  "invite_code",
  {
    id: id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invite_code_hash_uq").on(t.codeHash),
    index("invite_code_learner_idx").on(t.learnerId),
    index("invite_code_family_idx").on(t.familyId),
  ],
);

/** Versioned, plain-English consent wording. `key` is open text so new consents need no migration. */
export const consentDefinition = pgTable(
  "consent_definition",
  {
    id: id(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Revoking a required consent pauses the account. */
    required: boolean("required").notNull(),
    /** Default by safety band, e.g. `{ "teen_13_15": false, "teen_16_17": false, "adult_18": true }`. */
    defaultByBand: jsonb("default_by_band").$type<Record<string, boolean>>().notNull().default({}),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    publishedAt: ts("published_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("consent_definition_key_version_uq").on(t.key, t.version)],
);

/**
 * APPEND-ONLY (database trigger). One row per grant or revocation; the current state of a consent
 * is its newest row. Ids are deliberately not foreign keys, so the record of consent survives
 * account deletion as pseudonymous evidence and never blocks it.
 */
export const consentRecord = pgTable(
  "consent_record",
  {
    id: id(),
    learnerId: uuid("learner_id").notNull(),
    familyId: uuid("family_id"),
    consentKey: text("consent_key").notNull(),
    consentVersion: integer("consent_version").notNull(),
    action: consentActionEnum("action").notNull(),
    /** The adult who made the choice: a parent, or the learner themselves at 18. */
    actorUserId: uuid("actor_user_id").notNull(),
    /** Where it was recorded, e.g. `consent_centre`, `signup`, `teen_approval`. */
    method: text("method").notNull().default("consent_centre"),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("consent_record_learner_key_idx").on(t.learnerId, t.consentKey, t.createdAt),
    index("consent_record_family_idx").on(t.familyId),
  ],
);

export const parentControl = pgTable(
  "parent_control",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    /** Null means no cap. */
    dailyMinutesCap: integer("daily_minutes_cap"),
    /** Quiet hours as minutes since midnight in Europe/London. Both null means none. The window may wrap past midnight. */
    quietStartMin: smallint("quiet_start_min"),
    quietEndMin: smallint("quiet_end_min"),
    blockedCategories: text("blocked_categories").array().notNull().default(emptyTextArray),
    blockedCourseIds: uuid("blocked_course_ids").array().notNull().default(emptyUuidArray),
    requireApprovalForPro: boolean("require_approval_for_pro").notNull().default(false),
    /** Pausing ends the learner's sessions at once. */
    paused: boolean("paused").notNull().default(false),
    pausedReason: text("paused_reason"),
    pausedAt: ts("paused_at"),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("parent_control_learner_uq").on(t.learnerId),
    index("parent_control_family_idx").on(t.familyId),
    check(
      "parent_control_cap_range",
      sql`${t.dailyMinutesCap} IS NULL OR ${t.dailyMinutesCap} BETWEEN 1 AND 1440`,
    ),
    check(
      "parent_control_quiet_range",
      sql`(${t.quietStartMin} IS NULL AND ${t.quietEndMin} IS NULL) OR (${t.quietStartMin} BETWEEN 0 AND 1439 AND ${t.quietEndMin} BETWEEN 0 AND 1439)`,
    ),
  ],
);

/** Seconds of activity per learner per London calendar day, fed by the usage heartbeat. */
export const usageDay = pgTable(
  "usage_day",
  {
    id: id(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `yyyy-MM-dd` in Europe/London (`londonDateKey`). */
    day: date("day", { mode: "string" }).notNull(),
    seconds: integer("seconds").notNull().default(0),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("usage_day_learner_day_uq").on(t.learnerId, t.day),
    check("usage_day_seconds_nonneg", sql`${t.seconds} >= 0`),
  ],
);
