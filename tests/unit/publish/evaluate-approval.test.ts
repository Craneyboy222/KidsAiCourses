import { describe, expect, it } from "vitest";
import {
  PUBLISH_ROLES,
  SAFEGUARDING_APPROVER_ROLES,
  evaluateApproval,
  secondReviewerApplies,
  type ApprovalDecisionInput,
  type ApprovalInput,
} from "@/server/services/publish-rules";

const OWNER = "owner";
const REVIEWER = "reviewer";
const SAFETY = "safety";
const EDITOR = "editor";

function decision(reviewerId: string, overrides: Partial<ApprovalDecisionInput> = {}): ApprovalDecisionInput {
  const roles: Record<string, string[]> = {
    [OWNER]: ["super_admin"],
    [REVIEWER]: ["reviewer"],
    [SAFETY]: ["safety_reviewer"],
    [EDITOR]: ["editor"],
  };
  return {
    reviewerId,
    kind: "approve",
    roles: roles[reviewerId] ?? ["reviewer"],
    wasLastEditor: false,
    toolClaimsChecked: true,
    usesExternalTool: true,
    ...overrides,
  };
}

function input(overrides: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    requireSecondReviewer: false,
    scope: "ai_drafts",
    origin: "hand_made",
    safeguardingSensitive: false,
    decisions: [],
    lastEditorId: null,
    ...overrides,
  };
}

type Case = {
  name: string;
  given: Partial<ApprovalInput>;
  approved: boolean;
  missing?: RegExp;
  warning?: RegExp;
};

const cases: Case[] = [
  // ── There must always be a human approval for this version ──
  { name: "no decisions at all", given: {}, approved: false, missing: /No human approval/ },
  {
    name: "no decisions, setting on",
    given: { requireSecondReviewer: true, scope: "all_courses" },
    approved: false,
    missing: /No human approval/,
  },
  {
    name: "no decisions on an AI draft",
    given: { origin: "ai_radar" },
    approved: false,
    missing: /No human approval/,
  },
  {
    name: "only a request for edits",
    given: { decisions: [decision(REVIEWER, { kind: "request_edits" })] },
    approved: false,
    missing: /asked for edits/,
  },
  {
    name: "only a decline",
    given: { decisions: [decision(REVIEWER, { kind: "decline" })] },
    approved: false,
    missing: /declined/,
  },

  // ── Setting off (launch default) ──
  {
    name: "sole owner approval, setting off, hand-made",
    given: { decisions: [decision(OWNER)] },
    approved: true,
  },
  {
    name: "sole owner approval, setting off, AI draft",
    given: { origin: "ai_on_demand", decisions: [decision(OWNER)] },
    approved: true,
  },
  { name: "a reviewer alone, setting off", given: { decisions: [decision(REVIEWER)] }, approved: true },
  {
    name: "the owner who was also the last editor, setting off",
    given: { lastEditorId: OWNER, decisions: [decision(OWNER, { wasLastEditor: true })] },
    approved: true,
    warning: /also the last person who edited/,
  },
  {
    name: "an approval from someone whose role cannot publish does not count",
    given: { decisions: [decision(EDITOR)] },
    approved: false,
    missing: /role may not publish/,
  },
  {
    name: "an approval with no roles recorded does not count",
    given: { decisions: [decision(REVIEWER, { roles: [] })] },
    approved: false,
    missing: /role may not publish/,
  },

  // ── Tool claims ──
  {
    name: "AI draft approved without toolClaimsChecked",
    given: {
      origin: "ai_radar",
      decisions: [decision(OWNER, { toolClaimsChecked: false, usesExternalTool: false })],
    },
    approved: false,
    missing: /AI draft does not confirm that tool claims were checked/,
  },
  {
    name: "hand-made course that uses an external tool, approved without toolClaimsChecked",
    given: { decisions: [decision(OWNER, { toolClaimsChecked: false, usesExternalTool: true })] },
    approved: false,
    missing: /uses an external tool, does not confirm/,
  },
  {
    name: "hand-made course with no external tool needs no tool-claims confirmation",
    given: { decisions: [decision(OWNER, { toolClaimsChecked: false, usesExternalTool: false })] },
    approved: true,
  },
  {
    name: "an approval without the tool check blocks, even when another approval has it",
    given: { decisions: [decision(OWNER, { toolClaimsChecked: false }), decision(REVIEWER)] },
    approved: false,
    missing: /does not confirm/,
  },

  // ── Setting on ──
  {
    name: "setting on (ai_drafts), AI draft, one approver",
    given: { requireSecondReviewer: true, origin: "ai_radar", decisions: [decision(OWNER)] },
    approved: false,
    missing: /Two different people must approve/,
  },
  {
    name: "setting on (ai_drafts), AI draft, two different approvers",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      decisions: [decision(OWNER), decision(REVIEWER)],
    },
    approved: true,
  },
  {
    name: "setting on, two approvals by the same person",
    given: { requireSecondReviewer: true, origin: "ai_radar", decisions: [decision(OWNER), decision(OWNER)] },
    approved: false,
    missing: /Two different people must approve/,
  },
  {
    name: "setting on, the last editor is the only approver",
    given: {
      requireSecondReviewer: true,
      origin: "ai_on_demand",
      lastEditorId: OWNER,
      decisions: [decision(OWNER, { wasLastEditor: true })],
    },
    approved: false,
    missing: /last editor cannot be the only approver/,
  },
  {
    name: "setting on, the last editor (known only from lastEditorId) is the only approver",
    given: {
      requireSecondReviewer: true,
      origin: "ai_on_demand",
      lastEditorId: REVIEWER,
      decisions: [decision(REVIEWER)],
    },
    approved: false,
    missing: /last editor cannot be the only approver/,
  },
  {
    name: "setting on, the last editor plus one other person",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      lastEditorId: OWNER,
      decisions: [decision(OWNER, { wasLastEditor: true }), decision(REVIEWER)],
    },
    approved: true,
  },
  {
    name: "setting on, second approval comes from a role that cannot publish",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      decisions: [decision(OWNER), decision(EDITOR)],
    },
    approved: false,
    missing: /Two different people must approve/,
  },

  // ── Scope ──
  {
    name: "scope ai_drafts does not apply to a hand-made course: one approver is enough",
    given: {
      requireSecondReviewer: true,
      scope: "ai_drafts",
      origin: "hand_made",
      decisions: [decision(OWNER)],
    },
    approved: true,
  },
  {
    name: "scope all_courses applies to a hand-made course: one approver is not enough",
    given: {
      requireSecondReviewer: true,
      scope: "all_courses",
      origin: "hand_made",
      decisions: [decision(OWNER)],
    },
    approved: false,
    missing: /Two different people must approve/,
  },
  {
    name: "scope all_courses, hand-made course, two approvers",
    given: {
      requireSecondReviewer: true,
      scope: "all_courses",
      origin: "hand_made",
      decisions: [decision(OWNER), decision(REVIEWER)],
    },
    approved: true,
  },
  {
    name: "scope all_courses with the setting off changes nothing",
    given: {
      requireSecondReviewer: false,
      scope: "all_courses",
      origin: "ai_radar",
      decisions: [decision(OWNER)],
    },
    approved: true,
  },

  // ── Safeguarding-sensitive ──
  {
    name: "setting on, safeguarding-sensitive, two approvers but no safety reviewer",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      safeguardingSensitive: true,
      decisions: [decision(OWNER), decision(REVIEWER)],
    },
    approved: false,
    missing: /must be a safety reviewer/,
  },
  {
    name: "setting on, safeguarding-sensitive, one of the two is a safety reviewer",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      safeguardingSensitive: true,
      decisions: [decision(OWNER), decision(SAFETY)],
    },
    approved: true,
  },
  {
    name: "setting on, safeguarding-sensitive, a safety reviewer alone is still one person",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      safeguardingSensitive: true,
      decisions: [decision(SAFETY)],
    },
    approved: false,
    missing: /Two different people must approve/,
  },
  {
    name: "setting off, safeguarding-sensitive, single approver without the confirmation",
    given: { safeguardingSensitive: true, decisions: [decision(OWNER)] },
    approved: false,
    missing: /must confirm that they are approving it alone/,
  },
  {
    name: "setting off, safeguarding-sensitive, single approver with the confirmation",
    given: {
      safeguardingSensitive: true,
      decisions: [decision(OWNER, { confirmedSafeguardingSoloApproval: true })],
    },
    approved: true,
    warning: /safeguarding-sensitive course is being approved by one person/,
  },
  {
    name: "setting off, safeguarding-sensitive, two approvers need no solo confirmation",
    given: { safeguardingSensitive: true, decisions: [decision(OWNER), decision(REVIEWER)] },
    approved: true,
  },
  {
    name: "the solo confirmation on a course that is not sensitive is harmless",
    given: { decisions: [decision(OWNER, { confirmedSafeguardingSoloApproval: true })] },
    approved: true,
  },

  // ── Each reviewer's latest decision is the one that counts ──
  {
    name: "approve then decline by the same person",
    given: { decisions: [decision(OWNER), decision(OWNER, { kind: "decline" })] },
    approved: false,
    missing: /declined/,
  },
  {
    name: "request edits then approve by the same person",
    given: { decisions: [decision(OWNER, { kind: "request_edits" }), decision(OWNER)] },
    approved: true,
  },
  {
    name: "one person approves, another asks for edits",
    given: { decisions: [decision(OWNER), decision(REVIEWER, { kind: "request_edits" })] },
    approved: false,
    missing: /asked for edits/,
  },
  {
    name: "two approvals, then one of the two declines (setting on)",
    given: {
      requireSecondReviewer: true,
      origin: "ai_radar",
      decisions: [decision(OWNER), decision(REVIEWER), decision(REVIEWER, { kind: "decline" })],
    },
    approved: false,
    missing: /declined/,
  },
];

describe("evaluateApproval", () => {
  it.each(cases)("$name → approved: $approved", ({ given, approved, missing, warning }) => {
    const result = evaluateApproval(input(given));
    expect(result.approved).toBe(approved);
    if (approved) expect(result.missing).toEqual([]);
    else expect(result.missing.length).toBeGreaterThan(0);
    if (missing) expect(result.missing.join(" | ")).toMatch(missing);
    if (warning) expect(result.warnings.join(" | ")).toMatch(warning);
  });

  it("is never approved without an approve decision, whatever the settings", () => {
    for (const requireSecondReviewer of [true, false]) {
      for (const scope of ["ai_drafts", "all_courses"] as const) {
        for (const origin of ["hand_made", "ai_radar", "ai_on_demand"] as const) {
          for (const safeguardingSensitive of [true, false]) {
            for (const decisions of [
              [],
              [decision(OWNER, { kind: "decline" })],
              [decision(OWNER, { kind: "request_edits" })],
            ]) {
              const result = evaluateApproval(
                input({ requireSecondReviewer, scope, origin, safeguardingSensitive, decisions }),
              );
              expect(result.approved).toBe(false);
              expect(result.missing.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it("names everything that is missing at once", () => {
    const result = evaluateApproval(
      input({
        requireSecondReviewer: true,
        scope: "all_courses",
        safeguardingSensitive: true,
        lastEditorId: OWNER,
        decisions: [decision(OWNER, { wasLastEditor: true })],
      }),
    );
    expect(result.approved).toBe(false);
    expect(result.missing).toHaveLength(3);
    expect(result.missing.join(" ")).toMatch(/Two different people/);
    expect(result.missing.join(" ")).toMatch(/last editor/);
    expect(result.missing.join(" ")).toMatch(/safety reviewer/);
  });

  it("does not change its input", () => {
    const decisions = Object.freeze([Object.freeze(decision(OWNER)), Object.freeze(decision(REVIEWER))]);
    const given = Object.freeze(input({ decisions }));
    expect(() => evaluateApproval(given)).not.toThrow();
  });

  it("takes publish rights from the authorisation matrix, and the safety role by name", () => {
    expect([...PUBLISH_ROLES].sort()).toEqual(["admin", "reviewer", "safety_reviewer", "super_admin"]);
    expect(SAFEGUARDING_APPROVER_ROLES).toEqual(["safety_reviewer"]);
  });

  it("secondReviewerApplies follows the setting and the scope", () => {
    expect(
      secondReviewerApplies({ requireSecondReviewer: false, scope: "all_courses", origin: "ai_radar" }),
    ).toBe(false);
    expect(
      secondReviewerApplies({ requireSecondReviewer: true, scope: "ai_drafts", origin: "hand_made" }),
    ).toBe(false);
    expect(
      secondReviewerApplies({ requireSecondReviewer: true, scope: "ai_drafts", origin: "ai_on_demand" }),
    ).toBe(true);
    expect(
      secondReviewerApplies({ requireSecondReviewer: true, scope: "all_courses", origin: "hand_made" }),
    ).toBe(true);
  });
});
