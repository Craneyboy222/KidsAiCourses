import { and, eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/context";
import { account, auditLog, dataRequest, inviteCode, notification, parentControl, project, toolApproval, unlockRequest } from "@/server/db";
import { notify } from "@/server/notifications";
import { requestChildDeletion, requestExport, runExport } from "@/server/services/data-request";
import { requestToolApproval } from "@/server/services/tool-approval";
import { requestUnlock } from "@/server/services/unlock-requests";
import { closeDb, db, testCtx } from "../../helpers/db";
import { createStaff } from "../../helpers/factories";
import { HOMEWORK, SNAPCHAT, courseBySlug, enrol, resetTools, seedCourses, setTool, tearDownStorage } from "../tools/helpers";
import { fillLearner, makeFamily, secondParent, system, userRow, type TestFamily } from "./helpers";

/**
 * Every parent page's loader and every parent action, called as functions, with another family's
 * ids in the address or the form (brief: "cross-family access refused on every page's loader and
 * action"). Next.js itself is not running, so what a page or action takes from it is replaced:
 * who is signed in (`web.ctx`), `notFound()` and `redirect()` (they throw the same kind of marker
 * Next.js throws), `revalidatePath` (a no-op) and the cookie jar. Everything behind them is real.
 *
 * MOCKED CONTRACT: `countSafetyNoticesForLearner` (Studio safety slice; its body still throws).
 */
const web = vi.hoisted(() => ({ ctx: undefined as unknown }));

vi.mock("@/server/context", async (original) => {
  const actual = await original<typeof import("@/server/context")>();
  const { AppError } = await import("@/server/errors");
  const current = () => web.ctx as Ctx;
  const signedIn = () => {
    const ctx = current();
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    return ctx;
  };
  return {
    ...actual,
    getCtx: async () => current(),
    resolveCtx: async () => current(),
    requireSession: async () => signedIn(),
    requireParent: async () => {
      const ctx = signedIn();
      if (ctx.actor.type !== "parent") throw new AppError("forbidden", "That page is for parent and carer accounts.");
      return ctx;
    },
    requireLearner: async () => {
      const ctx = signedIn();
      if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That page is for learner accounts.");
      return ctx;
    },
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/parent",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/services/safeguarding", () => ({ countSafetyNoticesForLearner: vi.fn(async () => 0), openSafeguardingCase: vi.fn() }));

const dashboardPage = (await import("@/app/(parent)/parent/page")).default;
const childPage = (await import("@/app/(parent)/parent/children/[id]/page")).default;
const controlsPage = (await import("@/app/(parent)/parent/children/[id]/controls/page")).default;
const projectPage = (await import("@/app/(parent)/parent/children/[id]/projects/[projectId]/page")).default;
const approvalsPage = (await import("@/app/(parent)/parent/approvals/page")).default;
const guidePage = (await import("@/app/(parent)/parent/approvals/[id]/guide/page")).default;
const noticesPage = (await import("@/app/(parent)/parent/notices/page")).default;
const privacyPage = (await import("@/app/(parent)/parent/privacy/page")).default;
const settingsPage = (await import("@/app/(parent)/parent/settings/page")).default;
const ownPrivacyPage = (await import("@/app/(learner)/settings/privacy/page")).default;
const childActions = await import("@/app/(parent)/parent/children/[id]/actions");
const approvalActions = await import("@/app/(parent)/parent/approvals/actions");
const noticeActions = await import("@/app/(parent)/parent/notices/actions");
const privacyActions = await import("@/app/(parent)/parent/privacy/actions");
const ownPrivacyActions = await import("@/app/(learner)/settings/privacy/actions");
const download = await import("@/app/api/v1/data-requests/[id]/download/route");

const NOW = new Date("2027-01-12T10:00:00Z");
const PRIVATE = ["PRIVATE-NOTE", "ETHICS-ANSWER", "REFLECTION-TEXT", "QUIZ-ANSWER", "SUBMISSION-NOTE", "COACH-QUESTION", "COACH-ANSWER", "PENDING-FILE"];

type Outcome = { kind: "page"; html: string } | { kind: "not_found" } | { kind: "redirect"; to: string };

/** Runs a page as `ctx` and says how it ended: drawn, "not found", or sent somewhere else. */
async function open(ctx: Ctx, page: () => Promise<ReactElement>): Promise<Outcome> {
  web.ctx = ctx;
  try {
    return { kind: "page", html: renderToStaticMarkup(await page()) };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest === "NEXT_NOT_FOUND") return { kind: "not_found" };
    if (digest.startsWith("NEXT_REDIRECT")) return { kind: "redirect", to: digest.split(";")[2] ?? "" };
    throw error;
  }
}
const html = async (ctx: Ctx, page: () => Promise<ReactElement>): Promise<string> => {
  const outcome = await open(ctx, page);
  if (outcome.kind !== "page") throw new Error(`Expected a page, got ${JSON.stringify(outcome)}`);
  return outcome.html;
};
const id = (value: string) => ({ params: Promise.resolve({ id: value }) });

type Result = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  return data;
}
/** Runs an action as `ctx` and returns its error code, or `ok`. */
async function act(ctx: Ctx, action: (prev: never, data: FormData) => Promise<unknown>, fields: Record<string, string | string[]>): Promise<string> {
  web.ctx = ctx;
  const result = (await action(null as never, form(fields))) as Result;
  return result.ok ? "ok" : result.error.code;
}

type World = {
  mine: TestFamily;
  theirs: TestFamily;
  maya: TestFamily["children"][number];
  leo: TestFamily["children"][number];
  zed: TestFamily["children"][number];
  mayaProjectId: string;
  zedProjectId: string;
  mayaUnfinishedProjectId: string;
  zedToolApprovalId: string;
  zedUnlockId: string;
  mayaToolApprovalId: string;
  zedNoticeId: string;
  zedExportId: string;
  zedDeletionId: string;
};
let world: World;

beforeAll(seedCourses);
afterAll(async () => {
  tearDownStorage();
  await closeDb();
});

/** Two families with one of everything each. Built once per test: cheap, and no test depends on another. */
beforeEach(async () => {
  await resetTools();
  await setTool("chatgpt", { under18Policy: "parent_consent_required", minAge: 13 });
  const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW });
  const theirs = await makeFamily([{ nickname: "Zed" }, { nickname: "Yara" }], { now: NOW });
  const [maya, leo] = mine.children as [World["maya"], World["leo"]];
  const [zed, yara] = theirs.children as [World["zed"], World["zed"]];
  const mayaFilled = await fillLearner(maya.id, "MAYA", { now: NOW });
  const zedFilled = await fillLearner(zed.id, "ZED", { now: NOW });
  const second = await enrol(maya.id, SNAPCHAT, "active");
  const [unfinished] = await db.insert(project).values({ learnerId: maya.id, enrolmentId: second.enrolmentId, courseId: second.courseId, title: "MAYA unfinished project", status: "awaiting_review" }).returning();
  const homework = await courseBySlug(HOMEWORK);
  const snapchat = await courseBySlug(SNAPCHAT);
  const zedTool = await requestToolApproval(zed.ctx, { learnerId: zed.id, courseId: homework.id, toolSlug: "chatgpt" });
  const zedUnlock = await requestUnlock(zed.ctx, { learnerId: zed.id, courseId: snapchat.id, kind: "paid_course" });
  const mayaTool = await requestToolApproval(maya.ctx, { learnerId: maya.id, courseId: homework.id, toolSlug: "chatgpt" });
  await notify({ db, now: NOW }, { userId: mine.parentId, type: "safety_notice.account_locked", title: "We have locked Maya's account", body: "Too many wrong passwords were tried.", href: "/parent", channels: ["in_app"] });
  await notify({ db, now: NOW }, { userId: theirs.parentId, type: "safety_notice.account_locked", title: "We have locked Zed's account", body: "ZED-NOTICE-BODY", href: "/parent", channels: ["in_app"] });
  const [zedNotice] = await db.select().from(notification).where(eq(notification.userId, theirs.parentId));
  const zedExport = await requestExport(theirs.parent, { learnerId: zed.id });
  await runExport(system("data.export", NOW), zedExport.id);
  const zedDeletion = await requestChildDeletion(theirs.parent, yara.id);
  world = {
    mine,
    theirs,
    maya,
    leo,
    zed,
    mayaProjectId: mayaFilled.projectId,
    zedProjectId: zedFilled.projectId,
    mayaUnfinishedProjectId: unfinished!.id,
    zedToolApprovalId: zedTool.id,
    zedUnlockId: zedUnlock.id,
    mayaToolApprovalId: mayaTool.id,
    zedNoticeId: zedNotice!.id,
    zedExportId: zedExport.id,
    zedDeletionId: zedDeletion.id,
  };
});

describe("pages that take an id from the address", () => {
  it("child detail: this family's child is shown; another family's, nobody's and a malformed id are all 'not found'", async () => {
    const { mine, theirs, maya, zed } = world;
    const page = await html(mine.parent, () => childPage(id(maya.id)));
    expect(page).toContain("Maya");
    expect(page).toContain("MAYA project");
    expect(page).toContain("MAYA topic");
    // Never the child's own words, work that is not accepted, or anything of another family's.
    for (const marker of PRIVATE) expect(page).not.toContain(marker);
    expect(page).not.toContain("unfinished");
    expect(page).not.toMatch(/ZED|Zed|Yara/);

    expect(await open(mine.parent, () => childPage(id(zed.id)))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => childPage(id(crypto.randomUUID())))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => childPage(id("../../etc")))).toEqual({ kind: "not_found" });
    expect(await open(theirs.parent, () => childPage(id(maya.id)))).toEqual({ kind: "not_found" });
    // A second parent or carer in the same family can.
    const carer = { ...(await secondParent(mine.familyId)), now: NOW };
    expect((await open(carer, () => childPage(id(maya.id)))).kind).toBe("page");
  });

  it("controls: the same refusals, and the form is drawn only for this family's child", async () => {
    const { mine, theirs, maya, zed } = world;
    const page = await html(mine.parent, () => controlsPage(id(maya.id)));
    expect(page).toContain("Daily time limit");
    expect(page).toContain(`value="${maya.id}"`);
    expect(page).not.toMatch(/Zed|Yara/);
    expect(await open(mine.parent, () => controlsPage(id(zed.id)))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => controlsPage(id(crypto.randomUUID())))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => controlsPage(id("nope")))).toEqual({ kind: "not_found" });
    expect(await open(theirs.parent, () => controlsPage(id(maya.id)))).toEqual({ kind: "not_found" });
  });

  it("project: only an accepted project of the child in the address, in this family", async () => {
    const { mine, theirs, maya, leo, zed, mayaProjectId, zedProjectId, mayaUnfinishedProjectId } = world;
    const at = (childId: string, projectId: string) => () => projectPage({ params: Promise.resolve({ id: childId, projectId }) });
    const page = await html(mine.parent, at(maya.id, mayaProjectId));
    expect(page).toContain("MAYA project");
    expect(page).toContain("https://example.test/maya-project");
    for (const marker of PRIVATE) expect(page).not.toContain(marker);

    // Another family's project under my child's address; their child's address; a sibling's address; unfinished work.
    expect(await open(mine.parent, at(maya.id, zedProjectId))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, at(zed.id, zedProjectId))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, at(zed.id, mayaProjectId))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, at(leo.id, mayaProjectId))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, at(maya.id, mayaUnfinishedProjectId))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, at(maya.id, crypto.randomUUID()))).toEqual({ kind: "not_found" });
    expect(await open(theirs.parent, at(maya.id, mayaProjectId))).toEqual({ kind: "not_found" });
  });

  it("setup guide: reached only through a request in this family", async () => {
    const { mine, theirs, mayaToolApprovalId, zedToolApprovalId, zedUnlockId } = world;
    expect((await open(mine.parent, () => guidePage(id(mayaToolApprovalId)))).kind).toBe("page");
    expect(await open(mine.parent, () => guidePage(id(zedToolApprovalId)))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => guidePage(id(zedUnlockId)))).toEqual({ kind: "not_found" });
    expect(await open(mine.parent, () => guidePage(id(crypto.randomUUID())))).toEqual({ kind: "not_found" });
    expect(await open(theirs.parent, () => guidePage(id(mayaToolApprovalId)))).toEqual({ kind: "not_found" });
  });
});

describe("pages that take the family from the session", () => {
  it("dashboard, approvals, notices, privacy and settings show this family and nothing of another's", async () => {
    const { mine } = world;
    const pages = {
      dashboard: await html(mine.parent, () => dashboardPage()),
      approvals: await html(mine.parent, () => approvalsPage()),
      notices: await html(mine.parent, () => noticesPage()),
      privacy: await html(mine.parent, () => privacyPage()),
      settings: await html(mine.parent, () => settingsPage()),
    };
    for (const [name, page] of Object.entries(pages)) {
      expect(page, name).not.toMatch(/ZED|Zed|Yara/);
      for (const marker of PRIVATE) expect(page, name).not.toContain(marker);
    }
    expect(pages.dashboard).toContain("Maya");
    expect(pages.dashboard).toContain("Leo");
    expect(pages.dashboard).toContain("MAYA topic");
    expect(pages.approvals).toContain("Maya");
    expect(pages.notices).toContain("We have locked Maya&#x27;s account");
    expect(pages.privacy).toContain("What we must keep");
    expect(pages.privacy).not.toContain(world.zedExportId);
    expect(pages.privacy).not.toContain(world.zedDeletionId);
  });

  it("send a learner, a member of staff and a visitor away instead of drawing anything", async () => {
    const { maya } = world;
    const staff = testCtx((await createStaff({ roles: ["support"] })).actor);
    const pages: [string, () => Promise<ReactElement>][] = [
      ["dashboard", () => dashboardPage()],
      ["child", () => childPage(id(maya.id))],
      ["controls", () => controlsPage(id(maya.id))],
      ["project", () => projectPage({ params: Promise.resolve({ id: maya.id, projectId: world.mayaProjectId }) })],
      ["approvals", () => approvalsPage()],
      ["guide", () => guidePage(id(world.mayaToolApprovalId))],
      ["notices", () => noticesPage()],
      ["privacy", () => privacyPage()],
      ["settings", () => settingsPage()],
    ];
    for (const [name, page] of pages) {
      expect(await open(testCtx(), page), `${name} for a visitor`).toEqual({ kind: "redirect", to: "/signin?as=parent" });
      expect((await open(maya.ctx, page)).kind, `${name} for a learner`).toBe("redirect");
      expect((await open(staff, page)).kind, `${name} for staff`).toBe("redirect");
    }
  });
});

describe("actions", () => {
  it("controls, pause, password reset and invite code are 'not found' for another family's child, and change nothing", async () => {
    const { mine, zed } = world;
    const before = await userRow(zed.id);
    const controls = { learnerId: zed.id, dailyCap: "15", quietEnabled: "on", quietStart: "18:00", quietEnd: "09:00", requireApprovalForPro: "on" };
    expect(await act(mine.parent, childActions.saveControlsAction, controls)).toBe("not_found");
    expect(await act(mine.parent, childActions.setPausedAction, { learnerId: zed.id, intent: "pause", reason: "Not yours to pause" })).toBe("not_found");
    expect(await act(mine.parent, childActions.setPausedAction, { learnerId: zed.id, intent: "resume" })).toBe("not_found");
    expect(await act(mine.parent, childActions.resetPasswordAction, { learnerId: zed.id, mode: "password", password: "orbit-lantern-walrus-43" })).toBe("not_found");
    expect(await act(mine.parent, childActions.resetPasswordAction, { learnerId: zed.id, mode: "code" })).toBe("not_found");
    expect(await act(mine.parent, childActions.newInviteCodeAction, { learnerId: zed.id })).toBe("not_found");
    // An id that is nobody's reads the same; a malformed one never reaches the database.
    expect(await act(mine.parent, childActions.setPausedAction, { learnerId: crypto.randomUUID(), intent: "pause" })).toBe("not_found");
    expect(await act(mine.parent, childActions.saveControlsAction, { ...controls, learnerId: "zed" })).toBe("invalid_input");

    expect(await db.select().from(parentControl).where(eq(parentControl.learnerId, zed.id))).toHaveLength(0);
    expect(await db.select().from(inviteCode).where(eq(inviteCode.learnerId, zed.id))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, zed.id))).toHaveLength(0);
    expect(await userRow(zed.id)).toMatchObject({ status: before!.status, statusReason: before!.statusReason });
    expect(await db.select().from(auditLog).where(eq(auditLog.targetId, zed.id)).then((rows) => rows.filter((row) => row.actorId === mine.parentId))).toHaveLength(0);

    // The same actions work for this parent's own child.
    expect(await act(mine.parent, childActions.saveControlsAction, { ...controls, learnerId: world.maya.id })).toBe("ok");
    expect(await act(mine.parent, childActions.setPausedAction, { learnerId: world.maya.id, intent: "pause", reason: "Exams" })).toBe("ok");
    expect(await db.select().from(parentControl).where(eq(parentControl.learnerId, world.maya.id))).toMatchObject([{ dailyMinutesCap: 15, paused: true, pausedReason: "Exams" }]);
  });

  it("approvals cannot be answered or taken back for another family", async () => {
    const { mine, zedToolApprovalId, zedUnlockId } = world;
    for (const decision of ["approve", "decline"]) {
      expect(await act(mine.parent, approvalActions.decideApprovalAction, { source: "tool", id: zedToolApprovalId, decision, parentWillOperate: "on" })).toBe("not_found");
      expect(await act(mine.parent, approvalActions.decideApprovalAction, { source: "unlock", id: zedUnlockId, decision })).toBe("not_found");
    }
    // The right id under the wrong kind of request is not a way round it either.
    expect(await act(mine.parent, approvalActions.decideApprovalAction, { source: "unlock", id: zedToolApprovalId, decision: "approve" })).toBe("not_found");
    expect(await act(mine.parent, approvalActions.revokeApprovalAction, { id: zedToolApprovalId })).toBe("not_found");
    expect(await db.select().from(toolApproval).where(eq(toolApproval.id, zedToolApprovalId))).toMatchObject([{ status: "pending", decidedBy: null }]);
    expect(await db.select().from(unlockRequest).where(eq(unlockRequest.id, zedUnlockId))).toMatchObject([{ status: "pending" }]);

    expect(await act(mine.parent, approvalActions.decideApprovalAction, { source: "tool", id: world.mayaToolApprovalId, decision: "approve" })).toBe("ok");
    expect(await db.select().from(toolApproval).where(eq(toolApproval.id, world.mayaToolApprovalId))).toMatchObject([{ status: "approved", decidedBy: mine.parentId }]);
  });

  it("notices: marking another parent's notice as read does nothing", async () => {
    const { mine, zedNoticeId } = world;
    expect(await act(mine.parent, noticeActions.markNoticesReadAction, { id: zedNoticeId })).toBe("ok");
    expect(await act(mine.parent, noticeActions.markNoticesReadAction, { id: "all" })).toBe("ok");
    const [theirNotice] = await db.select().from(notification).where(eq(notification.id, zedNoticeId));
    expect(theirNotice?.readAt).toBeNull();
    expect(await db.select().from(notification).where(and(eq(notification.userId, mine.parentId), eq(notification.channel, "in_app"))).then((rows) => rows.every((row) => row.readAt !== null))).toBe(true);
  });

  it("privacy: no download, deletion or undo for another family's child or request", async () => {
    const { mine, theirs, zed, zedDeletionId } = world;
    const requestsBefore = await db.select().from(dataRequest);
    expect(await act(mine.parent, privacyActions.requestExportAction, { learnerId: zed.id })).toBe("not_found");
    expect(await act(mine.parent, privacyActions.deleteChildAction, { learnerId: zed.id, confirm: "on" })).toBe("not_found");
    expect(await act(mine.parent, privacyActions.cancelDeletionAction, { requestId: zedDeletionId })).toBe("not_found");
    expect(await act(mine.parent, privacyActions.cancelDeletionAction, { requestId: crypto.randomUUID() })).toBe("not_found");
    expect(await db.select().from(dataRequest)).toHaveLength(requestsBefore.length);
    expect((await userRow(zed.id))?.status).toBe("active");
    expect(await db.select().from(dataRequest).where(eq(dataRequest.id, zedDeletionId))).toMatchObject([{ status: "requested", cancelledAt: null }]);

    // Deleting the whole family is the owner's alone: a second carer is refused, and nothing closes.
    const carer = { ...(await secondParent(mine.familyId)), now: NOW };
    expect(await act(carer, privacyActions.deleteFamilyAction, { confirm: "on", confirmWord: "DELETE" })).toBe("forbidden");
    expect((await userRow(world.maya.id))?.status).toBe("active");
    // And it needs both deliberate steps.
    expect(await act(mine.parent, privacyActions.deleteFamilyAction, { confirm: "on", confirmWord: "yes" })).toBe("invalid_input");
    expect(await act(mine.parent, privacyActions.deleteChildAction, { learnerId: world.leo.id })).toBe("invalid_input");

    // Their own parent can undo their own request.
    expect(await act(theirs.parent, privacyActions.cancelDeletionAction, { requestId: zedDeletionId })).toBe("ok");
  });

  it("are refused for a learner, a member of staff and a visitor", async () => {
    const { maya } = world;
    const staff = testCtx((await createStaff({ roles: ["support"] })).actor);
    const calls: [string, (prev: never, data: FormData) => Promise<unknown>, Record<string, string>][] = [
      ["saveControls", childActions.saveControlsAction, { learnerId: maya.id, dailyCap: "none" }],
      ["setPaused", childActions.setPausedAction, { learnerId: maya.id, intent: "resume" }],
      ["resetPassword", childActions.resetPasswordAction, { learnerId: maya.id, mode: "code" }],
      ["newInviteCode", childActions.newInviteCodeAction, { learnerId: maya.id }],
      ["decideApproval", approvalActions.decideApprovalAction, { source: "tool", id: world.mayaToolApprovalId, decision: "approve" }],
      ["revokeApproval", approvalActions.revokeApprovalAction, { id: world.mayaToolApprovalId }],
      ["markNoticesRead", noticeActions.markNoticesReadAction, { id: "all" }],
      ["requestExport", privacyActions.requestExportAction, { learnerId: maya.id }],
      ["deleteChild", privacyActions.deleteChildAction, { learnerId: maya.id, confirm: "on" }],
      ["deleteFamily", privacyActions.deleteFamilyAction, { confirm: "on", confirmWord: "DELETE" }],
      ["cancelDeletion", privacyActions.cancelDeletionAction, { requestId: world.zedDeletionId }],
    ];
    for (const [name, action, fields] of calls) {
      expect(await act(maya.ctx, action, fields), `${name} as the child`).toBe("forbidden");
      expect(await act(staff, action, fields), `${name} as staff`).toBe("forbidden");
      expect(await act(testCtx(), action, fields), `${name} as a visitor`).toBe("unauthenticated");
    }
    expect((await userRow(maya.id))?.status).toBe("active");
    expect(await db.select().from(toolApproval).where(eq(toolApproval.id, world.mayaToolApprovalId))).toMatchObject([{ status: "pending" }]);
  });
});

describe("the download link", () => {
  const get = async (ctx: Ctx, requestId: string) => {
    web.ctx = ctx;
    return download.GET(new Request(`http://localhost/api/v1/data-requests/${requestId}/download`), { params: Promise.resolve({ id: requestId }) });
  };

  it("hands the file to the family that asked, answers 404 to another family, and sends a visitor to sign in", async () => {
    const { mine, theirs, maya, zedExportId } = world;
    const own = await get(theirs.parent, zedExportId);
    expect(own.status).toBe(303);
    expect(own.headers.get("location")).toContain("your-data.zip");
    expect(own.headers.get("cache-control")).toBe("no-store");

    const other = await get(mine.parent, zedExportId);
    expect(other.status).toBe(404);
    expect(other.headers.get("location")).toBeNull();
    expect((await get(mine.parent, crypto.randomUUID())).status).toBe(404);
    expect((await get(mine.parent, "not-an-id")).status).toBe(404);
    expect((await get(maya.ctx, zedExportId)).status).toBe(403);

    const visitor = await get(testCtx(), zedExportId);
    expect(visitor.status).toBe(303);
    expect(visitor.headers.get("location")).toBe("/signin?as=parent&next=%2Fparent%2Fprivacy");
  });
});

describe("an 18-year-old's own data page", () => {
  it("exists for a learner aged 18, is 'not found' under 18, and its actions only ever act on the account that is signed in", async () => {
    const { mine, maya, zedDeletionId } = world;
    const adults = await makeFamily([{ nickname: "Sam", age: 18 }], { now: NOW });
    const sam = adults.children[0]!;
    const page = await html(sam.ctx, () => ownPrivacyPage());
    expect(page).toContain("Download your data");
    expect(page).not.toMatch(/Maya|Zed|Yara/);
    expect(await open(maya.ctx, () => ownPrivacyPage())).toEqual({ kind: "not_found" });
    expect((await open(mine.parent, () => ownPrivacyPage())).kind).toBe("redirect");
    expect(await open(testCtx(), () => ownPrivacyPage())).toEqual({ kind: "redirect", to: "/signin?next=%2Fsettings%2Fprivacy" });

    // Under 18: refused. A parent or visitor: refused.
    expect(await act(maya.ctx, ownPrivacyActions.requestOwnExportAction, {})).toBe("forbidden");
    expect(await act(maya.ctx, ownPrivacyActions.deleteOwnAccountAction, { confirm: "on", confirmWord: "DELETE" })).toBe("forbidden");
    expect(await act(mine.parent, ownPrivacyActions.requestOwnExportAction, {})).toBe("forbidden");
    expect(await act(testCtx(), ownPrivacyActions.deleteOwnAccountAction, { confirm: "on", confirmWord: "DELETE" })).toBe("unauthenticated");
    // An adult cannot undo another family's deletion by its id.
    expect(await act(sam.ctx, ownPrivacyActions.keepOwnAccountAction, { requestId: zedDeletionId })).toBe("not_found");
    expect(await db.select().from(dataRequest).where(eq(dataRequest.id, zedDeletionId))).toMatchObject([{ status: "requested" }]);

    // For themselves it works: a download, a deletion that leaves them able to undo it, and the undo.
    expect(await act(sam.ctx, ownPrivacyActions.requestOwnExportAction, {})).toBe("ok");
    expect(await act(sam.ctx, ownPrivacyActions.deleteOwnAccountAction, { confirm: "on", confirmWord: "DELETE" })).toBe("ok");
    expect((await userRow(sam.id))?.status).toBe("pending_deletion");
    const [mineToUndo] = await db.select().from(dataRequest).where(and(eq(dataRequest.learnerId, sam.id), eq(dataRequest.kind, "delete")));
    const waiting = { ...sam.ctx, actor: { ...sam.ctx.actor, status: "pending_deletion" as const } };
    expect(await html(waiting, () => ownPrivacyPage())).toContain("Your account will be deleted on");
    expect(await act(waiting, ownPrivacyActions.keepOwnAccountAction, { requestId: mineToUndo!.id })).toBe("ok");
    expect((await userRow(sam.id))?.status).toBe("active");
  });
});
