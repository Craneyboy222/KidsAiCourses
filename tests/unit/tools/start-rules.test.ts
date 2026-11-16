import { describe, expect, it } from "vitest";
import { approvalIsValid, decideStart, evaluateRequiredTool, evaluateTool, toolInUse, type StartFacts, type ToolFacts } from "@/server/services/start-rules";

const tool = (overrides: Partial<ToolFacts> = {}): ToolFacts => ({ slug: "replit", name: "Replit", status: "approved", under18Policy: "allowed", minAge: 13, onHold: false, ...overrides });
const fallback = (overrides: Partial<ToolFacts> = {}): ToolFacts => tool({ slug: "base44", name: "Base44", ...overrides });

const facts = (overrides: Partial<StartFacts> = {}): StartFacts => ({
  course: { live: true, minAge: 13 },
  learnerAge: 14,
  parentBlocked: false,
  notAllowedNow: null,
  entitled: true,
  proApprovalMissing: false,
  tools: [{ tool: tool(), fallback: null }],
  approvals: {},
  ...overrides,
});

const codes = (input: StartFacts) => decideStart(input).blockers.map((blocker) => blocker.code);
const approved = { status: "approved", parentOperatedConfirmed: false } as const;

describe("decideStart: the decision table", () => {
  it("allows a learner with nothing in the way", () => {
    expect(decideStart(facts())).toEqual({ allowed: true, blockers: [] });
    expect(decideStart(facts({ tools: [] }))).toEqual({ allowed: true, blockers: [] });
  });

  const table: [string, Partial<StartFacts>, string[]][] = [
    ["a course that does not exist", { course: null }, ["course_unavailable"]],
    ["a course that is not live (unpublished or taken down)", { course: { live: false, minAge: 13 } }, ["course_unavailable"]],
    ["a learner below the course's minimum age", { course: { live: true, minAge: 16 }, learnerAge: 15 }, ["age_restricted"]],
    ["a course or category a parent has blocked", { parentBlocked: true }, ["parent_blocked"]],
    ["a paused account", { notAllowedNow: { reason: "paused", message: "Paused." } }, ["not_allowed_now"]],
    ["a missing required consent", { notAllowedNow: { reason: "consent", message: "Consent." } }, ["not_allowed_now"]],
    ["the daily cap", { notAllowedNow: { reason: "time_cap", message: "Cap." } }, ["not_allowed_now"]],
    ["quiet hours", { notAllowedNow: { reason: "quiet_hours", message: "Quiet." } }, ["not_allowed_now"]],
    ["an account that is not active", { notAllowedNow: { reason: "not_active", message: "Off." } }, ["not_allowed_now"]],
    ["a paid course the plan does not cover", { entitled: false }, ["entitlement_required"]],
    ["a Pro course awaiting a parent's say-so", { proApprovalMissing: true }, ["pro_approval_required"]],
    ["a tool still waiting to be verified", { tools: [{ tool: tool({ status: "pending_verification" }), fallback: null }] }, ["tool_blocked"]],
    ["a candidate tool", { tools: [{ tool: tool({ status: "candidate", under18Policy: null, minAge: null }), fallback: null }] }, ["tool_blocked"]],
    ["a tool blocked in the Register", { tools: [{ tool: tool({ status: "blocked" }), fallback: null }] }, ["tool_blocked"]],
    ["a retired tool", { tools: [{ tool: tool({ status: "retired" }), fallback: null }] }, ["tool_blocked"]],
    ["a tool whose policy blocks under-18s", { tools: [{ tool: tool({ under18Policy: "blocked" }), fallback: null }] }, ["tool_blocked"]],
    ["a tool with no policy on record", { tools: [{ tool: tool({ under18Policy: null }), fallback: null }] }, ["tool_blocked"]],
    ["a tool with no minimum age on record", { tools: [{ tool: tool({ minAge: null }), fallback: null }] }, ["tool_blocked"]],
    ["a tool whose minimum age is above the learner's", { tools: [{ tool: tool({ minAge: 16 }), fallback: null }] }, ["tool_blocked"]],
    ["a tool with an open age-policy change", { tools: [{ tool: tool({ onHold: true }), fallback: null }] }, ["tool_on_hold"]],
    ["a tool needing consent that nobody has asked for", { tools: [{ tool: tool({ under18Policy: "parent_consent_required" }), fallback: null }] }, ["tool_approval_required"]],
    ["a parent-operated tool with no approval", { tools: [{ tool: tool({ under18Policy: "parent_operated", minAge: 18 }), fallback: null }] }, ["tool_approval_required"]],
  ];
  it.each(table)("blocks %s", (_name, overrides, expected) => {
    const decision = decideStart(facts(overrides));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.code)).toEqual(expected);
    for (const blocker of decision.blockers) expect(blocker.message.length).toBeGreaterThan(0);
  });

  it("carries the reason for a not-allowed-now blocker through unchanged", () => {
    const [blocker] = decideStart(facts({ notAllowedNow: { reason: "quiet_hours", message: "It's quiet hours until 07:00." } })).blockers;
    expect(blocker).toEqual({ code: "not_allowed_now", reason: "quiet_hours", message: "It's quiet hours until 07:00." });
  });

  it("says nothing else about a course the learner must not see", () => {
    const hidden = facts({ course: { live: true, minAge: 16 }, learnerAge: 14, entitled: false, proApprovalMissing: true, tools: [{ tool: tool({ status: "blocked" }), fallback: null }] });
    expect(codes(hidden)).toEqual(["age_restricted"]);
    expect(codes({ ...hidden, course: { live: true, minAge: 13 }, parentBlocked: true })).toEqual(["parent_blocked"]);
    expect(codes({ ...hidden, parentBlocked: true })).toEqual(["age_restricted", "parent_blocked"]);
    expect(JSON.stringify(decideStart(hidden))).not.toContain("Replit");
  });

  it("reports every open reason on a course the learner can see", () => {
    const input = facts({ notAllowedNow: { reason: "time_cap", message: "Cap." }, entitled: false, proApprovalMissing: true, tools: [{ tool: tool({ under18Policy: "parent_consent_required" }), fallback: null }, { tool: tool({ slug: "canva", name: "Canva", onHold: true }), fallback: null }] });
    expect(codes(input)).toEqual(["not_allowed_now", "entitlement_required", "pro_approval_required", "tool_approval_required", "tool_on_hold"]);
  });

  it("never mentions money to the learner", () => {
    const text = JSON.stringify(decideStart(facts({ entitled: false, proApprovalMissing: true })));
    expect(text).not.toMatch(/£|\bpay|price|subscri|plan\b|upgrade/i);
  });
});

describe("parent approval", () => {
  const consent = tool({ under18Policy: "parent_consent_required" });
  const operated = tool({ under18Policy: "parent_operated", minAge: 18 });

  it("reports where the request has got to", () => {
    const status = (approval: StartFacts["approvals"][string]) => {
      const result = evaluateTool(consent, 14, approval);
      return !result.ok && result.blocker.code === "tool_approval_required" ? result.blocker.status : "allowed";
    };
    expect(status(undefined)).toBe("none");
    expect(status({ status: "pending", parentOperatedConfirmed: false })).toBe("pending");
    expect(status({ status: "declined", parentOperatedConfirmed: false })).toBe("declined");
    expect(status({ status: "revoked", parentOperatedConfirmed: false })).toBe("revoked");
    expect(status(approved)).toBe("allowed");
  });

  it("lets an approved learner start, and stops them again once it is revoked", () => {
    expect(decideStart(facts({ tools: [{ tool: consent, fallback: null }], approvals: { replit: approved } })).allowed).toBe(true);
    expect(codes(facts({ tools: [{ tool: consent, fallback: null }], approvals: { replit: { status: "revoked", parentOperatedConfirmed: false } } }))).toEqual(["tool_approval_required"]);
  });

  it("needs the parent to confirm they will run a parent-operated account", () => {
    expect(evaluateTool(operated, 14, approved).ok).toBe(false);
    expect(evaluateTool(operated, 14, { status: "approved", parentOperatedConfirmed: true }).ok).toBe(true);
    expect(approvalIsValid("parent_operated", approved)).toBe(false);
    expect(approvalIsValid("parent_consent_required", approved)).toBe(true);
    expect(approvalIsValid("parent_consent_required", undefined)).toBe(false);
  });

  it("treats consent given under a looser policy as not yet asked once the tool becomes parent-operated", () => {
    const result = evaluateTool(operated, 14, approved);
    expect(!result.ok && result.blocker.code === "tool_approval_required" && result.blocker.status).toBe("none");
    expect(!result.ok && result.blocker.code === "tool_approval_required" && result.blocker.policy).toBe("parent_operated");
  });

  it("tells a teen to ask a parent to set a parent-operated tool up, never to make their own account", () => {
    const result = evaluateTool(operated, 14, undefined);
    expect(!result.ok && result.blocker.message).toMatch(/parent or carer to set it up/);
  });

  it("does not let a parent-operated approval override a hold or a block", () => {
    const confirmed = { status: "approved", parentOperatedConfirmed: true } as const;
    expect(evaluateTool({ ...operated, onHold: true }, 14, confirmed)).toMatchObject({ ok: false, blocker: { code: "tool_on_hold" } });
    expect(evaluateTool({ ...operated, status: "blocked" }, 14, confirmed)).toMatchObject({ ok: false, blocker: { code: "tool_blocked" } });
  });

  it("applies the under-18 policy to under-18s only", () => {
    expect(evaluateTool(consent, 18, undefined).ok).toBe(true);
    expect(evaluateTool(tool({ under18Policy: "blocked", minAge: 18 }), 18, undefined).ok).toBe(true);
    expect(evaluateTool(tool({ under18Policy: "blocked", minAge: 18 }), 17, undefined).ok).toBe(false);
    // An adult still has to meet the vendor's minimum age themselves.
    expect(evaluateTool(tool({ under18Policy: "parent_operated", minAge: 21 }), 18, undefined).ok).toBe(false);
  });
});

describe("fallback tools", () => {
  const blockedMain = tool({ status: "blocked" });

  it("satisfies a blocked main tool with an approved fallback", () => {
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: fallback() }, 14, {})).toEqual({ ok: true });
    expect(decideStart(facts({ tools: [{ tool: blockedMain, fallback: fallback() }] })).allowed).toBe(true);
    expect(toolInUse({ tool: blockedMain, fallback: fallback() }, 14, {}).slug).toBe("base44");
  });

  it("covers a main tool that is too old for this learner", () => {
    expect(evaluateRequiredTool({ tool: tool({ minAge: 16 }), fallback: fallback() }, 14, {}).ok).toBe(true);
    expect(evaluateRequiredTool({ tool: tool({ minAge: 16 }), fallback: fallback() }, 16, {}).ok).toBe(true);
    expect(toolInUse({ tool: tool({ minAge: 16 }), fallback: fallback() }, 16, {}).slug).toBe("replit");
  });

  it("asks for approval of the fallback when that is what the fallback needs", () => {
    const result = evaluateRequiredTool({ tool: blockedMain, fallback: fallback({ under18Policy: "parent_consent_required" }) }, 14, {});
    expect(result).toMatchObject({ ok: false, blocker: { code: "tool_approval_required", toolSlug: "base44" } });
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: fallback({ under18Policy: "parent_consent_required" }) }, 14, { base44: approved }).ok).toBe(true);
  });

  it("stays blocked when the fallback is blocked too, or is not approved in the Register", () => {
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: fallback({ status: "blocked" }) }, 14, {})).toMatchObject({ ok: false, blocker: { code: "tool_blocked", toolSlug: "replit" } });
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: fallback({ status: "candidate" }) }, 14, {}).ok).toBe(false);
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: null }, 14, {}).ok).toBe(false);
  });

  it("holds the course when the fallback has an open age-policy change", () => {
    expect(evaluateRequiredTool({ tool: blockedMain, fallback: fallback({ onHold: true }) }, 14, {})).toMatchObject({ ok: false, blocker: { code: "tool_on_hold", toolSlug: "base44" } });
  });

  it("does not swap in the fallback for a main tool that only needs approval or is on hold", () => {
    expect(evaluateRequiredTool({ tool: tool({ under18Policy: "parent_consent_required" }), fallback: fallback() }, 14, {})).toMatchObject({ ok: false, blocker: { code: "tool_approval_required", toolSlug: "replit" } });
    expect(evaluateRequiredTool({ tool: tool({ onHold: true }), fallback: fallback() }, 14, {})).toMatchObject({ ok: false, blocker: { code: "tool_on_hold", toolSlug: "replit" } });
  });
});
