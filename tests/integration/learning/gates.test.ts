import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enrolment, stepProgress, wishlist } from "@/server/db";
import { listCatalogue, recommendForLearner } from "@/server/services/catalogue";
import { getLearnerCoursePage, getPublicCoursePage } from "@/server/services/course-page";
import { getEnrolment, startCourse } from "@/server/services/enrolment";
import { loadPlayer, saveStep } from "@/server/services/progress";
import { takeDownCourse } from "@/server/services/publish";
import { saveForLater } from "@/server/services/wishlist";
import { db, testCtx } from "../../helpers/db";
import { appError, ctxFor, staff } from "../content/helpers";
import { FREE_SLUG, OTHER_FREE_SLUG, PAID_SLUG, courseBySlug, learner, publishNewVersion, seedPublishedCourses, setControls, setPlanCoversEverything, setStartBlockers, useLearningMocks } from "./helpers";

vi.mock("@/server/services/start-gate", () => ({ checkStart: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));

beforeAll(seedPublishedCourses);
beforeEach(useLearningMocks);

const AGE_16_SLUG = "make-your-own-ai-music-video";

/** Republishes one seed course with a minimum age of 16, so there is something a 14-year-old must not see. */
async function makeCourseSixteenPlus(): Promise<void> {
  const row = await courseBySlug(AGE_16_SLUG);
  if (row.minAge === 16) return;
  await publishNewVersion(AGE_16_SLUG, (content) => {
    content.minAge = 16;
    content.pathways = ["sixth_form"];
  });
}

describe("age gate", () => {
  beforeAll(makeCourseSixteenPlus);

  it("never lists a course above the learner's age, whatever filters are sent", async () => {
    const young = await learner({ age: 14 });
    const all = await listCatalogue(young.ctx, { kind: "learner", learnerId: young.actor.userId }, { limit: 60 });
    expect(all.items.map((item) => item.slug)).not.toContain(AGE_16_SLUG);
    expect(all.total).toBe(4);

    // Browsing the sixth-form pathway is allowed; it still cannot surface a 16+ course.
    const byPathway = await listCatalogue(young.ctx, { kind: "learner", learnerId: young.actor.userId }, { pathway: "sixth_form", q: "music video" });
    expect(byPathway.items.map((item) => item.slug)).not.toContain(AGE_16_SLUG);
    expect((await recommendForLearner(young.ctx, young.actor.userId, 20)).map((item) => item.slug)).not.toContain(AGE_16_SLUG);

    const older = await learner({ age: 16 });
    const forOlder = await listCatalogue(older.ctx, { kind: "learner", learnerId: older.actor.userId }, { limit: 60 });
    expect(forOlder.items.map((item) => item.slug)).toContain(AGE_16_SLUG);
  });

  it("gives a learner their own view even when the public one is asked for", async () => {
    const young = await learner({ age: 14 });
    const result = await listCatalogue(young.ctx, { kind: "public" }, { limit: 60 });
    expect(result.items.map((item) => item.slug)).not.toContain(AGE_16_SLUG);
    // Signed out, the same course is on the public catalogue.
    expect((await listCatalogue(testCtx(), { kind: "public" }, { limit: 60 })).items.map((item) => item.slug)).toContain(AGE_16_SLUG);
  });

  it("answers a direct link exactly like a course that does not exist", async () => {
    const young = await learner({ age: 14 });
    const id = young.actor.userId;
    expect(await getLearnerCoursePage(young.ctx, id, AGE_16_SLUG)).toEqual({ kind: "not_found" });
    expect(await getLearnerCoursePage(young.ctx, id, "no-such-course")).toEqual({ kind: "not_found" });
    expect(await loadPlayer(young.ctx, { learnerId: id, courseSlug: AGE_16_SLUG, stepKey: "s1" })).toEqual({ kind: "not_found" });

    const refused = await appError(() => startCourse(young.ctx, { learnerId: id, courseSlug: AGE_16_SLUG }));
    const missing = await appError(() => startCourse(young.ctx, { learnerId: id, courseSlug: "no-such-course" }));
    expect({ code: refused.code, status: refused.status, message: refused.message }).toEqual({ code: missing.code, status: missing.status, message: missing.message });
    expect(refused.code).toBe("not_found");
    expect(await db.select().from(enrolment).where(eq(enrolment.learnerId, id))).toHaveLength(0);

    const target = await courseBySlug(AGE_16_SLUG);
    expect((await appError(() => saveForLater(young.ctx, id, target.id))).code).toBe("not_found");
    expect(await db.select().from(wishlist).where(eq(wishlist.learnerId, id))).toHaveLength(0);
  });

  it("still refuses when the start gate itself says yes", async () => {
    // `checkStart` is mocked to allow everything here: the age check must not depend on it.
    setStartBlockers([]);
    const young = await learner({ age: 13 });
    expect((await appError(() => startCourse(young.ctx, { learnerId: young.actor.userId, courseSlug: AGE_16_SLUG }))).code).toBe("not_found");
  });
});

describe("parent blocks", () => {
  it("hides a blocked course and a blocked category, and refuses a direct link", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const blockedCourse = await courseBySlug(FREE_SLUG);
    const inBlockedCategory = await courseBySlug(OTHER_FREE_SLUG);
    setControls({ blockedCourseIds: [blockedCourse.id], blockedCategories: [inBlockedCategory.category ?? ""] });

    const slugs = (await listCatalogue(child.ctx, { kind: "learner", learnerId: id }, { limit: 60 })).items.map((item) => item.slug);
    expect(slugs).not.toContain(FREE_SLUG);
    expect(slugs).not.toContain(OTHER_FREE_SLUG);
    expect(await getLearnerCoursePage(child.ctx, id, FREE_SLUG)).toEqual({ kind: "not_found" });
    expect(await getLearnerCoursePage(child.ctx, id, OTHER_FREE_SLUG)).toEqual({ kind: "not_found" });
    expect((await appError(() => startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG }))).code).toBe("not_found");
    expect((await appError(() => saveForLater(child.ctx, id, blockedCourse.id))).code).toBe("not_found");
  });

  it("closes a course the learner had already started, and refuses autosave", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const started = await startCourse(child.ctx, { learnerId: id, courseSlug: OTHER_FREE_SLUG });
    const target = await courseBySlug(OTHER_FREE_SLUG);
    setControls({ blockedCourseIds: [target.id] });

    expect(await loadPlayer(child.ctx, { learnerId: id, courseSlug: OTHER_FREE_SLUG, stepKey: "s1" })).toEqual({ kind: "not_found" });
    const refused = await appError(() => saveStep(child.ctx, { enrolmentId: started.enrolment.id, stepKey: "s1", intent: "save", notes: "should not be stored" }));
    expect(refused.code).toBe("not_found");
    expect(await db.select().from(stepProgress).where(eq(stepProgress.enrolmentId, started.enrolment.id))).toHaveLength(0);
  });
});

describe("locked paid course on the Free plan", () => {
  it("is listed as locked, with no price and no content anywhere in the payload", async () => {
    setPlanCoversEverything(false);
    const child = await learner();
    const id = child.actor.userId;

    const list = await listCatalogue(child.ctx, { kind: "learner", learnerId: id }, { limit: 60 });
    const card = list.items.find((item) => item.slug === PAID_SLUG);
    expect(card?.locked).toBe(true);
    expect(list.items.find((item) => item.slug === FREE_SLUG)?.locked).toBe(false);

    const page = await getLearnerCoursePage(child.ctx, id, PAID_SLUG);
    if (page.kind !== "ok") throw new Error("expected the locked course page");
    expect(page.locked).toBe(true);
    expect(page.gate.decision.blockers.map((blocker) => blocker.code)).toContain("entitlement_required");

    const payload = JSON.stringify({ list, page });
    expect(payload).not.toMatch(/£|\bpence\b|price|per month|\/month|14\.99|119/i);
    // An outline only: step titles and timings, never what is inside a step.
    const step = page.course.modules[0]?.lessons[0]?.steps[1];
    expect(Object.keys(step ?? {}).sort()).toEqual(["estimatedMinutes", "id", "title", "type"]);
    expect(payload).not.toMatch(/"body"|"hints"|"config"|"quizzes"|"coachContext"|"feedback"|"correct"/);
    expect(payload).not.toContain("Have you verified your email yet?");
  });

  it("cannot be started or opened, by the button or by a direct request", async () => {
    setPlanCoversEverything(false);
    const child = await learner();
    const id = child.actor.userId;
    const refused = await appError(() => startCourse(child.ctx, { learnerId: id, courseSlug: PAID_SLUG }));
    expect(refused.code).toBe("entitlement_required");
    expect(refused.message).not.toMatch(/£|price|pay|subscri/i);
    expect(await getEnrolment(child.ctx, id, (await courseBySlug(PAID_SLUG)).id)).toBeNull();
    expect((await loadPlayer(child.ctx, { learnerId: id, courseSlug: PAID_SLUG, stepKey: "s1" })).kind).toBe("not_enrolled");
  });

  it("locks the player again if the plan stops covering a course already started", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const started = await startCourse(child.ctx, { learnerId: id, courseSlug: PAID_SLUG });
    setPlanCoversEverything(false);
    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: PAID_SLUG, stepKey: "s1" });
    expect(player.kind).toBe("blocked");
    expect(JSON.stringify(player)).not.toMatch(/"modules"|"quizzes"/);
    expect((await appError(() => saveStep(child.ctx, { enrolmentId: started.enrolment.id, stepKey: "s1", intent: "complete" }))).code).toBe("entitlement_required");
  });
});

describe("start gate blockers", () => {
  it("refuses Start while a tool still needs a parent's approval, and says why", async () => {
    const child = await learner();
    setStartBlockers([{ code: "tool_approval_required", message: "ChatGPT needs a parent's OK before you start.", toolSlug: "chatgpt", toolName: "ChatGPT", policy: "parent_consent_required", status: "none", ask: "tool_approval" }]);
    const refused = await appError(() => startCourse(child.ctx, { learnerId: child.actor.userId, courseSlug: FREE_SLUG }));
    expect(refused.code).toBe("parent_approval_required");
    expect(refused.message).toBe("ChatGPT needs a parent's OK before you start.");

    const page = await getLearnerCoursePage(child.ctx, child.actor.userId, FREE_SLUG);
    if (page.kind !== "ok") throw new Error("expected the course page");
    expect(page.gate.decision.allowed).toBe(false);
    expect(page.locked).toBe(false);
  });
});

describe("public course page", () => {
  it("shows an outline and nothing that gives a step away", async () => {
    const page = await getPublicCoursePage(testCtx(), FREE_SLUG);
    expect(page?.course.title).toBe("Homework Helper Chatbot (The Honest Kind)");
    expect(JSON.stringify(page)).not.toMatch(/"body"|"hints"|"config"|"quizzes"|"coachContext"|"feedback"|"correct"|editorNotes/);
    expect(await getPublicCoursePage(testCtx(), "no-such-course")).toBeNull();
  });
});

describe("taken-down course", () => {
  it("disappears from the catalogue, and an enrolled learner gets a notice and nothing else", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const slug = "shoot-a-promo-advert-in-an-afternoon";
    const started = await startCourse(child.ctx, { learnerId: id, courseSlug: slug });
    const target = await courseBySlug(slug);

    const moderator = await staff("moderator");
    await takeDownCourse(ctxFor(moderator), target.id, "A tool changed its age rules");

    expect((await listCatalogue(child.ctx, { kind: "learner", learnerId: id }, { limit: 60 })).items.map((item) => item.slug)).not.toContain(slug);
    expect((await listCatalogue(testCtx(), { kind: "public" }, { limit: 60 })).items.map((item) => item.slug)).not.toContain(slug);
    expect(await getPublicCoursePage(testCtx(), slug)).toBeNull();

    const page = await getLearnerCoursePage(child.ctx, id, slug);
    expect(page.kind).toBe("taken_down");
    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: slug, stepKey: "s1" });
    expect(player.kind).toBe("taken_down");
    expect(Object.keys(player).sort()).toEqual(["courseTitle", "kind"]);

    expect((await appError(() => saveStep(child.ctx, { enrolmentId: started.enrolment.id, stepKey: "s1", intent: "complete" }))).code).toBe("not_found");
    // Somebody who never started it cannot tell it from a course that never existed.
    const stranger = await learner();
    expect(await getLearnerCoursePage(stranger.ctx, stranger.actor.userId, slug)).toEqual({ kind: "not_found" });
    expect(await loadPlayer(stranger.ctx, { learnerId: stranger.actor.userId, courseSlug: slug })).toEqual({ kind: "not_found" });
  });
});
