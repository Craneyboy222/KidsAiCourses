/**
 * The approval rule for publishing a course version (spec 6.3, "Approval rule (configurable)").
 *
 * This file is PURE: no database, no clock, no settings lookup. `publish.ts` gathers the facts and
 * calls `evaluateApproval`; the unit test in `tests/unit/publish/evaluate-approval.test.ts` covers
 * every branch. Nothing is ever published unless this function returns `approved: true`.
 */
import { ACTIONS } from "@/server/authz/actions";
import type { StaffRole } from "@/server/authz/actor";

export type ApprovalDecisionKind = "approve" | "request_edits" | "decline";
export type ApprovalScope = "ai_drafts" | "all_courses";
export type ApprovalOrigin = "hand_made" | "ai_radar" | "ai_on_demand";

export interface ApprovalDecisionInput {
  reviewerId: string;
  kind: ApprovalDecisionKind;
  /** The staff roles the reviewer held when the decision was recorded. */
  roles: readonly string[];
  /** True when the reviewer was also the last person to edit this version. */
  wasLastEditor: boolean;
  /** The reviewer confirmed that tool-specific claims were checked against the live tool. */
  toolClaimsChecked: boolean;
  /** True when the version lists at least one external tool. */
  usesExternalTool: boolean;
  /** The reviewer confirmed the warning shown before approving a safeguarding-sensitive course alone. */
  confirmedSafeguardingSoloApproval?: boolean;
}

export interface ApprovalInput {
  /** Site setting `review.require_second_reviewer_for_ai_drafts`. */
  requireSecondReviewer: boolean;
  /** Site setting `review.second_reviewer_scope`. */
  scope: ApprovalScope;
  origin: ApprovalOrigin;
  safeguardingSensitive: boolean;
  /** Every decision recorded for THIS version, oldest first. Decisions for other versions never count. */
  decisions: readonly ApprovalDecisionInput[];
  /** Whoever last changed the content, or null for an untouched AI draft. */
  lastEditorId: string | null;
}

export interface ApprovalEvaluation {
  approved: boolean;
  /** Plain-English reasons the version cannot be published yet. Empty when `approved` is true. */
  missing: string[];
  /** Things a reviewer should know that do not block publishing. */
  warnings: string[];
}

/** Roles that may publish, taken from the one authorisation matrix (`course.publish`), plus the owner. */
export const PUBLISH_ROLES: readonly StaffRole[] = [...ACTIONS["course.publish"].staff, "super_admin"];

/**
 * The role that counts as the safety reviewer on a safeguarding-sensitive course when two people
 * must approve. Deliberately the named role only: an `admin` or the owner counts only if they also
 * hold `safety_reviewer` (the stricter reading; see docs/OPEN_QUESTIONS.md).
 */
export const SAFEGUARDING_APPROVER_ROLES: readonly StaffRole[] = ["safety_reviewer"];

export const isAiOrigin = (origin: string): boolean => origin === "ai_radar" || origin === "ai_on_demand";

const holdsAny = (roles: readonly string[], wanted: readonly string[]): boolean =>
  roles.some((role) => wanted.includes(role));

/** True when the second-reviewer setting applies to a course of this origin. */
export function secondReviewerApplies(input: Pick<ApprovalInput, "requireSecondReviewer" | "scope" | "origin">): boolean {
  if (!input.requireSecondReviewer) return false;
  return input.scope === "all_courses" || isAiOrigin(input.origin);
}

/**
 * Decides whether a version has the human approval it needs.
 *
 * - There must always be at least one human `approve` decision for this version.
 * - Each reviewer's most recent decision is the one that counts. A reviewer whose latest decision
 *   is `request_edits` or `decline` blocks the version: it needs a new revision, and a new revision
 *   needs new approval.
 * - An approval counts only if the reviewer held a role with publish rights, and, for an AI draft or
 *   a course that uses an external tool, confirmed that tool claims were checked.
 * - Setting off (or not in scope): one counted approval is enough, including the owner alone and
 *   including the last editor. A safeguarding-sensitive course approved by one person needs that
 *   person's explicit confirmation.
 * - Setting on and in scope: two different people must approve, the last editor cannot be the only
 *   approver, and a safeguarding-sensitive course needs one approver who is a safety reviewer.
 */
export function evaluateApproval(input: ApprovalInput): ApprovalEvaluation {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Latest decision per reviewer, keeping the order of each reviewer's latest decision.
  const latest = new Map<string, ApprovalDecisionInput>();
  for (const decision of input.decisions) {
    latest.delete(decision.reviewerId);
    latest.set(decision.reviewerId, decision);
  }
  const current = [...latest.values()];

  const declined = current.filter((decision) => decision.kind === "decline");
  const editsRequested = current.filter((decision) => decision.kind === "request_edits");
  if (declined.length > 0) {
    missing.push("A reviewer declined this version. It cannot be published; make a new revision and have it approved.");
  }
  if (editsRequested.length > 0) {
    missing.push("A reviewer asked for edits to this version. Make a new revision and have it approved.");
  }

  const approvals = current.filter((decision) => decision.kind === "approve");
  if (approvals.length === 0) {
    missing.push("No human approval is recorded for this version.");
    return { approved: false, missing, warnings };
  }

  const ai = isAiOrigin(input.origin);
  const counted: ApprovalDecisionInput[] = [];
  let withoutRights = 0;
  let withoutToolCheck = 0;
  for (const approval of approvals) {
    if (!holdsAny(approval.roles, PUBLISH_ROLES)) {
      withoutRights += 1;
      continue;
    }
    if ((ai || approval.usesExternalTool) && !approval.toolClaimsChecked) {
      withoutToolCheck += 1;
      continue;
    }
    counted.push(approval);
  }
  if (withoutRights > 0) {
    missing.push("An approval was recorded by someone whose role may not publish, so it does not count.");
  }
  if (withoutToolCheck > 0) {
    missing.push(
      ai
        ? "An approval of this AI draft does not confirm that tool claims were checked against the live tool."
        : "An approval of this course, which uses an external tool, does not confirm that tool claims were checked against the live tool.",
    );
  }
  if (counted.length === 0) {
    if (withoutRights === 0 && withoutToolCheck === 0) missing.push("No human approval is recorded for this version.");
    return { approved: false, missing, warnings };
  }

  const isLastEditor = (approval: ApprovalDecisionInput): boolean =>
    approval.wasLastEditor || (input.lastEditorId !== null && approval.reviewerId === input.lastEditorId);

  if (secondReviewerApplies(input)) {
    if (counted.length < 2) {
      missing.push(
        `Two different people must approve this version; ${counted.length === 1 ? "one has" : "none has"} so far.`,
      );
    }
    if (counted.every(isLastEditor)) {
      missing.push("The last editor cannot be the only approver. Someone who did not make the last edit must approve.");
    }
    if (input.safeguardingSensitive && !counted.some((approval) => holdsAny(approval.roles, SAFEGUARDING_APPROVER_ROLES))) {
      missing.push("This course is safeguarding-sensitive, so one of the two approvers must be a safety reviewer.");
    }
  } else {
    if (counted.length === 1) {
      const [only] = counted;
      if (input.safeguardingSensitive && only?.confirmedSafeguardingSoloApproval !== true) {
        missing.push(
          "This course is safeguarding-sensitive. The single approver must confirm that they are approving it alone.",
        );
      }
      if (input.safeguardingSensitive) {
        warnings.push("A safeguarding-sensitive course is being approved by one person.");
      }
      if (only && isLastEditor(only)) {
        warnings.push("The only approver is also the last person who edited this version.");
      }
    }
  }

  return { approved: missing.length === 0, missing, warnings };
}
