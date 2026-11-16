import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { course, toolChangeEvent, unlockRequest } from "@/server/db";
import { assertStartAllowed, startError } from "@/server/services/course-tools";
import { takeDownCourse } from "@/server/services/publish";
import { checkStart } from "@/server/services/start-gate";
import { decideToolApproval, requestToolApproval } from "@/server/services/tool-approval";
import { db, testCtx } from "../../helpers/db";
import { createLearner } from "../../helpers/factories";
import { appError } from "../content/helpers";
import { HOMEWORK, SNAPCHAT, courseBySlug, enrol, family, resetTools, seedCourses, setControls, setLearning, setPlanCoversEverything, setTool, staffCtx, tearDownStorage, toolBySlug, useToolMocks } from "./helpers";

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
  await db.delete(toolChangeEvent);
});

const codes = async (ctx: Parameters<typeof checkStart>[0], learnerId: string, courseId: string) => (await checkStart(ctx, learnerId, courseId)).blockers.map((blocker) => blocker.code);

describe("checkStart: every blocker, against the database", () => {
  it("lets a learner start a live course with approved tools", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(SNAPCHAT);
    expect(await checkStart(learner, learnerId, target.id)).toEqual({ allowed: true, blockers: [] });
    await expect(assertStartAllowed(learner, learnerId, target.id)).resolves.toBeUndefined();
  });

  it("keeps a needs_review course available, and refuses one that is taken down or unknown", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(HOMEWORK);
    await db.update(course).set({ status: "needs_review" }).where(eq(course.id, target.id));
    expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
    await db.update(course).set({ status: "published" }).where(eq(course.id, target.id));

    // A course no other test uses: a take-down is not undone by hand.
    const doomed = await courseBySlug("shoot-a-promo-advert-in-an-afternoon");
    expect((await checkStart(learner, learnerId, doomed.id)).allowed).toBe(true);
    await takeDownCourse(await staffCtx("super_admin"), doomed.id, "Test take-down");
    expect(await codes(learner, learnerId, doomed.id)).toEqual(["course_unavailable"]);

    expect(await codes(learner, learnerId, "00000000-0000-4000-8000-000000000000")).toEqual(["course_unavailable"]);
    await db.update(course).set({ status: "draft" }).where(eq(course.id, target.id));
    expect(await codes(learner, learnerId, target.id)).toEqual(["course_unavailable"]);
    await db.update(course).set({ status: "published" }).where(eq(course.id, target.id));
  });

  it("enforces the course's minimum age whatever else is true", async () => {
    const young = await family({ age: 14 });
    const older = await family({ age: 16 });
    const target = await courseBySlug(SNAPCHAT);
    await db.update(course).set({ minAge: 16 }).where(eq(course.id, target.id));
    try {
      expect(await codes(young.learner, young.learnerId, target.id)).toEqual(["age_restricted"]);
      expect((await checkStart(older.learner, older.learnerId, target.id)).allowed).toBe(true);
      // Hidden: the error is the same as for a course that does not exist.
      const refused = await appError(() => assertStartAllowed(young.learner, young.learnerId, target.id));
      const missing = await appError(() => assertStartAllowed(young.learner, young.learnerId, "00000000-0000-4000-8000-000000000000"));
      expect([refused.code, refused.status, refused.message]).toEqual([missing.code, missing.status, missing.message]);
      expect(refused.code).toBe("not_found");
    } finally {
      await db.update(course).set({ minAge: 13 }).where(eq(course.id, target.id));
    }
  });

  it("honours a parent's block on the course and on its category", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(SNAPCHAT);
    setControls({ blockedCourseIds: [target.id] });
    expect(await codes(learner, learnerId, target.id)).toEqual(["parent_blocked"]);
    setControls({ blockedCategories: [target.category ?? "none"] });
    expect(await codes(learner, learnerId, target.id)).toEqual(["parent_blocked"]);
    setControls({ blockedCategories: ["some-other-category"] });
    expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
  });

  it.each(["paused", "consent", "time_cap", "quiet_hours", "not_active"] as const)("passes on the %s stop from the learning check", async (reason) => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(HOMEWORK);
    setLearning({ allowed: false, reason, message: `Stopped: ${reason}` });
    const decision = await checkStart(learner, learnerId, target.id);
    expect(decision).toEqual({ allowed: false, blockers: [{ code: "not_allowed_now", reason, message: `Stopped: ${reason}` }] });
    expect(startError(decision)?.code).toBe({ paused: "paused", consent: "consent_required", time_cap: "time_cap_reached", quiet_hours: "quiet_hours", not_active: "paused" }[reason]);
  });

  it("needs the plan to cover a paid course, and never for a free one", async () => {
    const { learner, learnerId } = await family();
    setPlanCoversEverything(false);
    const paid = await courseBySlug(SNAPCHAT);
    const free = await courseBySlug(HOMEWORK);
    const decision = await checkStart(learner, learnerId, paid.id);
    expect(decision.blockers).toEqual([{ code: "entitlement_required", message: expect.any(String), ask: "unlock_paid_course" }]);
    expect(startError(decision)).toMatchObject({ code: "entitlement_required", status: 403 });
    expect(JSON.stringify(decision)).not.toMatch(/£|price|\bpay/i);
    expect((await checkStart(learner, learnerId, free.id)).allowed).toBe(true);
  });

  it("asks for a parent's say-so on a Pro course only when the parent wants that", async () => {
    const { learner, learnerId, familyId } = await family();
    const target = await courseBySlug(HOMEWORK);
    await db.update(course).set({ difficulty: "pro" }).where(eq(course.id, target.id));
    try {
      expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
      setControls({ requireApprovalForPro: true });
      expect(await codes(learner, learnerId, target.id)).toEqual(["pro_approval_required"]);
      await db.insert(unlockRequest).values({ learnerId, familyId, courseId: target.id, kind: "pro_course", status: "pending" });
      expect(await codes(learner, learnerId, target.id)).toEqual(["pro_approval_required"]);
      await db.update(unlockRequest).set({ status: "approved" }).where(eq(unlockRequest.learnerId, learnerId));
      expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
      // Another course at Starter level is not affected.
      expect((await checkStart(learner, learnerId, (await courseBySlug(SNAPCHAT)).id)).allowed).toBe(true);
    } finally {
      await db.update(course).set({ difficulty: "starter" }).where(eq(course.id, target.id));
    }
  });
});

describe("checkStart: required tools", () => {
  it("blocks when the tool is blocked, unverified, or too old for the learner", async () => {
    const { learner, learnerId } = await family({ age: 14 });
    const target = await courseBySlug(HOMEWORK); // chatgpt, no fallback
    for (const patch of [{ status: "blocked" }, { status: "pending_verification" }, { status: "retired" }, { under18Policy: "blocked" }, { minAge: 16 }, { minAge: null }] as const) {
      await resetTools();
      await setTool("chatgpt", patch);
      const decision = await checkStart(learner, learnerId, target.id);
      expect(decision.blockers).toEqual([{ code: "tool_blocked", message: expect.any(String), toolSlug: "chatgpt", toolName: expect.any(String) }]);
      expect(startError(decision)?.code).toBe("tool_blocked");
    }
  });

  it("satisfies a blocked main tool with its approved fallback", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(SNAPCHAT); // replit, fallback base44
    await setTool("replit", { status: "blocked" });
    expect(await checkStart(learner, learnerId, target.id)).toEqual({ allowed: true, blockers: [] });

    await setTool("base44", { status: "blocked" });
    expect(await codes(learner, learnerId, target.id)).toEqual(["tool_blocked"]);

    await setTool("base44", { status: "approved", under18Policy: "parent_consent_required" });
    const decision = await checkStart(learner, learnerId, target.id);
    expect(decision.blockers).toMatchObject([{ code: "tool_approval_required", toolSlug: "base44", status: "none", policy: "parent_consent_required" }]);
  });

  it("holds the course while an age-policy change on a required tool is open, and releases it once triaged", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(HOMEWORK);
    const chatgpt = await toolBySlug("chatgpt");
    const [event] = await db.insert(toolChangeEvent).values({ toolId: chatgpt.id, pageUrl: "https://chatgpt.com/terms", impact: "age_policy", status: "open", blocksStart: true }).returning();
    const decision = await checkStart(learner, learnerId, target.id);
    expect(decision.blockers).toMatchObject([{ code: "tool_on_hold", toolSlug: "chatgpt" }]);
    expect(startError(decision)?.code).toBe("tool_blocked");

    await db.update(toolChangeEvent).set({ status: "triaged", triagedAt: new Date() }).where(eq(toolChangeEvent.id, event?.id ?? ""));
    expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
  });

  it("does not hold for a change that is not about age, or for a tool the course does not use", async () => {
    const { learner, learnerId } = await family();
    const target = await courseBySlug(HOMEWORK);
    await db.insert(toolChangeEvent).values({ toolId: (await toolBySlug("chatgpt")).id, pageUrl: "https://chatgpt.com/pricing", impact: "pricing", status: "open" });
    await db.insert(toolChangeEvent).values({ toolId: (await toolBySlug("canva")).id, pageUrl: "https://www.canva.com/terms", impact: "age_policy", status: "open", blocksStart: true });
    expect((await checkStart(learner, learnerId, target.id)).allowed).toBe(true);
  });

  it("needs a valid parent approval for a consent-required tool, for this learner and this course", async () => {
    const one = await family();
    const sibling = await createLearner({ age: 15, familyId: one.familyId });
    const target = await courseBySlug(HOMEWORK);
    await setTool("chatgpt", { under18Policy: "parent_consent_required" });

    expect((await checkStart(one.learner, one.learnerId, target.id)).blockers).toMatchObject([{ code: "tool_approval_required", status: "none", ask: "tool_approval" }]);
    const request = await requestToolApproval(one.learner, { learnerId: one.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect((await checkStart(one.learner, one.learnerId, target.id)).blockers).toMatchObject([{ code: "tool_approval_required", status: "pending" }]);
    expect(startError(await checkStart(one.learner, one.learnerId, target.id))?.code).toBe("parent_approval_required");

    await decideToolApproval(one.parent, request.id, "approve");
    expect((await checkStart(one.learner, one.learnerId, target.id)).allowed).toBe(true);
    // The approval is for one learner: a sibling still needs their own.
    expect((await checkStart(testCtx(sibling.actor), sibling.user.id, target.id)).blockers).toMatchObject([{ code: "tool_approval_required", status: "none" }]);
  });

  it("uses the version the learner started, not a later one", async () => {
    const { learner, learnerId } = await family();
    await enrol(learnerId, SNAPCHAT);
    const target = await courseBySlug(SNAPCHAT);
    await setTool("replit", { under18Policy: "parent_consent_required" });
    expect(await codes(learner, learnerId, target.id)).toEqual(["tool_approval_required"]);
  });
});

describe("checkStart: who may ask", () => {
  it("answers the learner, their own parent, staff and jobs, and nobody else", async () => {
    const mine = await family();
    const other = await family();
    const target = await courseBySlug(HOMEWORK);
    expect((await checkStart(mine.parent, mine.learnerId, target.id)).allowed).toBe(true);
    expect((await checkStart(await staffCtx("support"), mine.learnerId, target.id)).allowed).toBe(true);
    expect((await appError(() => checkStart(other.parent, mine.learnerId, target.id))).code).toBe("forbidden");
    expect((await appError(() => checkStart(other.learner, mine.learnerId, target.id))).code).toBe("forbidden");
    expect((await appError(() => checkStart(testCtx(), mine.learnerId, target.id))).code).toBe("unauthenticated");
  });
});
