import { z } from "zod";

/**
 * Every admin-editable site setting: its shape, default and where it appears in Studio.
 * Values live in `site_setting` (key, value jsonb). Secrets never do (spec 3.8).
 * Read with `getSetting("moderation.sample_rate")`; the result is typed from this registry.
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, for example 21:00");
const pence = z.number().int().min(0);

function def<S extends z.ZodType>(group: SettingGroup, label: string, help: string, schema: S, defaultValue: z.infer<S>, opts: { legal?: true; ownerOnly?: true } = {}) {
  return { group, label, help, schema, defaultValue, ...opts };
}

export type SettingGroup = "site" | "safety" | "moderation" | "safeguarding" | "review" | "coach" | "drafting" | "radar" | "uploads" | "launch";

export const SETTINGS = {
  // ── Site ────────────────────────────────────────────────────────────────
  "site.signup_open": def("site", "Sign-up open", "When off, nobody new can create an account. It cannot be turned on until the launch-readiness checklist passes.", z.boolean(), false),
  "site.maintenance_message": def("site", "Maintenance message", "Shown across the site while set. Leave empty for none.", z.string().max(300).nullable(), null),
  "site.brand_display_name": def("site", "Brand name shown to users", "Leave empty to use the configured brand name.", z.string().max(60).nullable(), null),
  "site.support_email": def("site", "Support email", "Shown on help and legal pages.", z.email().nullable(), null),
  "site.default_quiet_hours": def("site", "Default quiet hours", "Applied to a new child until a parent changes them. No learner notifications are sent in this window.", z.object({ start: hhmm, end: hhmm }), { start: "21:00", end: "07:00" }),
  "site.adult_self_serve": def("site", "18-year-olds can sign up and pay themselves", "Spec question 12.", z.boolean(), true),

  // ── Safety ──────────────────────────────────────────────────────────────
  "safety.age_assurance_mode": def("safety", "Age assurance for 13–15", "How a parent of a 13–15-year-old is verified before the child can use Coach. Confirm with legal before launch.", z.enum(["card_or_subscription", "parent_email", "off_dev_only"]), "card_or_subscription", { legal: true }),
  "safety.parent_transcript_visibility": def("safety", "What parents see of Coach chats", "Summary shows a count, topics and safety notices only (spec question 9).", z.enum(["summary"]), "summary", { legal: true }),

  // ── Moderation ──────────────────────────────────────────────────────────
  "moderation.auto_accept_clean_submissions": def("moderation", "Auto-accept clean submissions", "On: a submission that passes every automated check is accepted without a human, except the random sample. Off: every submission waits for a human.", z.boolean(), true),
  "moderation.sample_rate": def("moderation", "Human review sample", "Share of clean submissions held for a human check (0.1 = 10%). Sampled work is not accepted until reviewed.", z.number().min(0).max(1), 0.1),
  "moderation.sla_hours": def("moderation", "Response targets (hours)", "Targets inside the working window. Tighten once a DSL, deputy or outsourced cover is in place.", z.object({ critical: z.number().positive(), high: z.number().positive(), normal: z.number().positive() }), { critical: 4, high: 8, normal: 48 }),
  "moderation.sla_window": def("moderation", "Working window (UK time)", "Targets count time inside this window only.", z.object({ start: hhmm, end: hhmm }), { start: "08:00", end: "22:00" }),

  // ── Safeguarding ────────────────────────────────────────────────────────
  "safeguarding.dsl_name": def("safeguarding", "Designated Safeguarding Lead", "The named, trained person. Required before sign-up can open.", z.string().max(120).nullable(), null, { ownerOnly: true, legal: true }),
  "safeguarding.deputy_name": def("safeguarding", "Deputy or outsourced cover", "Needed before scaling beyond a sole operator.", z.string().max(120).nullable(), null, { ownerOnly: true, legal: true }),
  "safeguarding.alert_emails": def("safeguarding", "Alert emails", "Critical and high cases alert these addresses immediately. Falls back to DSL_ALERT_EMAILS.", z.array(z.email()).max(10), []),
  "safeguarding.deputy_alert_emails": def("safeguarding", "Deputy alert emails", "Used when deputy escalation is on.", z.array(z.email()).max(10), []),
  "safeguarding.deputy_escalation_enabled": def("safeguarding", "Escalate to deputy", "Off until a deputy is named.", z.boolean(), false),
  "safeguarding.deputy_escalation_minutes": def("safeguarding", "Escalate after (minutes unacknowledged)", "", z.number().int().min(5).max(1440), 60),
  "safeguarding.sms_enabled": def("safeguarding", "SMS alerts", "Only works once an approved SMS provider is configured.", z.boolean(), false),

  // ── Review and publishing ───────────────────────────────────────────────
  "review.require_second_reviewer_for_ai_drafts": def("review", "Require a second reviewer", "Off at launch: one person with publish rights can approve alone. On: two different people must approve, and the last editor cannot be the only approver.", z.boolean(), false),
  "review.second_reviewer_scope": def("review", "Second reviewer applies to", "", z.enum(["ai_drafts", "all_courses"]), "ai_drafts"),

  // ── Coach ───────────────────────────────────────────────────────────────
  "coach.enabled": def("coach", "Coach enabled", "", z.boolean(), true),
  "coach.kill_switch": def("coach", "Coach kill switch", "Trips automatically at 100% of the daily spend cap. Non-AI steps keep working.", z.boolean(), false),
  "coach.daily_spend_cap_pence": def("coach", "Daily spend cap", "Admins are alerted at 80%. At 100% the kill switch trips.", pence, 2000),
  "coach.credit_value_pence": def("coach", "Value of one credit (pence)", "", z.number().positive(), 0.1),
  "coach.credit_margin": def("coach", "Margin on model cost", "", z.number().min(1), 1.3),
  "coach.rate_limits": def("coach", "Rate limits", "Messages per minute per learner, per family and per IP address, plus a global concurrency cap.", z.object({ perUserPerMin: z.number().int().positive(), perFamilyPerMin: z.number().int().positive(), perIpPerMin: z.number().int().positive(), globalConcurrency: z.number().int().positive() }), { perUserPerMin: 8, perFamilyPerMin: 20, perIpPerMin: 30, globalConcurrency: 25 }),

  // ── Course drafting ─────────────────────────────────────────────────────
  "drafting.kill_switch": def("drafting", "Drafting kill switch", "", z.boolean(), false),
  "drafting.max_cost_per_draft_pence": def("drafting", "Cost cap per draft", "", pence, 150),
  "drafting.monthly_budget_pence": def("drafting", "Monthly drafting budget", "When reached, auto-drafting pauses and admins are alerted. On-demand drafts also count unless the owner overrides.", pence, 4000),
  "drafting.monthly_draft_cap": def("drafting", "Automatic drafts per month", "", z.number().int().min(0), 20),

  // ── Radar ───────────────────────────────────────────────────────────────
  "radar.enabled": def("radar", "Tool Radar discovery", "Off until sources are configured.", z.boolean(), false),
  "radar.autodraft_enabled": def("radar", "Automatic drafting from Radar", "", z.boolean(), false),
  "radar.score_threshold": def("radar", "Draft at score", "A candidate at or above this score gets a draft course.", z.number().min(0).max(100), 70),
  "radar.score_weights": def("radar", "Score weights", "Must add up to 100.", z.object({ teenRelevance: z.number(), usefulness: z.number(), momentum: z.number(), accessibility: z.number(), safetyAndAgeFit: z.number(), longevity: z.number() }), { teenRelevance: 25, usefulness: 20, momentum: 15, accessibility: 15, safetyAndAgeFit: 15, longevity: 10 }),
  "radar.age_gate_score_cap": def("radar", "Score cap when there is no under-18 route", "", z.number().min(0).max(100), 40),

  // ── Uploads ─────────────────────────────────────────────────────────────
  "uploads.people_screening_enabled": def("uploads", "Uploads of people allowed", "Turn on only after a specialist CSAM hash-matching provider is approved and enabled. While off, evidence may not require images or video of real people, and such media is rejected.", z.boolean(), false, { ownerOnly: true, legal: true }),
  "uploads.max_mb": def("uploads", "Largest upload (MB)", "", z.object({ screenshot: z.number().positive(), file: z.number().positive(), video: z.number().positive() }), { screenshot: 10, file: 25, video: 200 }),

  // ── Launch readiness (decision D2) ──────────────────────────────────────
  "launch.readiness": def(
    "launch",
    "Launch-readiness checklist",
    "Each item records who confirmed it and when. Sign-up cannot open until all are confirmed.",
    z.record(z.string(), z.object({ confirmedBy: z.string(), confirmedAt: z.string(), note: z.string().optional() })),
    {},
    { ownerOnly: true, legal: true },
  ),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

/** The checks that must all be confirmed before `site.signup_open` can be true. */
export const LAUNCH_READINESS_ITEMS = [
  { key: "dsl_named", label: "A named, trained Designated Safeguarding Lead is recorded", auto: true },
  { key: "crisis_scripts_approved", label: "The fixed crisis scripts have been approved by the DSL", auto: false },
  { key: "processors_approved", label: "Every enabled AI, moderation, email and storage provider has an approval and a DPA on record", auto: true },
  { key: "age_assurance_confirmed", label: "The age-assurance method for 13–15 has been confirmed with legal", auto: false },
  { key: "legal_pages_published", label: "Privacy (adult and teen), terms, cookies, community code and AI use policy are published", auto: true },
  { key: "dpia_signed_off", label: "The DPIA, lawful bases and retention periods are signed off", auto: false },
  { key: "tools_verified", label: "Every tool used by a published course has verified terms in the Tool Register", auto: true },
  { key: "osa_assessed", label: "Online Safety Act scope and risk assessments are complete", auto: false },
] as const;
export type LaunchReadinessKey = (typeof LAUNCH_READINESS_ITEMS)[number]["key"];
