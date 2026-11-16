import type { StartBlocker, StartDecision } from "./start-gate";

/**
 * The start-gate decision as a pure function of the facts (spec 3.2, 3.3 and Section 7), so the
 * whole table can be tested without a database. `start-gate.ts` gathers the facts.
 */
export type ToolFacts = {
  slug: string;
  name: string;
  status: "candidate" | "pending_verification" | "approved" | "blocked" | "retired";
  under18Policy: "allowed" | "parent_consent_required" | "parent_operated" | "blocked" | null;
  /** Minimum age under the vendor's terms. Null means nobody has verified it. */
  minAge: number | null;
  /** An open change event that tightens, or may tighten, the tool's age policy. */
  onHold: boolean;
};

export type ApprovalFacts = { status: "pending" | "approved" | "declined" | "revoked"; parentOperatedConfirmed: boolean };

export type RequiredToolFacts = { tool: ToolFacts; fallback: ToolFacts | null };

export type NotAllowedNow = { reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active"; message: string };

export type StartFacts = {
  /** Null when the course does not exist. */
  course: { live: boolean; minAge: number } | null;
  learnerAge: number;
  /** A parent has blocked this course or its category. */
  parentBlocked: boolean;
  notAllowedNow: NotAllowedNow | null;
  /** The family's plan covers this course (free courses always are). */
  entitled: boolean;
  /** The course is Pro level, the parent asks to approve those, and has not approved this one. */
  proApprovalMissing: boolean;
  tools: readonly RequiredToolFacts[];
  /** The parent's approval for this learner and course, by tool slug. */
  approvals: Readonly<Record<string, ApprovalFacts | undefined>>;
};

export const START_MESSAGES = {
  course_unavailable: "This course isn't available at the moment.",
  age_restricted: "This course isn't available for your age group yet.",
  parent_blocked: "This course isn't available on your account.",
  entitlement_required: "This course needs a parent or carer to unlock it.",
  pro_approval_required: "This is a Pro course, and your parent or carer has asked to say yes to those first.",
} as const;

type ToolResult = { ok: true } | { ok: false; blocker: Extract<StartBlocker, { toolSlug: string }> };

const ADULT_AGE = 18;

/** True when the parent's recorded approval still covers the tool's policy as it is today. */
export function approvalIsValid(policy: ToolFacts["under18Policy"], approval: ApprovalFacts | undefined): boolean {
  if (!approval || approval.status !== "approved") return false;
  // A tool that has since become parent-operated needs the parent to confirm they will run the account.
  return policy !== "parent_operated" || approval.parentOperatedConfirmed;
}

function approvalMessage(tool: ToolFacts, policy: "parent_consent_required" | "parent_operated", status: "none" | "pending" | "declined" | "revoked"): string {
  switch (status) {
    case "pending":
      return `We've asked your parent or carer about ${tool.name}. You can start as soon as they say yes.`;
    case "declined":
      return `Your parent or carer said no to ${tool.name} for this course. Have a chat with them if you'd like to ask again.`;
    case "revoked":
      return `Your parent or carer has switched off ${tool.name} for this course, so it's on hold. Everything you've done is saved.`;
    default:
      return policy === "parent_operated"
        ? `${tool.name} needs a parent or carer to set it up and run the account. Ask them to approve it for this course.`
        : `A parent or carer needs to say yes to ${tool.name} before you start this course.`;
  }
}

/** One tool, for one learner. */
export function evaluateTool(tool: ToolFacts, learnerAge: number, approval: ApprovalFacts | undefined): ToolResult {
  const blocked = (message: string): ToolResult => ({ ok: false, blocker: { code: "tool_blocked", message, toolSlug: tool.slug, toolName: tool.name } });
  const unavailable = `${tool.name} isn't available to use at the moment, so this course is on hold for now.`;

  // Only a tool a person has approved in the Register, with a policy and a minimum age on record, is usable.
  if (tool.status !== "approved" || tool.under18Policy === null || tool.minAge === null) return blocked(unavailable);

  const under18 = learnerAge < ADULT_AGE;
  if (under18 && tool.under18Policy === "blocked") return blocked(`${tool.name} is for adults only, so this course isn't open to you yet.`);

  // With a parent-operated account the parent is the vendor's customer, so the vendor's minimum age is theirs to meet.
  const parentRuns = under18 && tool.under18Policy === "parent_operated";
  if (!parentRuns && learnerAge < tool.minAge) return blocked(`${tool.name} is for ages ${tool.minAge} and over, so this course isn't open to you yet.`);

  if (tool.onHold) {
    return {
      ok: false,
      blocker: { code: "tool_on_hold", message: `We're re-checking the rules for ${tool.name}, so this course is paused for a short while. Everything you've done is saved.`, toolSlug: tool.slug, toolName: tool.name },
    };
  }

  if (under18 && (tool.under18Policy === "parent_consent_required" || tool.under18Policy === "parent_operated") && !approvalIsValid(tool.under18Policy, approval)) {
    // An approval given under an older, looser policy counts as not yet asked.
    const status = !approval || approval.status === "approved" ? "none" : approval.status;
    return {
      ok: false,
      blocker: { code: "tool_approval_required", message: approvalMessage(tool, tool.under18Policy, status), toolSlug: tool.slug, toolName: tool.name, policy: tool.under18Policy, status, ask: "tool_approval" },
    };
  }
  return { ok: true };
}

/**
 * A required tool with its fallback. A main tool that is BLOCKED for this learner is satisfied by
 * a fallback that is usable; if the fallback needs something (an approval, or it is on hold) that
 * is what the learner is told. A main tool that only needs approval, or is on hold, is not
 * replaced: the learner waits for it.
 */
export function evaluateRequiredTool(entry: RequiredToolFacts, learnerAge: number, approvals: StartFacts["approvals"]): ToolResult {
  const main = evaluateTool(entry.tool, learnerAge, approvals[entry.tool.slug]);
  if (main.ok || main.blocker.code !== "tool_blocked" || !entry.fallback) return main;
  const fallback = evaluateTool(entry.fallback, learnerAge, approvals[entry.fallback.slug]);
  if (fallback.ok) return fallback;
  return fallback.blocker.code === "tool_blocked" ? main : fallback;
}

/** The tool a learner will actually use for a requirement: the main one, or the fallback when the main one is blocked. */
export function toolInUse(entry: RequiredToolFacts, learnerAge: number, approvals: StartFacts["approvals"]): ToolFacts {
  const main = evaluateTool(entry.tool, learnerAge, approvals[entry.tool.slug]);
  if (main.ok || main.blocker.code !== "tool_blocked" || !entry.fallback) return entry.tool;
  const fallback = evaluateTool(entry.fallback, learnerAge, approvals[entry.fallback.slug]);
  return fallback.ok || fallback.blocker.code !== "tool_blocked" ? entry.fallback : entry.tool;
}

export function decideStart(facts: StartFacts): StartDecision {
  const done = (blockers: StartBlocker[]): StartDecision => ({ allowed: blockers.length === 0, blockers });

  if (!facts.course || !facts.course.live) return done([{ code: "course_unavailable", message: START_MESSAGES.course_unavailable }]);

  // A course the learner must not see says nothing else about itself: no tool names, no plan.
  const hidden: StartBlocker[] = [];
  if (facts.learnerAge < facts.course.minAge) hidden.push({ code: "age_restricted", message: START_MESSAGES.age_restricted });
  if (facts.parentBlocked) hidden.push({ code: "parent_blocked", message: START_MESSAGES.parent_blocked });
  if (hidden.length > 0) return done(hidden);

  const blockers: StartBlocker[] = [];
  if (facts.notAllowedNow) blockers.push({ code: "not_allowed_now", message: facts.notAllowedNow.message, reason: facts.notAllowedNow.reason });
  if (!facts.entitled) blockers.push({ code: "entitlement_required", message: START_MESSAGES.entitlement_required, ask: "unlock_paid_course" });
  if (facts.proApprovalMissing) blockers.push({ code: "pro_approval_required", message: START_MESSAGES.pro_approval_required, ask: "unlock_pro_course" });
  for (const entry of facts.tools) {
    const result = evaluateRequiredTool(entry, facts.learnerAge, facts.approvals);
    if (!result.ok) blockers.push(result.blocker);
  }
  return done(blockers);
}
