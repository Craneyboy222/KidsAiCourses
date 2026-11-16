import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemActor } from "@/server/authz";
import { auditLog, notification, toolApproval } from "@/server/db";
import { clearSentEmails, getSentEmails } from "@/server/email";
import { checkStart } from "@/server/services/start-gate";
import { addLinkEvidence } from "@/server/services/submission";
import { decideToolApproval, hasToolApproval, listToolApprovals, listToolApprovalsForCourse, requestToolApproval, revokeToolApproval, setToolApproval } from "@/server/services/tool-approval";
import { db, testCtx } from "../../helpers/db";
import { createLearner, createParent } from "../../helpers/factories";
import { appError } from "../content/helpers";
import { HOMEWORK, SNAPCHAT, courseBySlug, enrol, family, publicResolver, resetTools, seedCourses, setControls, setTool, staffCtx, tearDownStorage, useToolMocks } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/safeguarding", () => ({ openSafeguardingCase: vi.fn() }));
vi.mock("@/server/services/usage", () => ({ checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/enrolment", () => ({ recordEvidenceOutcome: vi.fn(), getEnrolmentById: vi.fn() }));

beforeAll(seedCourses);
afterAll(tearDownStorage);
beforeEach(async () => {
  useToolMocks();
  await resetTools();
  await setTool("chatgpt", { under18Policy: "parent_consent_required" });
  clearSentEmails();
});

const notices = (userId: string) => db.select().from(notification).where(and(eq(notification.userId, userId), eq(notification.channel, "in_app")));
const auditActions = async (targetId: string) => (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.targetId, targetId))).map((row) => row.action);
const blockerStatus = async (who: Awaited<ReturnType<typeof family>>, courseId: string) => {
  const [blocker] = (await checkStart(who.learner, who.learnerId, courseId)).blockers;
  return blocker?.code === "tool_approval_required" ? blocker.status : (blocker?.code ?? "allowed");
};

describe("asking a parent", () => {
  it("records the request, tells every parent in the family, and is idempotent while pending", async () => {
    const mine = await family({ nickname: "Maya" });
    const second = await createParent({ familyId: mine.familyId });
    const target = await courseBySlug(HOMEWORK);

    const view = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(view).toMatchObject({ learnerId: mine.learnerId, learnerNickname: "Maya", courseId: target.id, courseTitle: target.title, toolSlug: "chatgpt", policy: "parent_consent_required", status: "pending", decidedAt: null });

    const first = await notices(mine.parent.actor.userId);
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("approval.tool_requested");
    expect(await notices(second.user.id)).toHaveLength(1);
    expect(getSentEmails().filter((email) => email.template === "tool_approval_request")).toHaveLength(2);
    expect(await notices(mine.learnerId)).toHaveLength(0);

    // Asking again while it is pending changes nothing and sends nothing.
    const again = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(again.id).toBe(view.id);
    expect(await notices(mine.parent.actor.userId)).toHaveLength(1);
    expect(await db.select().from(toolApproval).where(eq(toolApproval.learnerId, mine.learnerId))).toHaveLength(1);
    expect(await auditActions(view.id)).toEqual(["tool_approval.request"]);
  });

  it("is refused for anyone but the learner themselves", async () => {
    const mine = await family();
    const other = await family();
    const target = await courseBySlug(HOMEWORK);
    const input = { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" };
    expect((await appError(() => requestToolApproval(other.learner, input))).code).toBe("forbidden");
    expect((await appError(() => requestToolApproval(mine.parent, input))).code).toBe("forbidden");
    expect((await appError(() => requestToolApproval(testCtx(), input))).code).toBe("unauthenticated");
    expect(await db.select().from(toolApproval).where(eq(toolApproval.learnerId, mine.learnerId))).toHaveLength(0);
  });

  it("answers 'not found' for a hidden course or a tool the course does not use, and explains when no approval is needed", async () => {
    const mine = await family({ age: 14 });
    const target = await courseBySlug(HOMEWORK);
    expect((await appError(() => requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "replit" }))).code).toBe("not_found");
    setControls({ blockedCourseIds: [target.id] });
    expect((await appError(() => requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" }))).code).toBe("not_found");
    setControls({});
    await setTool("chatgpt", { under18Policy: "allowed" });
    expect((await appError(() => requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" }))).code).toBe("conflict");
    await setTool("chatgpt", { status: "blocked" });
    expect((await appError(() => requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" }))).code).toBe("tool_blocked");
  });

  it("tells a learner with no linked parent that there is nobody to ask", async () => {
    const solo = await createLearner({ age: 15 });
    const target = await courseBySlug(HOMEWORK);
    expect((await appError(() => requestToolApproval(testCtx(solo.actor), { learnerId: solo.user.id, courseId: target.id, toolSlug: "chatgpt" }))).code).toBe("conflict");
  });
});

describe("the parent's decision", () => {
  it("approves: the learner can start, is told in-app, and the decision is audited", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(await blockerStatus(mine, target.id)).toBe("pending");
    expect(await hasToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" })).toBe(false);

    const decided = await decideToolApproval(mine.parent, request.id, "approve");
    expect(decided.status).toBe("approved");
    expect(decided.decidedAt).not.toBeNull();
    expect(await blockerStatus(mine, target.id)).toBe("allowed");
    expect(await hasToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" })).toBe(true);
    expect((await notices(mine.learnerId)).map((row) => row.type)).toEqual(["approval.tool_approved"]);
    expect(await auditActions(request.id)).toEqual(["tool_approval.request", "tool_approval.approve"]);

    const [row] = await db.select().from(toolApproval).where(eq(toolApproval.id, request.id));
    expect(row).toMatchObject({ status: "approved", policyAtDecision: "parent_consent_required", parentOperatedConfirmed: false, decidedBy: mine.parent.actor.userId });

    // Approving twice is harmless and does not notify twice.
    await decideToolApproval(mine.parent, request.id, "approve");
    expect(await notices(mine.learnerId)).toHaveLength(1);
  });

  it("is for a parent in the learner's own family only", async () => {
    const mine = await family();
    const other = await family();
    const target = await courseBySlug(HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });

    const unknown = await appError(() => decideToolApproval(mine.parent, "00000000-0000-4000-8000-000000000000", "approve"));
    for (const ctx of [other.parent, mine.learner, other.learner, await staffCtx("super_admin"), testCtx(systemActor("test.job"))]) {
      const refused = await appError(() => decideToolApproval(ctx, request.id, "approve"));
      // Exactly what a request that does not exist answers.
      expect([refused.code, refused.message]).toEqual([unknown.code, unknown.message]);
      expect((await appError(() => revokeToolApproval(ctx, request.id))).code).toBe("not_found");
    }
    expect((await appError(() => decideToolApproval(testCtx(), request.id, "approve"))).code).toBe("unauthenticated");
    expect((await db.select().from(toolApproval).where(eq(toolApproval.id, request.id)))[0]?.status).toBe("pending");

    expect((await appError(() => listToolApprovals(other.parent, mine.familyId))).code).toBe("forbidden");
    expect((await appError(() => listToolApprovalsForCourse(other.parent, { learnerId: mine.learnerId, courseId: target.id }))).code).toBe("forbidden");
    expect((await appError(() => setToolApproval(other.parent, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt", decision: "approve" }))).code).toBe("not_found");
  });

  it("declines: the learner is told, stays blocked, and may ask again", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    await decideToolApproval(mine.parent, request.id, "decline");
    expect(await blockerStatus(mine, target.id)).toBe("declined");
    expect((await notices(mine.learnerId)).map((row) => row.type)).toEqual(["approval.tool_declined"]);

    // A later request: each one carries its own clock.
    const later = testCtx(mine.learner.actor, { now: new Date(Date.now() + 60_000) });
    const again = await requestToolApproval(later, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(again).toMatchObject({ id: request.id, status: "pending", decidedAt: null });
    expect(await notices(mine.parent.actor.userId)).toHaveLength(2);
    expect(await blockerStatus(mine, target.id)).toBe("pending");
  });

  it("records that the parent will set up and run a parent-operated account, and will not approve without it", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    await setTool("chatgpt", { under18Policy: "parent_operated", minAge: 18 });
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(request.policy).toBe("parent_operated");

    const refused = await appError(() => decideToolApproval(mine.parent, request.id, "approve"));
    expect(refused.code).toBe("invalid_input");
    expect(refused.fieldErrors).toHaveProperty("parentWillOperate");
    expect(await blockerStatus(mine, target.id)).toBe("pending");

    await decideToolApproval(mine.parent, request.id, "approve", { parentWillOperate: true });
    const [row] = await db.select().from(toolApproval).where(eq(toolApproval.id, request.id));
    expect(row).toMatchObject({ status: "approved", parentOperatedConfirmed: true, policyAtDecision: "parent_operated" });
    expect(await blockerStatus(mine, target.id)).toBe("allowed");
  });

  it("stops counting an approval once the tool tightens to parent-operated", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    await decideToolApproval(mine.parent, request.id, "approve");
    expect(await blockerStatus(mine, target.id)).toBe("allowed");

    await setTool("chatgpt", { under18Policy: "parent_operated", minAge: 18 });
    expect(await blockerStatus(mine, target.id)).toBe("none");
    expect(await hasToolApproval(mine.parent, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" })).toBe(false);
    await decideToolApproval(mine.parent, request.id, "approve", { parentWillOperate: true });
    expect(await blockerStatus(mine, target.id)).toBe("allowed");
  });

  it("lets a parent approve from the course page before the learner has asked", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const view = await setToolApproval(mine.parent, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt", decision: "approve" });
    expect(view.status).toBe("approved");
    expect(await blockerStatus(mine, target.id)).toBe("allowed");
  });

  it("will not approve a tool that has since been blocked", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    await setTool("chatgpt", { status: "blocked" });
    expect((await appError(() => decideToolApproval(mine.parent, request.id, "approve"))).code).toBe("tool_blocked");
  });

  it("lists a family's approvals, with a pending filter", async () => {
    const mine = await family();
    const homework = await courseBySlug(HOMEWORK);
    const snapchat = await courseBySlug(SNAPCHAT);
    await setTool("replit", { under18Policy: "parent_consent_required" });
    const one = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: homework.id, toolSlug: "chatgpt" });
    await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: snapchat.id, toolSlug: "replit" });
    await decideToolApproval(mine.parent, one.id, "approve");
    expect(await listToolApprovals(mine.parent, mine.familyId)).toHaveLength(2);
    expect((await listToolApprovals(mine.parent, mine.familyId, { status: "pending" })).map((view) => view.toolSlug)).toEqual(["replit"]);
    expect((await listToolApprovalsForCourse(mine.learner, { learnerId: mine.learnerId, courseId: homework.id })).map((view) => view.status)).toEqual(["approved"]);
  });
});

describe("revocation", () => {
  it("blocks the course again and stops further evidence on it", async () => {
    const mine = await family();
    const target = await courseBySlug(HOMEWORK);
    const where = await enrol(mine.learnerId, HOMEWORK);
    const request = await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });

    // Nothing to revoke until it has been approved.
    expect((await appError(() => revokeToolApproval(mine.parent, request.id))).code).toBe("conflict");
    await decideToolApproval(mine.parent, request.id, "approve");
    const link = { enrolmentId: where.enrolmentId, stepId: where.submitStepId, url: "https://chatgpt.com/share/abc", declaredNoPeople: true };
    await expect(addLinkEvidence(mine.learner, link, { resolver: publicResolver })).resolves.toMatchObject({ kind: "link" });

    const revoked = await revokeToolApproval(mine.parent, request.id);
    expect(revoked.status).toBe("revoked");
    expect(await blockerStatus(mine, target.id)).toBe("revoked");
    expect(await hasToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" })).toBe(false);
    expect((await notices(mine.learnerId)).map((row) => row.type)).toEqual(["approval.tool_approved", "approval.tool_revoked"]);
    expect(await auditActions(request.id)).toEqual(["tool_approval.request", "tool_approval.approve", "tool_approval.revoke"]);

    const refused = await appError(() => addLinkEvidence(mine.learner, { ...link, url: "https://chatgpt.com/share/def" }, { resolver: publicResolver }));
    expect(refused.code).toBe("parent_approval_required");

    // Revoking twice is harmless; the parent can approve again later.
    await revokeToolApproval(mine.parent, request.id);
    expect(await notices(mine.learnerId)).toHaveLength(2);
    await decideToolApproval(mine.parent, request.id, "approve");
    expect(await blockerStatus(mine, target.id)).toBe("allowed");
  });
});
