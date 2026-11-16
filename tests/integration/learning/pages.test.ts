/**
 * Renders the real pages and layout to HTML, as the server would, against the real database.
 *
 * Next.js itself is not running: `getCtx` is replaced with the test's actor, and `redirect` /
 * `notFound` throw markers that the helper turns into a result. Everything else is the real code:
 * the page, the services, `CourseView`, `PlayerView` and the UI kit.
 *
 * Mocked contracts (other slices' bodies still throw): `checkStart`, `getControls`,
 * `canAccessCourse`. `ReportControl`, `ToolsYouNeed`, `UploadStep` and `SubmitStep` are the real
 * placeholders, which render nothing.
 */
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/context";
import { startCourse } from "@/server/services/enrolment";
import { saveStep } from "@/server/services/progress";
import { takeDownCourse } from "@/server/services/publish";
import { testCtx } from "../../helpers/db";
import { ctxFor, staff } from "../content/helpers";
import { AFTERNOON, FREE_SLUG, OTHER_FREE_SLUG, PAID_SLUG, courseBySlug, learner, publishNewVersion, publishedContent, seedPublishedCourses, setControls, setPlanCoversEverything, setStartBlockers, useLearningMocks } from "./helpers";

vi.mock("@/server/services/start-gate", () => ({ checkStart: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));

let current: Ctx = testCtx();
vi.mock("@/server/context", async (original) => {
  const real = await original<typeof import("@/server/context")>();
  return { ...real, getCtx: async () => current, requireLearner: async () => current };
});

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new NotFound();
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type Rendered = { kind: "html"; html: string; text: string } | { kind: "redirect"; to: string } | { kind: "not_found" };

async function render(build: () => Promise<ReactNode> | ReactNode): Promise<Rendered> {
  let thrown: unknown;
  try {
    const element = await build();
    const stream = await renderToReadableStream(element as ReactElement, {
      onError(error) {
        thrown ??= error;
      },
    });
    await stream.allReady;
    const html = await new Response(stream).text();
    if (thrown) throw thrown;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<template[\s\S]*?<\/template>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");
    return { kind: "html", html, text };
  } catch (error) {
    const cause = thrown ?? error;
    if (cause instanceof Redirected) return { kind: "redirect", to: cause.to };
    if (cause instanceof NotFound) return { kind: "not_found" };
    throw cause;
  }
}

const params = <T extends object>(value: T): Promise<T> => Promise.resolve(value);
const html = (result: Rendered): { html: string; text: string } => {
  if (result.kind !== "html") throw new Error(`expected a page, got ${JSON.stringify(result)}`);
  return result;
};
const h1Count = (markup: string): number => (markup.match(/<h1[\s>]/g) ?? []).length;
const mainCount = (markup: string): number => (markup.match(/<main[\s>]/g) ?? []).length;
const PRICE = /£|\bpence\b|\bprice|per month|\/month|a month|checkout|subscri/i;

async function pages() {
  const [layout, home, explore, course, resume, player, settings, publicList, publicCourse, taster] = await Promise.all([
    import("@/app/(learner)/layout"),
    import("@/app/(learner)/home/page"),
    import("@/app/(learner)/explore/page"),
    import("@/app/(learner)/explore/[slug]/page"),
    import("@/app/(player)/learn/[courseSlug]/page"),
    import("@/app/(player)/learn/[courseSlug]/[stepKey]/page"),
    import("@/app/(learner)/settings/page"),
    import("@/app/(marketing)/courses/page"),
    import("@/app/(marketing)/courses/[slug]/page"),
    import("@/app/(marketing)/courses/[slug]/taster/page"),
  ]);
  return {
    Layout: layout.default,
    Home: home.default,
    Explore: explore.default,
    Course: course.default,
    Resume: resume.default,
    Player: player.default,
    Settings: settings.default,
    PublicList: publicList.default,
    PublicCourse: publicCourse.default,
    Taster: taster.default,
  };
}

beforeAll(seedPublishedCourses);
beforeEach(() => {
  useLearningMocks();
  current = testCtx(undefined, { now: AFTERNOON });
});

describe("learner pages", () => {
  it("home: one h1, the learner's own lists, and nothing about money", async () => {
    const { Home, Layout } = await pages();
    const child = await learner({ interests: ["study", "writing", "apps"] });
    current = child.ctx;
    await startCourse(child.ctx, { learnerId: child.actor.userId, courseSlug: FREE_SLUG });
    setPlanCoversEverything(false);

    const page = html(await render(() => Home()));
    expect(h1Count(page.html)).toBe(1);
    expect(page.text).toContain("Hi Maya");
    expect(page.text).toContain("Continue learning");
    expect(page.text).toContain("0 of 26 steps done");
    expect(page.text).toContain("Made for you");
    expect(page.text).toContain("Ask a parent to unlock");
    expect(page.text).not.toMatch(PRICE);
    expect(page.text).not.toMatch(/streak|leaderboard|points|rank/i);

    // The frame adds the one <main> and the navigation; the page adds no second one.
    const framed = html(await render(() => Layout({ children: createElement("p", null, "page") })));
    expect(mainCount(framed.html)).toBe(1);
    expect(framed.text).toContain("Explore");
    expect(framed.text).toContain("Signed in as Maya");
  });

  it("layout: says why when the account is paused, in quiet hours or out of time", async () => {
    const { Layout } = await pages();
    const child = await learner();
    current = child.ctx;
    const frame = () => render(() => Layout({ children: createElement("p", null, "page") }));

    setControls({ paused: true });
    expect(html(await frame()).text).toContain("Your account is paused");
    setControls({ quietStartMin: 14 * 60, quietEndMin: 16 * 60 });
    const quiet = html(await frame()).text;
    expect(quiet).toContain("It's quiet hours");
    expect(quiet).toContain("16:00");
    setControls({ dailyMinutesCap: 0 });
    expect(html(await frame()).text).toContain("That's your learning time for today");
    setControls({});
    expect(html(await frame()).text).not.toMatch(/quiet hours|paused|learning time/);
  });

  it("sends everyone who is not a learner somewhere else", async () => {
    const { Layout, Home, Player } = await pages();
    current = testCtx();
    expect(await render(() => Layout({ children: null }))).toEqual({ kind: "redirect", to: "/signin" });
    expect(await render(() => Home())).toEqual({ kind: "redirect", to: "/signin?next=%2Fhome" });
    expect(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s1" }) }))).toMatchObject({ kind: "redirect", to: expect.stringContaining("/signin?next=") });
    current = ctxFor(await staff("editor"));
    expect(await render(() => Home())).toMatchObject({ kind: "redirect" });
    // A learner who has not finished onboarding is taken there from every page, but the frame still renders for /onboarding itself.
    const fresh = await learner({ onboarded: false });
    current = fresh.ctx;
    expect(await render(() => Home())).toEqual({ kind: "redirect", to: "/onboarding" });
    expect(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s1" }) }))).toEqual({ kind: "redirect", to: "/onboarding" });
    expect((await render(() => Layout({ children: createElement("p", null, "onboarding page") }))).kind).toBe("html");
  });

  it("explore: lists what the learner may see, with working filters", async () => {
    const { Explore } = await pages();
    const child = await learner();
    current = child.ctx;
    const all = html(await render(() => Explore({ searchParams: params({}) })));
    expect(h1Count(all.html)).toBe(1);
    expect(all.text).toContain("Prompt Gym");
    expect(all.html).toContain('href="/explore/homework-helper-chatbot-the-honest-kind"');
    expect(all.html).toContain('action="/explore"');

    const filtered = html(await render(() => Explore({ searchParams: params({ q: "chatbot", free: "1" }) })));
    expect(filtered.text).toContain("1 course match");
    expect(filtered.text).not.toContain("Prompt Gym");
    const none = html(await render(() => Explore({ searchParams: params({ q: "zzzz-nothing" }) })));
    expect(none.text).toContain("Nothing matches those filters");
  });

  it("course page: Start for a free course; a locked one asks a parent and shows no price", async () => {
    const { Course } = await pages();
    const child = await learner();
    current = child.ctx;
    const free = html(await render(() => Course({ params: params({ slug: FREE_SLUG }), searchParams: params({}) })));
    expect(h1Count(free.html)).toBe(1);
    expect(free.text).toContain("Start this project");
    expect(free.text).toContain("What you'll make");
    expect(free.text).toContain("How you'll check your own work");
    expect(free.text).toContain("Save for later");
    expect(free.text).toContain("Reviewed and signed off by the team");

    setPlanCoversEverything(false);
    const locked = html(await render(() => Course({ params: params({ slug: PAID_SLUG }), searchParams: params({}) })));
    expect(locked.text).toContain("needs a parent to unlock it");
    expect(locked.text).toContain("Ask a parent to unlock");
    expect(locked.text).not.toContain("Start this project");
    expect(locked.text).not.toMatch(PRICE);
    // Nothing from inside a step, a hint or a quiz reaches the page.
    const full = await publishedContent(PAID_SLUG);
    for (const hint of full.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.steps.flatMap((step) => step.hints)))) expect(locked.html).not.toContain(hint.slice(0, 30));
    for (const option of full.quizzes.flatMap((quiz) => quiz.questions.flatMap((question) => question.options))) expect(locked.html).not.toContain(option.text.slice(0, 30));

    expect(await render(() => Course({ params: params({ slug: "no-such-course" }), searchParams: params({}) }))).toEqual({ kind: "not_found" });
  });

  it("course page: renders each blocker with its message and its ask-a-parent action", async () => {
    const { Course } = await pages();
    const child = await learner();
    current = child.ctx;
    setStartBlockers([
      { code: "tool_approval_required", message: "ChatGPT needs a parent's OK before you start.", toolSlug: "chatgpt", toolName: "ChatGPT", policy: "parent_consent_required", status: "none", ask: "tool_approval" },
      { code: "pro_approval_required", message: "Your parent has asked to OK Pro projects first.", ask: "unlock_pro_course" },
      { code: "tool_on_hold", message: "We're re-checking Canva's rules for your age group.", toolSlug: "canva", toolName: "Canva" },
    ]);
    const page = html(await render(() => Course({ params: params({ slug: FREE_SLUG }), searchParams: params({}) })));
    expect(page.text).toContain("ChatGPT needs a parent's OK before you start.");
    expect(page.text).toContain("Ask a parent about ChatGPT");
    expect(page.text).toContain("Pro projects need a parent's OK first");
    expect(page.text).toContain("We're re-checking Canva's rules for your age group.");
    expect(page.text).not.toContain("Start this project");
    expect(page.html).toContain('name="toolSlug" value="chatgpt"');

    setStartBlockers([{ code: "tool_approval_required", message: "Waiting for your parent.", toolSlug: "chatgpt", toolName: "ChatGPT", policy: "parent_operated", status: "pending", ask: "tool_approval" }]);
    const waiting = html(await render(() => Course({ params: params({ slug: FREE_SLUG }), searchParams: params({ asked: "sent" }) })));
    expect(waiting.text).toContain("A parent needs to set up ChatGPT");
    expect(waiting.text).toContain("Request sent");
    expect(waiting.html).not.toContain('name="toolSlug"');
  });
});

describe("player pages", () => {
  it("resumes at the right step, and renders a step with no answers, feedback or Coach guidance in the HTML", async () => {
    const { Resume, Player } = await pages();
    const child = await learner();
    current = child.ctx;
    const id = child.actor.userId;
    expect(await render(() => Resume({ params: params({ courseSlug: FREE_SLUG }) }))).toEqual({ kind: "redirect", to: `/explore/${FREE_SLUG}` });

    const { enrolment } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    await saveStep(child.ctx, { enrolmentId: enrolment.id, stepKey: "s12", intent: "open" });
    expect(await render(() => Resume({ params: params({ courseSlug: FREE_SLUG }) }))).toEqual({ kind: "redirect", to: `/learn/${FREE_SLUG}/s12` });

    const quiz = html(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s12" }) })));
    expect(h1Count(quiz.html)).toBe(1);
    expect(mainCount(quiz.html)).toBe(1);
    expect(quiz.text).toContain("Check my answers");
    expect(quiz.text).toContain("Back to course");
    expect(quiz.text).toContain("I'm stuck");
    const full = await publishedContent(FREE_SLUG);
    for (const option of full.quizzes.flatMap((entry) => entry.questions.flatMap((question) => question.options))) {
      if (option.feedback.length > 0) expect(quiz.html).not.toContain(option.feedback.slice(0, 40));
    }
    for (const step of full.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.steps))) {
      if (step.coachContext) expect(quiz.html).not.toContain(step.coachContext.slice(0, 40));
    }
    expect(quiz.html).not.toMatch(/"correct"|coachContext|referenceSolution/);

    for (const stepKey of ["s1", "s2", "s3", "s4", "s5", "s17", "s24", "s26"]) {
      const step = html(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey }) })));
      expect([stepKey, h1Count(step.html), mainCount(step.html)]).toEqual([stepKey, 1, 1]);
    }
    const guide = html(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s2" }) })));
    expect(guide.text).toContain("Keep your sign-in details to yourself");
    expect(guide.text).toContain("Guide last checked");
    const task = html(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s3" }) })));
    expect(task.text).toContain("What to do in ChatGPT");
    expect(task.text).toContain("Open ChatGPT");

    expect(await render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "nope" }) }))).toEqual({ kind: "not_found" });
    expect(await render(() => Player({ params: params({ courseSlug: OTHER_FREE_SLUG, stepKey: "s1" }) }))).toEqual({ kind: "redirect", to: `/explore/${OTHER_FREE_SLUG}` });
  });

  it("shows the friendly stop screen at the cap, and sends other blocks to the course page", async () => {
    const { Player } = await pages();
    const child = await learner();
    current = child.ctx;
    await startCourse(child.ctx, { learnerId: child.actor.userId, courseSlug: FREE_SLUG });
    const open = () => render(() => Player({ params: params({ courseSlug: FREE_SLUG, stepKey: "s3" }) }));

    setControls({ dailyMinutesCap: 0 });
    const capped = html(await open());
    expect(capped.text).toContain("That's your time for today");
    expect(capped.text).toContain("Everything is saved");
    expect(capped.text).not.toContain("What to do in ChatGPT");
    expect(mainCount(capped.html)).toBe(1);

    setControls({ quietStartMin: 14 * 60, quietEndMin: 16 * 60 });
    expect(html(await open()).text).toContain("It's quiet hours");

    setControls({});
    setStartBlockers([{ code: "tool_approval_required", message: "Approval was withdrawn.", toolSlug: "chatgpt", toolName: "ChatGPT", policy: "parent_consent_required", status: "revoked", ask: "tool_approval" }]);
    expect(await open()).toEqual({ kind: "redirect", to: `/explore/${FREE_SLUG}` });
  });

  it("a taken-down course shows a notice and nothing else", async () => {
    const { Player, Course } = await pages();
    const child = await learner();
    current = child.ctx;
    const slug = "shoot-a-promo-advert-in-an-afternoon";
    await startCourse(child.ctx, { learnerId: child.actor.userId, courseSlug: slug });
    await takeDownCourse(ctxFor(await staff("moderator")), (await courseBySlug(slug)).id, "Tool terms changed");

    const player = html(await render(() => Player({ params: params({ courseSlug: slug, stepKey: "s3" }) })));
    expect(player.text).toContain("This project has been taken down for now");
    expect(player.text).not.toMatch(/What to do in|Show a hint|I'm stuck|My notes/);
    expect(h1Count(player.html)).toBe(1);
    const course = html(await render(() => Course({ params: params({ slug }), searchParams: params({}) })));
    expect(course.text).toContain("This project has been taken down for now");
    expect(course.text).not.toMatch(/What's inside|Start this project|Continue/);
  });

  it("a learner too young for a course gets the ordinary not-found page from every address", async () => {
    const { Player, Course, Resume } = await pages();
    await publishNewVersion("make-your-own-ai-music-video", (content) => {
      content.minAge = 16;
    });
    const child = await learner({ age: 13 });
    current = child.ctx;
    const slug = "make-your-own-ai-music-video";
    expect(await render(() => Course({ params: params({ slug }), searchParams: params({}) }))).toEqual({ kind: "not_found" });
    expect(await render(() => Resume({ params: params({ courseSlug: slug }) }))).toEqual({ kind: "not_found" });
    expect(await render(() => Player({ params: params({ courseSlug: slug, stepKey: "s1" }) }))).toEqual({ kind: "not_found" });
  });
});

describe("settings", () => {
  it("shows the profile, accessibility, what a parent can see and notices, even while paused", async () => {
    const { Settings } = await pages();
    const child = await learner();
    current = child.ctx;
    setControls({ dailyMinutesCap: 45, quietStartMin: 21 * 60, quietEndMin: 7 * 60 });
    const page = html(await render(() => Settings()));
    expect(h1Count(page.html)).toBe(1);
    for (const heading of ["Profile", "Accessibility", "What my parent can see", "Notices"]) expect(page.text).toContain(heading);
    expect(page.text).toContain("Learning time: up to 45 min a day.");
    expect(page.text).toContain("Quiet hours: 21:00 to 07:00.");
    expect(page.text).toContain("What you write in a reflection or an ethics checkpoint.");
    expect(page.text).toContain("Text size");

    current = testCtx({ ...child.actor, status: "paused" }, { now: AFTERNOON });
    const paused = html(await render(() => Settings()));
    expect(paused.text).toContain("Accessibility");
    expect(paused.text).toContain("once your account is switched back on");
  });
});

describe("public course pages", () => {
  it("lists courses and shows a course outline to anyone, with no prices", async () => {
    const { PublicList, PublicCourse, Taster } = await pages();
    const list = html(await render(() => PublicList({ searchParams: params({}) })));
    expect(h1Count(list.html)).toBe(1);
    expect(mainCount(list.html)).toBe(0);
    expect(list.html).toContain(`href="/courses/${FREE_SLUG}"`);
    expect(list.text).not.toMatch(/£|\bpence\b/);

    const course = html(await render(() => PublicCourse({ params: params({ slug: PAID_SLUG }) })));
    expect(h1Count(course.html)).toBe(1);
    expect(course.text).toContain("Get started");
    expect(course.text).toContain("Family plan");
    expect(course.text).not.toMatch(/£|\bpence\b/);
    expect(course.text).not.toContain("Start this project");
    expect(await render(() => PublicCourse({ params: params({ slug: "no-such-course" }) }))).toEqual({ kind: "not_found" });

    const taster = html(await render(() => Taster({ params: params({ slug: FREE_SLUG }) })));
    expect(h1Count(taster.html)).toBe(1);
    expect(taster.text).toContain("Nothing you do here is saved");
    // Only the opening video: the setup guide and everything after it stay behind sign-up.
    expect(taster.text).not.toMatch(/Create your account|I've done this|Check my answers/);
  });

  it("sends a signed-in learner to their own catalogue instead", async () => {
    const { PublicList, PublicCourse, Taster } = await pages();
    const child = await learner({ age: 13 });
    current = child.ctx;
    expect(await render(() => PublicList({ searchParams: params({ q: "bot" }) }))).toEqual({ kind: "redirect", to: "/explore?q=bot" });
    expect(await render(() => PublicCourse({ params: params({ slug: PAID_SLUG }) }))).toEqual({ kind: "redirect", to: `/explore/${PAID_SLUG}` });
    expect(await render(() => Taster({ params: params({ slug: PAID_SLUG }) }))).toEqual({ kind: "redirect", to: `/explore/${PAID_SLUG}` });
  });
});
