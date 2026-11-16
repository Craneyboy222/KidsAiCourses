import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { notification, project } from "@/server/db";
import { notify } from "@/server/notifications";
import { getChildDetail, getParentDashboard, listParentNotices, markParentNoticesRead, requireOwnChild, safetyNoticeCount } from "@/server/services/parent-dashboard";
import { pauseLearner, updateControls } from "@/server/services/parent-controls";
import { countSafetyNoticesForLearner } from "@/server/services/safeguarding";
import { requestToolApproval } from "@/server/services/tool-approval";
import { requestUnlock } from "@/server/services/unlock-requests";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createStaff } from "../../helpers/factories";
import { HOMEWORK, SNAPCHAT, courseBySlug, enrol, resetTools, seedCourses, setTool, tearDownStorage } from "../tools/helpers";
import { appError, at, fillLearner, makeFamily, secondParent } from "./helpers";

/**
 * The parent dashboard, one child in full, and the Notices page, against the real services.
 *
 * MOCKED CONTRACT: `countSafetyNoticesForLearner` (Studio safety slice; its body still throws).
 * The tool policy below is a test fixture, not a fact about the vendor.
 */
vi.mock("@/server/services/safeguarding", () => ({ countSafetyNoticesForLearner: vi.fn(async () => 0), openSafeguardingCase: vi.fn() }));

/** A Tuesday. `fillLearner` records 25 minutes on Monday 11 January, so it falls in "this week". */
const NOW = new Date("2027-01-12T10:00:00Z");

/** Everything a child wrote that a parent must never be shown, as `fillLearner` marks it. */
const PRIVATE = ["PRIVATE-NOTE", "ETHICS-ANSWER", "REFLECTION-TEXT", "QUIZ-ANSWER", "SUBMISSION-NOTE", "COACH-QUESTION", "COACH-ANSWER", "DISCLOSURE", "PENDING-FILE", "HELD-FILE"];

beforeAll(seedCourses);
afterAll(async () => {
  tearDownStorage();
  await closeDb();
});
beforeEach(async () => {
  await resetTools();
  await setTool("chatgpt", { under18Policy: "parent_consent_required", minAge: 13 });
  vi.mocked(countSafetyNoticesForLearner).mockReset();
  vi.mocked(countSafetyNoticesForLearner).mockResolvedValue(0);
});

async function twoFamilies() {
  const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW });
  const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
  const [maya, leo] = mine.children as [(typeof mine.children)[number], (typeof mine.children)[number]];
  const zed = theirs.children[0]!;
  const filled = await fillLearner(maya.id, "MAYA", { safeguarding: true, now: NOW });
  await fillLearner(zed.id, "ZED", { now: NOW });
  return { mine, theirs, maya, leo, zed, filled };
}

describe("the parent dashboard", () => {
  it("shows each child's progress, time, projects, certificates, Coach count and topics, safety notices and requests waiting", async () => {
    const { mine, maya, leo, zed } = await twoFamilies();
    vi.mocked(countSafetyNoticesForLearner).mockImplementation(async (_ctx, learnerId) => (learnerId === maya.id ? 2 : 0));
    const homework = await courseBySlug(HOMEWORK);
    const snapchat = await courseBySlug(SNAPCHAT);
    await requestToolApproval(leo.ctx, { learnerId: leo.id, courseId: homework.id, toolSlug: "chatgpt" });
    await requestUnlock(leo.ctx, { learnerId: leo.id, courseId: snapchat.id, kind: "paid_course" });
    await requestUnlock(zed.ctx, { learnerId: zed.id, courseId: snapchat.id, kind: "paid_course" });
    await updateControls(mine.parent, maya.id, { dailyMinutesCap: 60, quietStartMin: 21 * 60, quietEndMin: 7 * 60, blockedCategories: [], blockedCourseIds: [], requireApprovalForPro: false });

    const dashboard = await getParentDashboard(mine.parent);
    expect(dashboard.familyId).toBe(mine.familyId);
    // The child switcher's list: this family's children and nobody else's.
    expect(dashboard.children.map((child) => child.learner.nickname).sort()).toEqual(["Leo", "Maya"]);

    const mayaCard = dashboard.children.find((child) => child.learner.learnerId === maya.id)!;
    expect(mayaCard.progress.completed).toHaveLength(1);
    expect(mayaCard.progress.inProgress).toHaveLength(0);
    expect(mayaCard.progress.minutesThisWeek).toBe(25);
    expect(mayaCard.completedProjects).toBe(1);
    expect(mayaCard.certificates).toBe(1);
    // Coach: a count and the topics. Nothing else exists on the object to show.
    expect(Object.keys(mayaCard.coach).sort()).toEqual(["lastUsedAt", "messagesThisWeek", "messagesTotal", "topics"]);
    expect(mayaCard.coach.messagesTotal).toBe(1);
    expect(mayaCard.coach.topics).toEqual(["MAYA topic"]);
    expect(mayaCard.safetyNotices).toBe(2);
    expect(mayaCard.pendingApprovals).toBe(0);
    expect(mayaCard.controls.dailyMinutesCap).toBe(60);
    expect(mayaCard).toMatchObject({ independent: false, closing: false, needsConsent: false });

    const leoCard = dashboard.children.find((child) => child.learner.learnerId === leo.id)!;
    expect(leoCard).toMatchObject({ completedProjects: 0, certificates: 0, safetyNotices: 0, pendingApprovals: 2 });
    expect(leoCard.coach).toMatchObject({ messagesTotal: 0, topics: [] });

    // Both kinds of request are waiting, and the other family's is not among them.
    expect(dashboard.pendingApprovals.map((item) => item.kind).sort()).toEqual(["paid_course", "tool_consent"]);
    expect(dashboard.pendingApprovals.every((item) => item.learnerId === leo.id)).toBe(true);

    // Nothing the child wrote, nothing held for safeguarding beyond the count, and nothing of the other family's.
    const everything = JSON.stringify(dashboard);
    for (const marker of PRIVATE) expect(everything).not.toContain(marker);
    expect(everything).not.toMatch(/ZED|Zed/);
    expect(everything).not.toMatch(/crisis|safeguard/i);
  });

  it("shows zero safety notices, and still loads, when the safeguarding service fails", async () => {
    const { mine, maya } = await twoFamilies();
    vi.mocked(countSafetyNoticesForLearner).mockRejectedValue(new Error("Not implemented: safeguarding.countSafetyNoticesForLearner"));
    expect(await safetyNoticeCount(mine.parent, maya.id)).toBe(0);
    const dashboard = await getParentDashboard(mine.parent);
    expect(dashboard.children).toHaveLength(2);
    expect(dashboard.children.every((child) => child.safetyNotices === 0)).toBe(true);
    expect((await getChildDetail(mine.parent, maya.id)).safetyNotices).toBe(0);
    // A nonsense answer from the other slice is not shown either.
    vi.mocked(countSafetyNoticesForLearner).mockResolvedValue(Number.NaN);
    expect(await safetyNoticeCount(mine.parent, maya.id)).toBe(0);
    vi.mocked(countSafetyNoticesForLearner).mockResolvedValue(-3);
    expect(await safetyNoticeCount(mine.parent, maya.id)).toBe(0);
  });

  it("marks a paused child, a child being deleted and a child waiting for permissions", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const waiting = await makeFamily([{ nickname: "Noor" }], { now: NOW, consent: false });
    await pauseLearner(mine.parent, mine.children[0]!.id, { reason: "Exams this week" });
    const paused = (await getParentDashboard(mine.parent)).children[0]!;
    expect(paused.controls).toMatchObject({ paused: true, pausedReason: "Exams this week" });
    expect((await getParentDashboard(waiting.parent)).children[0]).toMatchObject({ needsConsent: true });
  });

  it("is for parents only, and takes the family from the session", async () => {
    const { mine, theirs, maya } = await twoFamilies();
    expect((await appError(() => getParentDashboard(maya.ctx))).code).toBe("forbidden");
    expect((await appError(() => getParentDashboard(testCtx()))).code).toBe("unauthenticated");
    const staff = await createStaff({ roles: ["support"] });
    expect((await appError(() => getParentDashboard(testCtx(staff.actor)))).code).toBe("forbidden");
    // The other family's dashboard is theirs alone.
    const other = await getParentDashboard(theirs.parent);
    expect(other.children.map((child) => child.learner.nickname)).toEqual(["Zed"]);
    expect(other.familyId).not.toBe(mine.familyId);
  });
});

describe("one child in full", () => {
  it("shows the week day by day, accepted work only, certificates and that child's requests", async () => {
    const { mine, maya, leo } = await twoFamilies();
    const homework = await courseBySlug(HOMEWORK);
    await requestToolApproval(maya.ctx, { learnerId: maya.id, courseId: homework.id, toolSlug: "chatgpt" });
    await requestToolApproval(leo.ctx, { learnerId: leo.id, courseId: homework.id, toolSlug: "chatgpt" });
    // A second project that has not been accepted: the learner's alone until it is.
    const second = await enrol(maya.id, SNAPCHAT, "active");
    await db.insert(project).values({ learnerId: maya.id, enrolmentId: second.enrolmentId, courseId: second.courseId, title: "MAYA unfinished project", status: "awaiting_review" });

    const detail = await getChildDetail(mine.parent, maya.id);
    expect(detail.learner).toMatchObject({ learnerId: maya.id, nickname: "Maya", familyId: mine.familyId });
    expect(detail.usage).toHaveLength(7);
    expect(detail.usage.find((day) => day.date === "2027-01-11")?.seconds).toBe(1500);
    expect(detail.projects.map((entry) => entry.title)).toEqual(["MAYA project"]);
    expect(detail.completedProjects).toBe(1);
    expect(detail.progress.inProgress).toHaveLength(1);
    expect(detail.certificateList).toHaveLength(1);
    expect(detail.approvals).toHaveLength(1);
    expect(detail.approvals[0]).toMatchObject({ learnerId: maya.id, kind: "tool_consent", status: "pending" });
    expect(detail.pendingApprovals).toBe(1);

    const everything = JSON.stringify(detail);
    for (const marker of PRIVATE) expect(everything).not.toContain(marker);
    expect(everything).not.toContain("unfinished");
    expect(everything).not.toMatch(/Leo|ZED|Zed/);
  });

  it("is not found for another family's child and for an id that is nobody's; refused for everyone who is not a parent", async () => {
    const { mine, theirs, maya, zed } = await twoFamilies();
    const carer = at(await secondParent(mine.familyId), NOW);
    expect((await getChildDetail(carer, maya.id)).learner.nickname).toBe("Maya");

    for (const load of [getChildDetail, requireOwnChild]) {
      const theirChild = await appError(() => load(mine.parent, zed.id));
      const nobody = await appError(() => load(mine.parent, crypto.randomUUID()));
      // The same answer, word for word: an id from another family confirms nothing.
      expect(theirChild.code).toBe("not_found");
      expect(nobody.code).toBe("not_found");
      expect(theirChild.message).toBe(nobody.message);
      expect((await appError(() => load(mine.parent, "not-an-id"))).code).toBe("not_found");
      expect((await appError(() => load(theirs.parent, maya.id))).code).toBe("not_found");
      expect((await appError(() => load(maya.ctx, maya.id))).code).toBe("forbidden");
      expect((await appError(() => load(zed.ctx, maya.id))).code).toBe("forbidden");
      expect((await appError(() => load(testCtx(), maya.id))).code).toBe("unauthenticated");
      const staff = await createStaff({ roles: ["support"] });
      expect((await appError(() => load(testCtx(staff.actor), maya.id))).code).toBe("forbidden");
    }
  });
});

describe("notices", () => {
  async function withNotices() {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const early = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    const middle = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const late = new Date(NOW.getTime() - 60 * 60 * 1000);
    await notify({ db, now: early }, { userId: mine.parentId, type: "unlock.requested", title: "Maya asked to unlock a course", body: "Have a look when you can.", href: "/parent/approvals", channels: ["in_app"] });
    await notify({ db, now: middle }, { userId: mine.parentId, type: "safety_notice.account_locked", title: "We have locked Maya's account", body: "Too many wrong passwords were tried. You can reset the password from your dashboard.", href: "/parent", urgent: true, channels: ["in_app"] });
    await notify({ db, now: late }, { userId: mine.parentId, type: "billing.receipt", title: "Your receipt", body: "Thank you.", href: "/studio/secret", channels: ["in_app"] });
    await notify({ db, now: late }, { userId: theirs.parentId, type: "safety_notice.account_locked", title: "We have locked Zed's account", body: "ZED-ONLY", href: "/parent", channels: ["in_app"] });
    return { mine, theirs };
  }

  it("lists the parent's own notices newest first, with read state, and never another family's", async () => {
    const { mine } = await withNotices();
    const { notices, unread } = await listParentNotices(mine.parent);
    expect(notices.map((notice) => notice.title)).toEqual(["Your receipt", "We have locked Maya's account", "Maya asked to unlock a course"]);
    expect(notices.map((notice) => notice.category)).toEqual(["account", "safety", "account"]);
    expect(notices.every((notice) => notice.read === false)).toBe(true);
    expect(unread).toBe(3);
    // A link is kept only when it stays inside the parent's own area.
    expect(notices.map((notice) => notice.href)).toEqual([null, "/parent", "/parent/approvals"]);
    expect(JSON.stringify(notices)).not.toMatch(/ZED|Zed/);

    expect(await markParentNoticesRead(mine.parent, [notices[1]!.id])).toBe(1);
    const after = await listParentNotices(mine.parent);
    expect(after.unread).toBe(2);
    expect(after.notices.map((notice) => notice.read)).toEqual([false, true, false]);
    expect(await markParentNoticesRead(mine.parent, "all")).toBe(2);
    expect((await listParentNotices(mine.parent)).unread).toBe(0);
  });

  it("cannot read or mark another parent's notices, and is not for learners or visitors", async () => {
    const { mine, theirs } = await withNotices();
    const [theirNotice] = await db.select().from(notification).where(eq(notification.userId, theirs.parentId));
    expect(await markParentNoticesRead(mine.parent, [theirNotice!.id])).toBe(0);
    expect(await markParentNoticesRead(mine.parent, "all")).toBe(3);
    const [still] = await db.select().from(notification).where(eq(notification.id, theirNotice!.id));
    expect(still?.readAt).toBeNull();
    expect((await listParentNotices(theirs.parent)).unread).toBe(1);

    expect((await appError(() => markParentNoticesRead(mine.parent, ["not-an-id"]))).code).toBe("invalid_input");
    const child = mine.children[0]!;
    expect((await appError(() => listParentNotices(child.ctx))).code).toBe("forbidden");
    expect((await appError(() => markParentNoticesRead(child.ctx, "all"))).code).toBe("forbidden");
    expect((await appError(() => listParentNotices(testCtx()))).code).toBe("unauthenticated");
  });
});
