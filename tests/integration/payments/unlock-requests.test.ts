import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { unlockRequest } from "@/server/db/schema";
import { clearSentEmails, getSentEmails } from "@/server/email";
import { canAccessCourse } from "@/server/services/entitlements";
import { UNLOCK_REASK_DAYS, decideUnlockRequest, listUnlockRequests, nextStepAfterDecision, requestUnlock } from "@/server/services/unlock-requests";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createParent } from "../../helpers/factories";
import { T0, auditRows, createCourse, daysAfter, entitlementAt, notificationsFor, setUpBilling, subscribe, sys } from "./helpers";

beforeEach(setUpBilling);
afterAll(closeDb);

async function scene() {
  const { family, parent, parentActor } = await createFamily();
  const { user: learner, actor } = await createLearner({ age: 14, familyId: family.id, nickname: "Maya", now: T0 });
  return { family, parent, parentActor, learner, learnerCtx: testCtx(actor, { now: T0 }), parentCtx: testCtx(parentActor, { now: T0 }) };
}

describe("requestUnlock", () => {
  it("creates one pending request, tells every parent in the app and by email, and is idempotent while pending", async () => {
    const { family, parent, parentActor, learner, learnerCtx } = await scene();
    const second = await createParent({ familyId: family.id });
    const paid = await createCourse({ title: "Build Your Own App" });
    clearSentEmails();

    const first = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });
    expect(first).toMatchObject({ learnerId: learner.id, learnerNickname: "Maya", kind: "paid_course", courseTitle: "Build Your Own App", status: "pending" });

    const again = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });
    const [a, b] = await Promise.all([
      requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" }),
      requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" }),
    ]);
    expect(new Set([first.id, again.id, a.id, b.id]).size).toBe(1);
    expect(await db.select().from(unlockRequest)).toHaveLength(1);

    for (const adult of [parentActor.userId, second.user.id]) expect(await notificationsFor(adult, "unlock.requested")).toHaveLength(1);
    const emails = getSentEmails().filter((email) => email.template === "unlock_request");
    expect(emails.map((email) => email.to).sort()).toEqual([parent.email, second.user.email].sort());
    // Asking tells the learner nothing new, and certainly nothing about money.
    expect(await notificationsFor(learner.id)).toHaveLength(0);
  });

  it("is only for the learner themselves, about a course that exists and is still locked", async () => {
    const { family, parentCtx, learner, learnerCtx } = await scene();
    const { actor: sibling } = await createLearner({ familyId: family.id, now: T0 });
    const paid = await createCourse();
    const free = await createCourse({ isFree: true });
    const input = { learnerId: learner.id, courseId: paid.id, kind: "paid_course" as const };

    await expect(requestUnlock(testCtx(sibling, { now: T0 }), input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(requestUnlock(parentCtx, input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(requestUnlock(learnerCtx, { ...input, courseId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "not_found" });
    await expect(requestUnlock(learnerCtx, { ...input, courseId: free.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(requestUnlock(learnerCtx, { ...input, kind: "pro_course" })).rejects.toMatchObject({ code: "invalid_input" });

    const { user: waiting, actor: waitingActor } = await createLearner({ familyId: null, now: T0 });
    await expect(requestUnlock(testCtx(waitingActor, { now: T0 }), { ...input, learnerId: waiting.id })).rejects.toMatchObject({ code: "parent_approval_required" });
  });
});

describe("listing and deciding", () => {
  it("a parent sees and decides only their own family's requests", async () => {
    const { family, parentCtx, learner, learnerCtx } = await scene();
    const other = await createFamily();
    const otherCtx = testCtx(other.parentActor, { now: T0 });
    const paid = await createCourse();
    const request = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });

    expect(await listUnlockRequests(parentCtx, family.id, { status: "pending" })).toMatchObject([{ id: request.id }]);
    await expect(listUnlockRequests(otherCtx, family.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listUnlockRequests(learnerCtx, family.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideUnlockRequest(otherCtx, request.id, "approve")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideUnlockRequest(learnerCtx, request.id, "approve")).rejects.toMatchObject({ code: "forbidden" });
    expect(await listUnlockRequests(parentCtx, family.id, { status: "pending" })).toHaveLength(1);
  });

  it("approving a paid-course request grants nothing: it leads to the plan choice, and the course opens when the plan starts", async () => {
    const { family, parentCtx, learner, learnerCtx } = await scene();
    const paid = await createCourse({ title: "Music Video" });
    const request = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });

    const decided = await decideUnlockRequest(parentCtx, request.id, "approve");
    expect(decided.status).toBe("approved");
    expect(nextStepAfterDecision(decided)).toEqual({ href: "/parent/billing/plans" });
    expect(await canAccessCourse(sys(), learner.id, paid)).toBe(false);
    expect((await entitlementAt(family.id)).planKey).toBe("free");
    // The learner is not told "it's unlocked" while it is not.
    expect(await notificationsFor(learner.id, "unlock.approved")).toHaveLength(0);

    // Deciding again the same way is harmless; changing an answer is refused.
    expect((await decideUnlockRequest(parentCtx, request.id, "approve")).status).toBe("approved");
    await expect(decideUnlockRequest(parentCtx, request.id, "decline")).rejects.toMatchObject({ code: "conflict" });
    expect(await auditRows("unlock.decide")).toHaveLength(1);
  });

  it("when the family's plan starts, open paid-course requests are settled and the learner is told", async () => {
    const { family, learner, learnerCtx } = await scene();
    const paid = await createCourse({ title: "Music Video" });
    const request = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: paid.id, kind: "paid_course" });
    await subscribe(family.id);

    expect(await canAccessCourse(sys(), learner.id, paid)).toBe(true);
    const [row] = await db.select().from(unlockRequest).where(eq(unlockRequest.id, request.id));
    expect(row).toMatchObject({ status: "approved", decidedBy: null });
    const [notice] = await notificationsFor(learner.id, "unlock.approved");
    expect(JSON.stringify(notice?.payload)).toContain("Music Video");
  });

  it("approving a Pro-course request does grant it: the approved row is what the start gate reads", async () => {
    const { parentCtx, learner, learnerCtx } = await scene();
    const pro = await createCourse({ isFree: true, difficulty: "pro", title: "Pro Project" });
    const request = await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: pro.id, kind: "pro_course" });

    const decided = await decideUnlockRequest(parentCtx, request.id, "approve");
    expect(nextStepAfterDecision(decided)).toBeNull();
    const approved = await db
      .select()
      .from(unlockRequest)
      .where(and(eq(unlockRequest.learnerId, learner.id), eq(unlockRequest.courseId, pro.id), eq(unlockRequest.kind, "pro_course"), eq(unlockRequest.status, "approved")));
    expect(approved).toHaveLength(1);
    expect(approved[0]?.decidedBy).toBe(parentCtx.actor.userId);
    expect(await notificationsFor(learner.id, "unlock.approved")).toHaveLength(1);
    // Asking again returns the standing approval rather than bothering the parent.
    expect((await requestUnlock(learnerCtx, { learnerId: learner.id, courseId: pro.id, kind: "pro_course" })).id).toBe(request.id);
  });

  it("a declined request is not sent again for a week", async () => {
    const { parentActor, parentCtx, learner, learnerCtx } = await scene();
    const paid = await createCourse();
    const input = { learnerId: learner.id, courseId: paid.id, kind: "paid_course" as const };
    const request = await requestUnlock(learnerCtx, input);
    expect((await decideUnlockRequest(parentCtx, request.id, "decline")).status).toBe("declined");
    expect(await notificationsFor(learner.id, "unlock.declined")).toHaveLength(1);

    const soon = await requestUnlock({ ...learnerCtx, now: daysAfter(UNLOCK_REASK_DAYS - 1) }, input);
    expect(soon).toMatchObject({ id: request.id, status: "declined" });
    expect(await notificationsFor(parentActor.userId, "unlock.requested")).toHaveLength(1);

    const later = await requestUnlock({ ...learnerCtx, now: daysAfter(UNLOCK_REASK_DAYS + 1) }, input);
    expect(later.status).toBe("pending");
    expect(later.id).not.toBe(request.id);
    expect(await notificationsFor(parentActor.userId, "unlock.requested")).toHaveLength(2);
  });
});
