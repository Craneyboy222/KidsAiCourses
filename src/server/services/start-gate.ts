// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type StartBlocker =
  | { code: "course_unavailable"; message: string }
  | { code: "age_restricted"; message: string }
  | { code: "parent_blocked"; message: string }
  | { code: "not_allowed_now"; message: string; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active" }
  | { code: "entitlement_required"; message: string; ask: "unlock_paid_course" }
  | { code: "pro_approval_required"; message: string; ask: "unlock_pro_course" }
  | { code: "tool_blocked"; message: string; toolSlug: string; toolName: string }
  | { code: "tool_approval_required"; message: string; toolSlug: string; toolName: string; policy: "parent_consent_required" | "parent_operated"; status: "none" | "pending" | "declined" | "revoked"; ask: "tool_approval" }
  | { code: "tool_on_hold"; message: string; toolSlug: string; toolName: string };

export type StartDecision = { allowed: boolean; blockers: StartBlocker[] };

/**
 * Every reason a learner may not start or continue a course, in one place (spec 3.2, 3.3, Section 7):
 * the course is published and not taken down; `minAge` (hard, whatever the pathway); parent blocks on the
 * course or its category; account state, consent, cap and quiet hours; plan entitlement; Pro approval;
 * and for every required tool: approved in the Register and not blocked for this learner, a valid parent
 * approval where the policy needs one, `minAge` compatible with the tool, and no open age-policy change event.
 * A blocked main tool is satisfied by an approved fallback.
 * The same function gates direct links, enrolment, every step load and autosave.
 */
export async function checkStart(_ctx: Ctx, _learnerId: string, _courseId: string): Promise<StartDecision> {
  return notImplemented("startGate.checkStart");
}
