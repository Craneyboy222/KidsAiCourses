import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { course, notification, parentControl, toolApproval, unlockRequest, user } from "@/server/db";
import { countPendingApprovals, decideApproval, getToolGuideForParent, listApprovals, revokeApproval } from "@/server/services/approvals";
import { pauseLearner, updateControls } from "@/server/services/parent-controls";
import { checkStart } from "@/server/services/start-gate";
import { requestToolApproval } from "@/server/services/tool-approval";
import { requestUnlock } from "@/server/services/unlock-requests";
import { closeDb, db, testCtx } from "../../helpers/db";
import { HOMEWORK, SNAPCHAT, courseBySlug, resetTools, seedCourses, setTool, tearDownStorage } from "../tools/helpers";
import { appError, makeFamily, type TestFamily } from "./helpers";

/**
 * The approvals inbox against the real tool-approval and unlock-request services, with the five
 * seed courses published. Nothing is mocked. Tool policies below are fixtures, not vendor facts.
 */
beforeAll(seedCourses);
afterAll(async () => {
  tearDownStorage();
  await closeDb();
});
beforeEach(async () => {
  await resetTools();
  await setTool("chatgpt", { under18Policy: "parent_consent_required", minAge: 13, consentRule: "Under-18s need a parent or carer's permission.", freeTier: "Free plan with daily limits", cost: "From a monthly fee", notes: "INTERNAL: staff note that parents must never see" });
  await setTool("replit", { under18Policy: "parent_operated", minAge: 18 });
});

const inApp = (userId: string) => db.select().from(notification).where(and(eq(notification.userId, userId), eq(notification.channel, "in_app")));

/** One request of each kind from the same child: a tool consent, a parent-operated tool and a paid-course unlock. */
async function threeRequests(mine: TestFamily) {
  const child = mine.children[0]!;
  const homework = await courseBySlug(HOMEWORK);
  const snapchat = await courseBySlug(SNAPCHAT);
  const consent = await requestToolApproval(child.ctx, { learnerId: child.id, courseId: homework.id, toolSlug: "chatgpt" });
  const operated = await requestToolApproval(child.ctx, { learnerId: child.id, courseId: snapchat.id, toolSlug: "replit" });
  const unlock = await requestUnlock(child.ctx, { learnerId: child.id, courseId: snapchat.id, kind: "paid_course" });
  return { child, homework, snapchat, consent, operated, unlock };
}

describe("the approvals inbox", () => {
  it("combines tool consents, parent-operated confirmations and unlock requests in one list", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);

    const items = await listApprovals(mine.parent, mine.familyId);
    expect(items.map((item) => item.kind).sort()).toEqual(["paid_course", "parent_operated", "tool_consent"]);
    expect(items.every((item) => item.status === "pending" && item.learnerNickname === "Maya")).toBe(true);
    expect(new Set(items.map((item) => item.key)).size).toBe(3);
    // Newest first.
    expect(items.map((item) => item.requestedAt.getTime())).toEqual([...items.map((item) => item.requestedAt.getTime())].sort((a, b) => b - a));

    const consent = items.find((item) => item.kind === "tool_consent");
    expect(consent).toMatchObject({ source: "tool", id: made.consent.id, courseTitle: made.homework.title, guideHref: `/parent/approvals/${made.consent.id}/guide` });
    expect(consent?.tool).toMatchObject({ slug: "chatgpt", minAge: 13, consentRule: "Under-18s need a parent or carer's permission.", freeTier: "Free plan with daily limits", available: true });
    // Staff notes from the Register are never part of what a parent is given.
    expect(JSON.stringify(items)).not.toContain("INTERNAL");

    const operated = items.find((item) => item.kind === "parent_operated");
    expect(operated).toMatchObject({ source: "tool", id: made.operated.id });
    expect(operated?.tool).toMatchObject({ slug: "replit", minAge: 18 });

    const unlock = items.find((item) => item.kind === "paid_course");
    expect(unlock).toMatchObject({ source: "unlock", id: made.unlock.id, courseTitle: made.snapchat.title, tool: null, guideHref: null });

    expect(await countPendingApprovals(mine.parent, mine.familyId)).toBe(3);
    expect(await listApprovals(mine.parent, mine.familyId, { status: "pending" })).toHaveLength(3);
  });

  it("narrows to one child, and leaves out a child whose account is being deleted", async () => {
    const mine = await makeFamily([
      { nickname: "Maya", age: 15 },
      { nickname: "Leo", age: 14 },
    ]);
    await threeRequests(mine);
    const leo = mine.children[1]!;
    const homework = await courseBySlug(HOMEWORK);
    await requestToolApproval(leo.ctx, { learnerId: leo.id, courseId: homework.id, toolSlug: "chatgpt" });

    expect(await listApprovals(mine.parent, mine.familyId)).toHaveLength(4);
    const onlyLeo = await listApprovals(mine.parent, mine.familyId, { learnerId: leo.id });
    expect(onlyLeo).toHaveLength(1);
    expect(onlyLeo[0]?.learnerNickname).toBe("Leo");

    await db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, leo.id));
    expect(await listApprovals(mine.parent, mine.familyId)).toHaveLength(3);
    expect(await countPendingApprovals(mine.parent, mine.familyId)).toBe(3);
  });

  it("deciding records the answer and tells the child in the app, for both kinds", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);

    const approved = await decideApproval(mine.parent, { source: "tool", id: made.consent.id, decision: "approve" });
    expect(approved).toMatchObject({ status: "approved", toolName: expect.any(String), learnerNickname: "Maya" });
    const [row] = await db.select().from(toolApproval).where(eq(toolApproval.id, made.consent.id));
    expect(row).toMatchObject({ status: "approved", decidedBy: mine.parentId });

    const declined = await decideApproval(mine.parent, { source: "unlock", id: made.unlock.id, decision: "decline" });
    expect(declined).toMatchObject({ status: "declined", nextHref: null });
    const [unlock] = await db.select().from(unlockRequest).where(eq(unlockRequest.id, made.unlock.id));
    expect(unlock).toMatchObject({ status: "declined", decidedBy: mine.parentId });

    const notes = await inApp(made.child.id);
    expect(notes.map((note) => note.type).sort()).toEqual(["approval.tool_approved", "unlock.declined"]);
    // In the app only: an under-18 is never emailed.
    expect(await db.select().from(notification).where(and(eq(notification.userId, made.child.id), eq(notification.channel, "email")))).toHaveLength(0);

    expect(await countPendingApprovals(mine.parent, mine.familyId)).toBe(1);
    const after = await listApprovals(mine.parent, mine.familyId);
    // The one still waiting comes first.
    expect(after[0]).toMatchObject({ kind: "parent_operated", status: "pending" });
    expect(after.filter((item) => item.status !== "pending")).toHaveLength(2);
  });

  it("approving a paid-course request leads to choosing a plan and unlocks nothing by itself", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);
    const result = await decideApproval(mine.parent, { source: "unlock", id: made.unlock.id, decision: "approve" });
    expect(result).toMatchObject({ status: "approved", nextHref: "/parent/billing/plans" });
    // No "it's unlocked" until a plan really covers it.
    expect((await inApp(made.child.id)).filter((note) => note.type === "unlock.approved")).toHaveLength(0);
  });

  it("a parent-operated tool needs the parent to confirm they will run the account", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);
    const refused = await appError(() => decideApproval(mine.parent, { source: "tool", id: made.operated.id, decision: "approve" }));
    expect(refused.code).toBe("invalid_input");
    expect(refused.fieldErrors?.parentWillOperate).toBeDefined();
    const ok = await decideApproval(mine.parent, { source: "tool", id: made.operated.id, decision: "approve", parentWillOperate: true });
    expect(ok.status).toBe("approved");
    const [row] = await db.select().from(toolApproval).where(eq(toolApproval.id, made.operated.id));
    expect(row?.parentOperatedConfirmed).toBe(true);
  });

  it("removing an approval tells the child and blocks the course again", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);
    await decideApproval(mine.parent, { source: "tool", id: made.consent.id, decision: "approve" });
    expect((await checkStart(made.child.ctx, made.child.id, made.homework.id)).allowed).toBe(true);
    const revoked = await revokeApproval(mine.parent, made.consent.id);
    expect(revoked.status).toBe("revoked");
    expect((await inApp(made.child.id)).map((note) => note.type)).toContain("approval.tool_revoked");
    const decision = await checkStart(made.child.ctx, made.child.id, made.homework.id);
    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0]).toMatchObject({ code: "tool_approval_required", status: "revoked" });
  });

  it("another family can neither see nor answer a request; the child, staff and visitors cannot answer either", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const theirs = await makeFamily([{ nickname: "Other", age: 15 }]);
    const made = await threeRequests(mine);

    expect(await listApprovals(theirs.parent, theirs.familyId)).toHaveLength(0);
    expect(await countPendingApprovals(theirs.parent, theirs.familyId)).toBe(0);
    // Naming the other family's id is refused outright.
    expect((await appError(() => listApprovals(theirs.parent, mine.familyId))).code).toBe("forbidden");
    expect((await appError(() => countPendingApprovals(theirs.parent, mine.familyId))).code).toBe("forbidden");
    expect((await appError(() => listApprovals(made.child.ctx, mine.familyId))).code).toBe("forbidden");
    expect((await appError(() => countPendingApprovals(testCtx(), mine.familyId))).code).toBe("unauthenticated");

    for (const decision of ["approve", "decline"] as const) {
      expect((await appError(() => decideApproval(theirs.parent, { source: "tool", id: made.consent.id, decision }))).code).toBe("not_found");
      expect((await appError(() => decideApproval(theirs.parent, { source: "unlock", id: made.unlock.id, decision }))).code).toBe("not_found");
    }
    expect((await appError(() => decideApproval(made.child.ctx, { source: "tool", id: made.consent.id, decision: "approve" }))).code).toBe("not_found");
    expect((await appError(() => decideApproval(made.child.ctx, { source: "unlock", id: made.unlock.id, decision: "approve" }))).code).toBe("forbidden");
    expect((await appError(() => decideApproval(testCtx(), { source: "unlock", id: made.unlock.id, decision: "approve" }))).code).toBe("unauthenticated");
    expect((await appError(() => revokeApproval(theirs.parent, made.consent.id))).code).toBe("not_found");
    // An id that is nobody's looks exactly the same.
    expect((await appError(() => decideApproval(theirs.parent, { source: "unlock", id: crypto.randomUUID(), decision: "approve" }))).code).toBe("not_found");

    expect(await countPendingApprovals(mine.parent, mine.familyId)).toBe(3);
    expect(await inApp(made.child.id)).toHaveLength(0);
  });
});

describe("the setup guide for a parent", () => {
  it("shows the guide from the published course for the tool they are asked about", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const made = await threeRequests(mine);
    const consent = await getToolGuideForParent(mine.parent, made.consent.id);
    expect(consent.approval).toMatchObject({ id: made.consent.id, kind: "tool_consent" });
    expect(consent.guide).not.toBeNull();
    expect(consent.guide?.steps.length).toBeGreaterThan(0);
    expect(consent.guide?.steps.map((step) => step.order)).toEqual([...(consent.guide?.steps ?? []).map((step) => step.order)].sort((a, b) => a - b));
    expect(consent.guide?.steps.map((step) => step.kind)).toEqual(expect.arrayContaining(["create_account", "privacy_settings"]));
    expect(consent.purpose).toEqual(expect.any(String));

    const operated = await getToolGuideForParent(mine.parent, made.operated.id);
    expect(operated.approval.kind).toBe("parent_operated");
    expect(operated.guide?.steps.length).toBeGreaterThan(0);

    // Still readable after approving: a parent who runs the tool needs the steps then most of all.
    await decideApproval(mine.parent, { source: "tool", id: made.operated.id, decision: "approve", parentWillOperate: true });
    expect((await getToolGuideForParent(mine.parent, made.operated.id)).approval.status).toBe("approved");
  });

  it("is not found for another family, an unlock request's id, a made-up id, and is not for learners", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const theirs = await makeFamily([{ nickname: "Other", age: 15 }]);
    const made = await threeRequests(mine);
    expect((await appError(() => getToolGuideForParent(theirs.parent, made.consent.id))).code).toBe("not_found");
    expect((await appError(() => getToolGuideForParent(mine.parent, made.unlock.id))).code).toBe("not_found");
    expect((await appError(() => getToolGuideForParent(mine.parent, crypto.randomUUID()))).code).toBe("not_found");
    expect((await appError(() => getToolGuideForParent(mine.parent, "not-an-id"))).code).toBe("not_found");
    expect((await appError(() => getToolGuideForParent(made.child.ctx, made.consent.id))).code).toBe("forbidden");
    expect((await appError(() => getToolGuideForParent(testCtx(), made.consent.id))).code).toBe("unauthenticated");
  });
});

describe("controls through the real start gate", () => {
  it("a pause stops a course being started or continued", async () => {
    await setTool("chatgpt", { under18Policy: "allowed" });
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const child = mine.children[0]!;
    const homework = await courseBySlug(HOMEWORK);
    await db.insert(parentControl).values({ learnerId: child.id, familyId: mine.familyId, quietStartMin: 0, quietEndMin: 0 });
    expect((await checkStart(child.ctx, child.id, homework.id)).allowed).toBe(true);

    await pauseLearner(mine.parent, child.id, { reason: "Exams this week" });
    const decision = await checkStart(child.ctx, child.id, homework.id);
    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toEqual([expect.objectContaining({ code: "not_allowed_now", reason: "paused" })]);
  });

  it("a blocked subject or course is hidden, and Pro approval is asked for when the parent wants it", async () => {
    await setTool("chatgpt", { under18Policy: "allowed" });
    const mine = await makeFamily([{ nickname: "Maya", age: 15 }]);
    const child = mine.children[0]!;
    const homework = await courseBySlug(HOMEWORK);
    const base = { dailyMinutesCap: null, quietStartMin: 0, quietEndMin: 0, blockedCategories: [] as string[], blockedCourseIds: [] as string[], requireApprovalForPro: false };

    await updateControls(mine.parent, child.id, { ...base, blockedCourseIds: [homework.id] });
    expect((await checkStart(child.ctx, child.id, homework.id)).blockers).toEqual([expect.objectContaining({ code: "parent_blocked" })]);

    await updateControls(mine.parent, child.id, { ...base, blockedCategories: homework.category ? [homework.category] : [] });
    expect((await checkStart(child.ctx, child.id, homework.id)).blockers).toEqual([expect.objectContaining({ code: "parent_blocked" })]);

    await updateControls(mine.parent, child.id, { ...base, requireApprovalForPro: true });
    await db.update(course).set({ difficulty: "pro" }).where(eq(course.id, homework.id));
    try {
      expect((await checkStart(child.ctx, child.id, homework.id)).blockers).toEqual([expect.objectContaining({ code: "pro_approval_required" })]);
      const request = await requestUnlock(child.ctx, { learnerId: child.id, courseId: homework.id, kind: "pro_course" });
      const items = await listApprovals(mine.parent, mine.familyId, { status: "pending" });
      expect(items).toEqual([expect.objectContaining({ kind: "pro_course", id: request.id })]);
      await decideApproval(mine.parent, { source: "unlock", id: request.id, decision: "approve" });
      expect((await checkStart(child.ctx, child.id, homework.id)).allowed).toBe(true);
      expect((await inApp(child.id)).map((note) => note.type)).toContain("unlock.approved");
    } finally {
      await db.update(course).set({ difficulty: homework.difficulty }).where(eq(course.id, homework.id));
    }
  });
});
