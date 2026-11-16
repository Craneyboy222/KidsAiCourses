/**
 * The learning API routes, called as handlers with a real database. `resolveCtx` (the session
 * lookup) is replaced with the test's actor; everything after it is the real route and service.
 */
import { eq, sql } from "drizzle-orm";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseView, PlayerView } from "@/components/course";
import type { Ctx } from "@/server/context";
import { aiRequest, auditLog, course, enrolment, metricCounter, notification, quizAttempt, reflection, stepProgress, usageDay, wishlist } from "@/server/db";
import { db, testCtx } from "../../helpers/db";
import { createFamily } from "../../helpers/factories";
import { AFTERNOON, FREE_SLUG, PAID_SLUG, courseBySlug, learner, publishNewVersion, publishedContent, seedPublishedCourses, setControls, setPlanCoversEverything, useLearningMocks } from "./helpers";

vi.mock("@/server/services/start-gate", () => ({ checkStart: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, redirect: () => { throw new Error("redirect"); }, useRouter: () => ({ push: () => {} }) }));

let current: Ctx = testCtx();
vi.mock("@/server/context", async (original) => ({ ...(await original<typeof import("@/server/context")>()), resolveCtx: async () => current, getCtx: async () => current }));

const BASE = "http://localhost";
const request = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new Request(`${BASE}${path}`, { method: init.method ?? "GET", headers: { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const ctxOf = <T extends object>(params: T) => ({ params: Promise.resolve(params) });
const json = async (response: Response) => (await response.json()) as Record<string, unknown> & { error?: { code: string; message: string } };

beforeAll(seedPublishedCourses);
beforeEach(() => {
  useLearningMocks();
  current = testCtx(undefined, { now: AFTERNOON });
});

describe("GET /api/v1/courses", () => {
  it("serves the public catalogue signed out, and a learner's own catalogue signed in", async () => {
    const { GET } = await import("@/app/api/v1/courses/route");
    await publishNewVersion("make-your-own-ai-music-video", (content) => {
      content.minAge = 16;
    });
    const open = await json(await GET(request("/api/v1/courses?sort=shortest")));
    expect((open.items as { slug: string }[]).map((item) => item.slug)).toContain("make-your-own-ai-music-video");
    expect(open.total).toBe(5);

    const child = await learner({ age: 14 });
    current = child.ctx;
    setPlanCoversEverything(false);
    const response = await GET(request("/api/v1/courses"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const mine = await json(response);
    const items = mine.items as { slug: string; locked: boolean }[];
    expect(items.map((item) => item.slug)).not.toContain("make-your-own-ai-music-video");
    expect(items.find((item) => item.slug === PAID_SLUG)?.locked).toBe(true);
    expect(JSON.stringify(mine)).not.toMatch(/£|pence|price/i);
  });
});

describe("GET /api/v1/courses/:slug", () => {
  it("returns an outline, 404 for a course the learner may not see, and never step content", async () => {
    const { GET } = await import("@/app/api/v1/courses/[slug]/route");
    const open = await GET(request(`/api/v1/courses/${FREE_SLUG}`), ctxOf({ slug: FREE_SLUG }));
    expect(open.status).toBe(200);
    expect(JSON.stringify(await json(open))).not.toMatch(/"body"|"hints"|"config"|"quizzes"|"feedback"|"correct"|coachContext/);

    const child = await learner({ age: 14 });
    current = child.ctx;
    const hidden = await GET(request("/api/v1/courses/make-your-own-ai-music-video"), ctxOf({ slug: "make-your-own-ai-music-video" }));
    const missing = await GET(request("/api/v1/courses/no-such-course"), ctxOf({ slug: "no-such-course" }));
    expect(hidden.status).toBe(404);
    expect(await json(hidden)).toEqual(await json(missing));
    expect((await GET(request("/api/v1/courses/NOT%20A%20SLUG"), ctxOf({ slug: "NOT A SLUG" }))).status).toBe(404);
  });
});

describe("enrolment, autosave, quiz, wishlist and heartbeat routes", () => {
  it("turn away anyone who is not a signed-in learner", async () => {
    const enrolments = await import("@/app/api/v1/enrolments/route");
    const heartbeat = await import("@/app/api/v1/usage/heartbeat/route");
    const saved = await import("@/app/api/v1/wishlist/route");
    expect((await enrolments.GET(request("/api/v1/enrolments"))).status).toBe(401);
    expect((await enrolments.POST(request("/api/v1/enrolments", { method: "POST", body: { courseSlug: FREE_SLUG } }))).status).toBe(401);
    expect((await heartbeat.POST(request("/api/v1/usage/heartbeat", { method: "POST", body: { seconds: 30 } }))).status).toBe(401);
    const { parentActor } = await createFamily();
    current = testCtx(parentActor, { now: AFTERNOON });
    expect((await saved.GET(request("/api/v1/wishlist"))).status).toBe(403);
    expect((await enrolments.POST(request("/api/v1/enrolments", { method: "POST", body: { courseSlug: FREE_SLUG } }))).status).toBe(403);
  });

  it("carry a learner from Start through autosave, a quiz attempt and a heartbeat", async () => {
    const enrolments = await import("@/app/api/v1/enrolments/route");
    const one = await import("@/app/api/v1/enrolments/[id]/route");
    const steps = await import("@/app/api/v1/enrolments/[id]/steps/[stepKey]/route");
    const quiz = await import("@/app/api/v1/enrolments/[id]/steps/[stepKey]/quiz-attempts/route");
    const heartbeat = await import("@/app/api/v1/usage/heartbeat/route");
    const wish = await import("@/app/api/v1/wishlist/[courseId]/route");
    const wishList = await import("@/app/api/v1/wishlist/route");
    const child = await learner();
    current = child.ctx;

    const started = await enrolments.POST(request("/api/v1/enrolments", { method: "POST", body: { courseSlug: FREE_SLUG } }));
    expect(started.status).toBe(201);
    const id = ((await json(started)).enrolment as { id: string }).id;
    expect((await enrolments.POST(request("/api/v1/enrolments", { method: "POST", body: { courseSlug: FREE_SLUG } }))).status).toBe(200);
    expect((await enrolments.POST(request("/api/v1/enrolments", { method: "POST", body: { courseSlug: "Bad Slug", extra: 1 } }))).status).toBe(422);

    const save = await steps.PUT(request(`/api/v1/enrolments/${id}/steps/s3`, { method: "PUT", body: { intent: "complete", notes: "note", data: { ticked: true } } }), ctxOf({ id, stepKey: "s3" }));
    expect(await json(save)).toMatchObject({ saved: true, status: "completed", stopped: null, nextStepKey: "s4" });
    // Unknown fields (such as trying to set evidence) are refused outright.
    const forged = await steps.PUT(request(`/api/v1/enrolments/${id}/steps/s26`, { method: "PUT", body: { intent: "complete", data: { evidence: "accepted" } } }), ctxOf({ id, stepKey: "s26" }));
    expect(forged.status).toBe(422);

    const attempt = await quiz.POST(request(`/api/v1/enrolments/${id}/steps/s12/quiz-attempts`, { method: "POST", body: { answers: { q1: ["a"] } } }), ctxOf({ id, stepKey: "s12" }));
    const graded = await json(attempt);
    expect(graded).toMatchObject({ attemptNumber: 1, total: 3 });
    // Feedback comes back for the option chosen (q1: a) and for nothing else.
    const full = await publishedContent(FREE_SLUG);
    const [first, ...rest] = full.quizzes[0]?.questions ?? [];
    const notChosen = [...(first?.options.filter((option) => option.id !== "a") ?? []), ...rest.flatMap((question) => question.options)];
    expect(notChosen.length).toBeGreaterThan(5);
    for (const option of notChosen) if (option.feedback) expect(JSON.stringify(graded)).not.toContain(option.feedback);

    const state = await json(await one.GET(request(`/api/v1/enrolments/${id}`), ctxOf({ id })));
    // The quiz was the last step touched and is not passed yet, so that is where "Continue" goes.
    expect(state.resumeStepKey).toBe("s12");
    expect((state.steps as { key: string; status: string }[]).find((entry) => entry.key === "s3")?.status).toBe("completed");
    expect(JSON.stringify(state)).not.toMatch(/"body"|"hints"|"quizzes"/);

    expect(await json(await heartbeat.POST(request("/api/v1/usage/heartbeat", { method: "POST", body: { seconds: 30 } })))).toEqual({ allowed: true, minutesLeftToday: null });
    setControls({ dailyMinutesCap: 0 });
    expect(await json(await heartbeat.POST(request("/api/v1/usage/heartbeat", { method: "POST", body: { seconds: 30 } })))).toMatchObject({ allowed: false, reason: "time_cap" });
    const capped = await steps.PUT(request(`/api/v1/enrolments/${id}/steps/s5`, { method: "PUT", body: { intent: "complete", notes: "typed at the cap" } }), ctxOf({ id, stepKey: "s5" }));
    expect(await json(capped)).toMatchObject({ saved: true, status: "in_progress", stopped: { reason: "time_cap" } });
    const refusedQuiz = await quiz.POST(request(`/api/v1/enrolments/${id}/steps/s12/quiz-attempts`, { method: "POST", body: { answers: {} } }), ctxOf({ id, stepKey: "s12" }));
    expect(refusedQuiz.status).toBe(403);
    expect((await json(refusedQuiz)).error?.code).toBe("time_cap_reached");
    setControls({});

    const target = await courseBySlug(PAID_SLUG);
    expect(await json(await wish.PUT(request(`/api/v1/wishlist/${target.id}`, { method: "PUT" }), ctxOf({ courseId: target.id })))).toEqual({ saved: true });
    expect(((await json(await wishList.GET(request("/api/v1/wishlist")))).items as { slug: string }[]).map((item) => item.slug)).toEqual([PAID_SLUG]);
    expect(await json(await wish.DELETE(request(`/api/v1/wishlist/${target.id}`, { method: "DELETE" }), ctxOf({ courseId: target.id })))).toEqual({ saved: false });
    expect(await db.select().from(wishlist).where(eq(wishlist.learnerId, child.actor.userId))).toHaveLength(0);

    // Another learner cannot read or write this enrolment through any route.
    const other = await learner();
    current = other.ctx;
    expect((await one.GET(request(`/api/v1/enrolments/${id}`), ctxOf({ id }))).status).toBe(404);
    expect((await steps.PUT(request(`/api/v1/enrolments/${id}/steps/s3`, { method: "PUT", body: { intent: "save", notes: "x" } }), ctxOf({ id, stepKey: "s3" }))).status).toBe(404);
    expect((await quiz.POST(request(`/api/v1/enrolments/${id}/steps/s12/quiz-attempts`, { method: "POST", body: { answers: {} } }), ctxOf({ id, stepKey: "s12" }))).status).toBe(404);
  });
});

describe("the shared views in a staff preview", () => {
  const counts = async () => {
    const tables = { enrolment, stepProgress, quizAttempt, reflection, usageDay, wishlist, aiRequest, metricCounter, notification, auditLog };
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(tables)) out[name] = (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? 0;
    out.enrolmentCountTotal = (await db.select({ n: sql<number>`coalesce(sum(${course.enrolmentCount}), 0)::int` }).from(course))[0]?.n ?? 0;
    return out;
  };
  const toHtml = async (element: ReactElement) => {
    const stream = await renderToReadableStream(element);
    await stream.allReady;
    return new Response(stream).text();
  };

  it("render a full draft safely and write nothing: no enrolment, progress or analytics", async () => {
    const draft = structuredClone(await publishedContent(FREE_SLUG));
    draft.editorNotes = "STAFF-ONLY NOTE";
    draft.verifyFlags = [{ path: "title", claim: "UNVERIFIED CLAIM" }];
    const target = await courseBySlug(FREE_SLUG);
    const mode = { kind: "preview", versionId: target.workingVersionId ?? "", asBand: "teen_13_15", canEdit: false } as const;
    const before = await counts();

    const page = await toHtml(createElement(CourseView, { content: draft, courseId: target.id, mode: { ...mode, playerBasePath: `/studio/preview/${mode.versionId}/learn` } }) as ReactElement);
    expect(page).toContain("Staff preview");
    expect(page).toContain(`href="/studio/preview/${mode.versionId}/learn/s1"`);
    const leaks = [...draft.quizzes.flatMap((quiz) => quiz.questions.flatMap((question) => question.options.map((option) => option.feedback))), ...draft.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.steps.map((step) => step.coachContext ?? "")))].filter((text) => text.length > 20);
    expect(leaks.length).toBeGreaterThan(20);

    for (const stepKey of ["s1", "s2", "s3", "s12", "s17", "s24", "s26"]) {
      const step = await toHtml(createElement(PlayerView, { content: draft, courseId: target.id, mode, stepKey, courseHref: `/studio/preview/${mode.versionId}`, playerBasePath: `/studio/preview/${mode.versionId}/learn` }) as ReactElement);
      expect(step).toContain("Staff preview");
      expect(step).not.toMatch(/STAFF-ONLY NOTE|UNVERIFIED CLAIM|coachContext|referenceSolution/);
      for (const text of leaks) expect(step).not.toContain(text.slice(0, 40).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"));
    }
    expect(page).not.toMatch(/STAFF-ONLY NOTE|UNVERIFIED CLAIM/);
    expect(await counts()).toEqual(before);
  });
});
