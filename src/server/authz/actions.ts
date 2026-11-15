import type { StaffRole } from "./actor";

/**
 * The authorisation matrix. Every permission check in the product goes through
 * `can()` with one of these actions. Add new actions here; never write an ad-hoc role check.
 *
 *   learner: "self"   — a learner may do this to their own records (resource.learnerId === actor.userId)
 *   parent:  "family" — a parent may do this inside their own family (resource.familyId === actor.familyId)
 *   staff:   roles    — any listed role may do this (super_admin always may, except where `superAdmin: false`)
 *   anonymous         — allowed when signed out
 *   whilePaused       — still allowed when the learner's or parent's account is paused or pending
 *
 * Background jobs run as the `system` actor, which may perform any action that is not `humanOnly`.
 */
export type Rule = {
  learner?: "self";
  parent?: "family";
  staff?: readonly StaffRole[];
  anonymous?: true;
  whilePaused?: true;
  /** Never allowed for the system actor: these must carry a human's name (spec 3.9, 6.3). */
  humanOnly?: true;
};

const CONTENT: readonly StaffRole[] = ["editor", "reviewer", "safety_reviewer", "admin"];
const REVIEW: readonly StaffRole[] = ["reviewer", "safety_reviewer", "admin"];
const MODERATION: readonly StaffRole[] = ["moderator", "dsl", "admin"];
const PEOPLE: readonly StaffRole[] = ["support", "admin"];
const ADMIN: readonly StaffRole[] = ["admin"];
const ANY_STAFF: readonly StaffRole[] = ["editor", "reviewer", "safety_reviewer", "moderator", "dsl", "support", "admin"];
const TAKE_DOWN: readonly StaffRole[] = ["editor", "reviewer", "safety_reviewer", "moderator", "dsl", "admin"];

export const ACTIONS = {
  // ── Public ────────────────────────────────────────────────────────────────
  "public.catalogue.read": { anonymous: true, learner: "self", parent: "family", staff: ANY_STAFF, whilePaused: true },
  "public.certificate.verify": { anonymous: true, learner: "self", parent: "family", staff: ANY_STAFF, whilePaused: true },
  "signup.parent": { anonymous: true },
  "signup.teen": { anonymous: true },
  "signup.approve_teen": { anonymous: true, parent: "family" },

  // ── Learner's own things (parents see their own children; staff by role) ──
  "learner.profile.read": { learner: "self", parent: "family", staff: PEOPLE, whilePaused: true },
  "learner.profile.update": { learner: "self" },
  "learner.settings.update": { learner: "self", whilePaused: true },
  "learner.catalogue.read": { learner: "self" },
  "learner.course.start": { learner: "self" },
  "learner.progress.read": { learner: "self", parent: "family", staff: PEOPLE },
  "learner.progress.write": { learner: "self" },
  "learner.quiz.attempt": { learner: "self" },
  "learner.wishlist.write": { learner: "self" },
  "learner.unlock.request": { learner: "self" },
  "learner.submission.create": { learner: "self" },
  "learner.portfolio.read": { learner: "self", parent: "family", staff: MODERATION },
  "learner.artefact.download": { learner: "self", parent: "family", staff: MODERATION },
  "learner.certificate.read": { learner: "self", parent: "family", staff: PEOPLE },
  "learner.coach.chat": { learner: "self" },
  "learner.coach.history.read": { learner: "self" }, // parents get counts and topics only (spec 3.6)
  "learner.coach.summary.read": { learner: "self", parent: "family" },
  "learner.notification.read": { learner: "self", whilePaused: true },
  "learner.usage.heartbeat": { learner: "self" },
  "report.create": { learner: "self", parent: "family", staff: ANY_STAFF, whilePaused: true },
  "report.read_own": { learner: "self", parent: "family", whilePaused: true },

  // ── Parent, inside their own family ───────────────────────────────────────
  "family.read": { parent: "family", staff: PEOPLE, whilePaused: true },
  "family.child.add": { parent: "family" },
  "family.child.remove": { parent: "family", staff: PEOPLE },
  "family.child.reset_password": { parent: "family", staff: PEOPLE },
  "family.child.invite": { parent: "family" },
  "family.controls.read": { parent: "family", staff: PEOPLE, whilePaused: true },
  "family.controls.update": { parent: "family", whilePaused: true },
  "family.child.pause": { parent: "family", staff: PEOPLE, whilePaused: true },
  "family.consent.read": { parent: "family", staff: PEOPLE, whilePaused: true },
  "family.consent.update": { parent: "family", whilePaused: true },
  "family.approval.decide": { parent: "family" },
  "family.tool_approval.decide": { parent: "family" },
  "family.billing.manage": { parent: "family", learner: "self", whilePaused: true }, // learner only when adult_18: checked in the service
  "family.data.export": { parent: "family", learner: "self", whilePaused: true },
  "family.data.delete": { parent: "family", learner: "self", whilePaused: true },
  "family.notice.read": { parent: "family", whilePaused: true },
  "family.settings.update": { parent: "family", whilePaused: true },

  // ── Studio: content ───────────────────────────────────────────────────────
  "studio.access": { staff: ANY_STAFF },
  "course.read_draft": { staff: CONTENT },
  "course.edit": { staff: ["editor", "admin"] },
  "course.submit_for_review": { staff: ["editor", "admin"] },
  "course.review": { staff: REVIEW, humanOnly: true },
  "course.review_safeguarding": { staff: ["safety_reviewer", "admin"], humanOnly: true },
  "course.publish": { staff: REVIEW, humanOnly: true },
  "course.take_down": { staff: TAKE_DOWN },
  "course.preview": { staff: CONTENT },
  "course.generate": { staff: ["editor", "admin"] },
  "course.request_edits": { staff: CONTENT },
  "idea.manage": { staff: ["editor", "admin"] },
  "asset.manage": { staff: ["editor", "admin"] },
  "tool.read": { staff: ANY_STAFF },
  "tool.edit": { staff: ["editor", "admin"] },
  "tool.approve": { staff: REVIEW, humanOnly: true },
  "radar.read": { staff: CONTENT },
  "radar.manage": { staff: ["editor", "admin"] },
  "radar.configure": { staff: ADMIN },
  "tool_change.triage": { staff: CONTENT, humanOnly: true },

  // ── Studio: safety ────────────────────────────────────────────────────────
  "moderation.read": { staff: MODERATION },
  "moderation.decide": { staff: MODERATION, humanOnly: true },
  "enforcement.apply": { staff: ["moderator", "dsl", "admin"] },
  "safeguarding.case.list": { staff: ["dsl"] },
  /** Break-glass: reading notes always needs a reason and writes an access log, even for the owner. */
  "safeguarding.case.read_notes": { staff: ["dsl"], humanOnly: true },
  "safeguarding.case.update": { staff: ["dsl"], humanOnly: true },
  "safeguarding.case.create": { staff: ["moderator", "dsl", "support", "admin"] },

  // ── Studio: people and business ───────────────────────────────────────────
  "user.read": { staff: PEOPLE },
  "user.manage": { staff: PEOPLE }, // reset password, lock, unlock, pause
  "user.ban": { staff: ADMIN },
  "support.ticket.manage": { staff: PEOPLE },
  "plan.manage": { staff: ADMIN },
  "promo.manage": { staff: ADMIN },
  "billing.exception": { staff: ADMIN },
  "page.manage": { staff: ["editor", "admin"] },
  "email_template.manage": { staff: ADMIN },

  // ── Studio: system ────────────────────────────────────────────────────────
  "ai.settings.manage": { staff: ADMIN },
  "flag.manage": { staff: ADMIN },
  "setting.manage": { staff: ADMIN },
  "audit.read": { staff: ADMIN },
  "analytics.read": { staff: ["admin", "editor", "reviewer"] },
  "staff.invite": { staff: ADMIN },
  /** Granting admin, dsl or super_admin is for the owner alone (spec 3.8). */
  "staff.grant_privileged": { staff: [], humanOnly: true },
  "launch_readiness.manage": { staff: [], humanOnly: true },
} as const satisfies Record<string, Rule>;

export type Action = keyof typeof ACTIONS;
