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
import { citext, id, timestamps, ts } from "./_columns";
import {
  billingIntervalEnum,
  notificationChannelEnum,
  pageAudienceEnum,
  pageKindEnum,
  pageVersionStatusEnum,
  promoKindEnum,
  stripeEventStatusEnum,
} from "./enums";
import { family, user } from "./identity";

/**
 * Billing and the content-management tables (spec 3.7, 3.8, Section 11, 12).
 * Plans, prices, pages, emails, flags and settings are data, not code. All money is whole pence.
 * Under-18s never see anything from the billing tables.
 */

export const plan = pgTable(
  "plan",
  {
    id: id(),
    /** `free`, `family`. Referenced by `family.plan`. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceMonthlyPence: integer("price_monthly_pence").notNull().default(0),
    priceAnnualPence: integer("price_annual_pence").notNull().default(0),
    /** Founding-family prices and how long they stay locked. */
    foundingMonthlyPence: integer("founding_monthly_pence"),
    foundingAnnualPence: integer("founding_annual_pence"),
    foundingLockMonths: integer("founding_lock_months"),
    /** Learner seats included. */
    seats: integer("seats").notNull(),
    extraSeatPricePence: integer("extra_seat_price_pence"),
    /** Coach credits per learner per month. */
    coachCredits: integer("coach_credits").notNull().default(0),
    trialDays: integer("trial_days").notNull().default(0),
    /** e.g. `{ fullCatalogue: true, freeCourseSlugs: [...] }`. */
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
    stripeProductId: text("stripe_product_id"),
    stripePriceMonthlyId: text("stripe_price_monthly_id"),
    stripePriceAnnualId: text("stripe_price_annual_id"),
    stripePriceFoundingMonthlyId: text("stripe_price_founding_monthly_id"),
    stripePriceFoundingAnnualId: text("stripe_price_founding_annual_id"),
    stripePriceExtraSeatId: text("stripe_price_extra_seat_id"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("plan_key_uq").on(t.key),
    check(
      "plan_prices_nonneg",
      sql`${t.priceMonthlyPence} >= 0 AND ${t.priceAnnualPence} >= 0 AND ${t.seats} >= 1 AND ${t.coachCredits} >= 0 AND ${t.trialDays} >= 0`,
    ),
  ],
);

/** Mirror of the family's Stripe subscription, written only by the signature-verified webhook handler. */
export const subscription = pgTable(
  "subscription",
  {
    id: id(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    /** Stripe's own status string (`trialing`, `active`, `past_due`, …). Text because Stripe owns the set. */
    status: text("status").notNull(),
    interval: billingIntervalEnum("interval"),
    extraSeats: integer("extra_seats").notNull().default(0),
    isFounding: boolean("is_founding").notNull().default(false),
    foundingLockedUntil: ts("founding_locked_until"),
    trialEndsAt: ts("trial_ends_at"),
    currentPeriodStart: ts("current_period_start"),
    currentPeriodEnd: ts("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: ts("canceled_at"),
    /** When a payment first failed and the subscription became `past_due`. The grace period runs from here. Null once paid. */
    pastDueSince: ts("past_due_since"),
    /** `created` time of the newest Stripe event applied, so an out-of-order webhook cannot roll state back. */
    lastEventAt: ts("last_event_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("subscription_stripe_id_uq").on(t.stripeSubscriptionId),
    index("subscription_family_idx").on(t.familyId, t.status),
    check("subscription_extra_seats_nonneg", sql`${t.extraSeats} >= 0`),
  ],
);

/** Every Stripe webhook event we have seen. The unique `event_id` makes handling idempotent. */
export const stripeEvent = pgTable(
  "stripe_event",
  {
    id: id(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    status: stripeEventStatusEnum("status").notNull().default("received"),
    /** The event's `created` time. */
    eventCreatedAt: ts("event_created_at"),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("stripe_event_event_id_uq").on(t.eventId),
    index("stripe_event_status_idx").on(t.status),
  ],
);

export const promoCode = pgTable(
  "promo_code",
  {
    id: id(),
    code: citext("code").notNull(),
    kind: promoKindEnum("kind").notNull(),
    percentOff: smallint("percent_off"),
    amountOffPence: integer("amount_off_pence"),
    freeDays: integer("free_days"),
    creditGrant: integer("credit_grant"),
    unlockPlanId: uuid("unlock_plan_id").references(() => plan.id, { onDelete: "set null" }),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    /** Null means no cap. */
    maxRedemptions: integer("max_redemptions"),
    redemptionCount: integer("redemption_count").notNull().default(0),
    startsAt: ts("starts_at"),
    expiresAt: ts("expires_at"),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("promo_code_code_uq").on(t.code),
    check("promo_code_percent_range", sql`${t.percentOff} IS NULL OR ${t.percentOff} BETWEEN 1 AND 100`),
    check(
      "promo_code_within_cap",
      sql`${t.maxRedemptions} IS NULL OR ${t.redemptionCount} <= ${t.maxRedemptions}`,
    ),
  ],
);

/** Promo codes are entered only by a parent or adult at checkout. */
export const promoRedemption = pgTable(
  "promo_redemption",
  {
    id: id(),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => promoCode.id, { onDelete: "restrict" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id, { onDelete: "cascade" }),
    redeemedBy: uuid("redeemed_by").references(() => user.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscription.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("promo_redemption_code_family_uq").on(t.promoCodeId, t.familyId),
    index("promo_redemption_family_idx").on(t.familyId),
  ],
);

/**
 * In-app and email notifications. `type` is open text (spec Section 12). Learner notifications
 * wait for `deliver_after` when it falls in parent-set quiet hours; safety notices to parents are
 * always immediate. Never marketing to under-18s.
 */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    channel: notificationChannelEnum("channel").notNull().default("in_app"),
    /** Template variables and a link target. No free text written by a learner. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts("read_at"),
    /** Not delivered before this time. Null means straight away. */
    deliverAfter: ts("deliver_after"),
    sentAt: ts("sent_at"),
    failedAt: ts("failed_at"),
    error: text("error"),
    /** Stops the same event notifying twice. */
    dedupeKey: text("dedupe_key"),
    ...timestamps(),
  },
  (t) => [
    index("notification_user_idx").on(t.userId, t.readAt, t.createdAt),
    index("notification_outbox_idx").on(t.channel, t.sentAt, t.deliverAfter),
    uniqueIndex("notification_dedupe_uq").on(t.dedupeKey),
  ],
);

/** `rules` is open JSON so flags can target safety band, plan or family without a migration. */
export const featureFlag = pgTable(
  "feature_flag",
  {
    id: id(),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    rules: jsonb("rules").$type<unknown[]>().notNull().default([]),
    description: text("description"),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("feature_flag_key_uq").on(t.key)],
);

/** Marketing, legal and help pages, and reusable in-app copy snippets. */
export const page = pgTable(
  "page",
  {
    id: id(),
    slug: text("slug").notNull(),
    kind: pageKindEnum("kind").notNull(),
    audience: pageAudienceEnum("audience").notNull().default("everyone"),
    title: text("title").notNull(),
    /** The published version. Null while the page has only drafts. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => pageVersion.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("page_slug_audience_uq").on(t.slug, t.audience),
    index("page_kind_idx").on(t.kind, t.position),
  ],
);

export const pageVersion = pgTable(
  "page_version",
  {
    id: id(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** Markdown, rendered through the sanitiser. */
    body: text("body").notNull(),
    status: pageVersionStatusEnum("status").notNull().default("draft"),
    changeNote: text("change_note"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    publishedBy: uuid("published_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: ts("published_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("page_version_page_version_uq").on(t.pageId, t.version)],
);

/** Transactional email and in-app notification templates. Versioned; one active version per key and channel. */
export const emailTemplate = pgTable(
  "email_template",
  {
    id: id(),
    key: text("key").notNull(),
    channel: notificationChannelEnum("channel").notNull().default("email"),
    version: integer("version").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("email_template_key_channel_version_uq").on(t.key, t.channel, t.version),
    uniqueIndex("email_template_one_active_uq")
      .on(t.key, t.channel)
      .where(sql`${t.active}`),
  ],
);

/** Admin-editable settings. NEVER secrets: those stay in environment variables. */
export const siteSetting = pgTable(
  "site_setting",
  {
    id: id(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("site_setting_key_uq").on(t.key)],
);

/** Optional per-person override on top of staff roles: grant or withhold one authz action. */
export const staffPermission = pgTable(
  "staff_permission",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** An `area.verb` action from `src/server/authz/actions.ts`. */
    action: text("action").notNull(),
    allowed: boolean("allowed").notNull(),
    grantedBy: uuid("granted_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("staff_permission_user_action_uq").on(t.userId, t.action)],
);
