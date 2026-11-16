/**
 * The step renderers, for every launch step type, in jsdom. Rendered inside a preview-mode
 * `PlayerProvider` (progress in the tab, no server), which is also how Studio mounts them.
 *
 * Mocked: `ReportControl`, `UploadStep` and `SubmitStep` (their contract bodies, owned by the
 * tools and submissions slice, still render nothing) and `CoachPanel` (tested by the Coach slice).
 * The stand-ins show what props they were mounted with.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerFrame } from "@/components/course/player/PlayerFrame";
import { previewStorageKey, type QuizOutcome, type StepMeta } from "@/components/course/player/session";
import { StepBody, type StepBodyProps, type StepMedia, type StepToolFacts } from "@/components/course/player/steps";
import { PlayerProvider } from "@/components/course/player/store";
import type { PlayerMode } from "@/components/course/types";
import { courseSchema, safeParseStepConfig, toLearnerCourse, type Course, type LearnerCourse } from "@/content/schema";
import { gradeQuiz } from "@/lib/learning/quiz-grading";
import { flattenLearnerSteps } from "@/lib/learning/safe-course";
import { readJson, snapchatCourse } from "../content/helpers";
import { axeViolations } from "../ui/axe-helper";

vi.mock("@/components/safety/ReportControl", () => ({
  ReportControl: ({ target, label }: { target: { type: string; id: string; toolSlug?: string }; label?: string }) => (
    <button type="button" data-testid="report-control" data-target-type={target.type} data-target-id={target.id} data-tool={target.toolSlug}>
      {label ?? "Report"}
    </button>
  ),
}));
vi.mock("@/components/submissions/EvidenceSteps", () => {
  const stub = (name: string) =>
    function Stub(props: { stepKey: string; stepId: string | null; mode: { kind: string }; config: { evidence?: string[] } }) {
      return <div data-testid={name} data-step-key={props.stepKey} data-step-id={String(props.stepId)} data-mode={props.mode.kind} data-evidence={(props.config.evidence ?? []).join(",")} />;
    };
  return { UploadStep: stub("upload-step"), SubmitStep: stub("submit-step") };
});
vi.mock("@/components/coach/CoachPanel", () => ({
  CoachPanel: ({ open, hints }: { open: boolean; hints: string[] }) => (open ? <div role="dialog" aria-label="Coach" data-hints={hints.length} /> : null),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const VERSION = "11111111-1111-4111-8111-111111111111";
const PREVIEW: PlayerMode = { kind: "preview", versionId: VERSION, asBand: "teen_13_15", canEdit: false };

const snaplabFull: Course = snapchatCourse();
const snaplab: LearnerCourse = toLearnerCourse(snaplabFull);
const helperFull: Course = courseSchema.parse(readJson("content/courses/homework-helper-chatbot-the-honest-kind.json"));
const helper: LearnerCourse = toLearnerCourse(helperFull);

const REPLIT: StepToolFacts = { slug: "replit", name: "Replit", officialUrl: "https://replit.com/", linkAllowed: true, parentMustSetUp: false };

function asset(id: string, kind: string, url: string | null, extra: Partial<StepMedia[string]> = {}): StepMedia[string] {
  return { id, kind, url, altText: null, durationSec: null, attribution: null, text: null, ...extra };
}

type Options = { course?: LearnerCourse; full?: Course; media?: StepMedia; tools?: Record<string, StepToolFacts>; disabled?: boolean; frame?: boolean; grade?: (versionId: string, stepKey: string, answers: Record<string, string[]>) => Promise<QuizOutcome> };

function renderStep(stepKey: string, options: Options = {}) {
  const course = options.course ?? snaplab;
  const flat = flattenLearnerSteps(course);
  const here = flat.find((entry) => entry.step.id === stepKey);
  if (!here) throw new Error(`no step ${stepKey}`);
  const { step } = here;
  const parsed = safeParseStepConfig(step);
  const config = parsed.success ? parsed.data : null;
  const guideStepIds = config?.type === "setup_guide" ? config.config.throughStepIds : [];
  const meta: StepMeta = { key: step.id, type: step.type, rule: step.completion.rule, threshold: step.completion.threshold ?? null, hintCount: step.hints.length, guideStepIds, disabled: options.disabled ?? false, videoPlayable: true };
  const order = flat.map((entry) => ({ key: entry.step.id, disabled: false }));
  const props: StepBodyProps = {
    mode: PREVIEW,
    courseId: "course-1",
    courseSlug: course.slug,
    moduleId: here.moduleId,
    lessonId: here.lessonId,
    step,
    stepId: null,
    disabled: options.disabled ?? false,
    quiz: config?.type === "quiz" ? (course.quizzes.find((quiz) => quiz.id === config.config.quizId) ?? null) : null,
    guide: config?.type === "setup_guide" ? (course.setupGuides.find((guide) => guide.id === config.config.guideId) ?? null) : null,
    media: options.media ?? {},
    tools: options.tools ?? { replit: REPLIT },
    brief: course.projectBrief,
    rubric: course.rubric,
    order,
  };
  const body: ReactNode = <StepBody {...props} />;
  const index = here.index;
  return render(
    <PlayerProvider mode={PREVIEW} step={meta} order={order} initial={null} gradePreview={options.grade}>
      {options.frame ? (
        <PlayerFrame
          courseSlug={course.slug}
          courseTitle={course.title}
          lessonTitle={here.lessonTitle}
          exitHref="/explore/x"
          stepTitle={step.title}
          hints={step.hints}
          lessonSteps={flat.filter((entry) => entry.lessonId === here.lessonId).map((entry) => ({ key: entry.step.id, title: entry.step.title, href: `/p/${entry.step.id}`, disabled: false }))}
          prevHref={flat[index - 1] ? `/p/${flat[index - 1]?.step.id}` : null}
          nextHref={flat[index + 1] ? `/p/${flat[index + 1]?.step.id}` : null}
        >
          {body}
        </PlayerFrame>
      ) : (
        <main>{body}</main>
      )}
    </PlayerProvider>,
  );
}

const stored = () => JSON.parse(window.sessionStorage.getItem(previewStorageKey(VERSION)) ?? "{}") as Record<string, { status: string; data: Record<string, unknown>; notes: string; response: string }>;

/** Marks with the real grader against the full course, as the server does. */
const serverGrade = (full: Course) => async (_versionId: string, stepKey: string, answers: Record<string, string[]>): Promise<QuizOutcome> => {
  const quizId = String(full.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.steps)).find((step) => step.id === stepKey)?.config?.quizId);
  const quiz = full.quizzes.find((entry) => entry.id === quizId);
  if (!quiz) return { error: "no quiz" };
  return { ...gradeQuiz(quiz, answers), attemptNumber: 0 };
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  push.mockReset();
});

describe("video step", () => {
  it("plays with captions on, never autoplays, and offers the transcript", async () => {
    const media: StepMedia = {
      "vid-snaplab-trailer": asset("vid-snaplab-trailer", "video", "/api/files/v.mp4?sig=1"),
      "vtt-snaplab-trailer": asset("vtt-snaplab-trailer", "captions_vtt", "/api/files/v.vtt?sig=1"),
      "tx-snaplab-trailer": asset("tx-snaplab-trailer", "transcript_md", null, { text: "In this video we build **SnapLab**." }),
    };
    const { container } = renderStep("s1", { media });
    expect(screen.getByRole("heading", { level: 1, name: "The finished app in 90 seconds" })).toBeInTheDocument();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video?.getAttribute("preload")).toBe("metadata");
    const track = container.querySelector("track");
    expect(track).toHaveAttribute("kind", "captions");
    expect(track).toHaveAttribute("default");
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Low-data mode/ })).not.toBeChecked();

    // Reading the transcript counts the same as watching.
    await userEvent.click(screen.getByText("Read the transcript"));
    expect(screen.getByText("SnapLab")).toBeInTheDocument();
    await waitFor(() => expect(stored().s1?.data.transcriptRead).toBe(true));
    expect(await axeViolations()).toEqual([]);
  });

  it("loads nothing in low-data mode until asked", async () => {
    const media: StepMedia = { v: asset("vid-snaplab-trailer", "video", "/v.mp4"), c: asset("vtt-snaplab-trailer", "captions_vtt", "/v.vtt") };
    const { container } = renderStep("s1", { media: { "vid-snaplab-trailer": media.v as StepMedia[string], "vtt-snaplab-trailer": media.c as StepMedia[string] } });
    await userEvent.click(screen.getByRole("switch", { name: /Low-data mode/ }));
    expect(container.querySelector("video")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Load the video anyway" }));
    expect(container.querySelector("video")?.getAttribute("preload")).toBe("none");
  });

  it("never shows a video without captions, and does not hold the learner up when there is nothing to play", () => {
    const { container } = renderStep("s1", { media: { "vid-snaplab-trailer": asset("vid-snaplab-trailer", "video", "/v.mp4") } });
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("This video isn't ready to play yet")).toBeInTheDocument();
    expect(screen.getByText(/this one won't hold you up/)).toBeInTheDocument();
  });
});

describe("read and checkpoint steps", () => {
  it("renders the reading as Markdown, with its picture and alt text", () => {
    const media: StepMedia = { "img-snaplab-sample": asset("img-snaplab-sample", "image", "/sample.png", { altText: "The SnapLab sample image: an illustrated face, not a real person." }) };
    renderStep("s16", { media });
    expect(screen.getByRole("img", { name: /The SnapLab sample image/ })).toHaveAttribute("src", "/sample.png");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("describes a picture that has not been uploaded instead of showing a broken image", () => {
    const media: StepMedia = { "img-snaplab-sample": asset("img-snaplab-sample", "image", null, { altText: "The SnapLab sample image." }) };
    renderStep("s16", { media });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("The SnapLab sample image.")).toBeInTheDocument();
  });

  it("shows a checkpoint with how far through the course the learner is", async () => {
    renderStep("s13");
    expect(screen.getByText("Saved so far")).toBeInTheDocument();
    expect(await screen.findByText(/1 of 16 steps done\./)).toBeInTheDocument();
  });
});

describe("setup guide step", () => {
  it("lists the guide's steps in order with tick-off, and a guide-mismatch report", async () => {
    const { container } = renderStep("s2");
    const guide = snaplab.setupGuides[0];
    if (!guide) throw new Error("fixture");
    const titles = within(container).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual(guide.steps.slice(0, 4).map((step) => step.title));
    expect(screen.getByText(/Guide last checked/)).toBeInTheDocument();
    expect(screen.getByText("Keep your sign-in details to yourself")).toBeInTheDocument();

    const report = screen.getByRole("button", { name: "This doesn't match what I see" });
    expect(report).toHaveAttribute("data-target-type", "guide");
    expect(report).toHaveAttribute("data-target-id", guide.id);
    expect(report).toHaveAttribute("data-tool", "replit");

    const ticks = screen.getAllByRole("checkbox", { name: "I've done this" });
    expect(ticks).toHaveLength(4);
    await userEvent.click(ticks[0] as HTMLElement);
    await userEvent.click(ticks[2] as HTMLElement);
    await waitFor(() => expect(stored().s2?.data.guideTicks).toEqual(["g1", "g3"]));
    await userEvent.click(screen.getByRole("checkbox", { name: "My Replit account is set up" }));
    await waitFor(() => expect(stored().s2?.data.ticked).toBe(true));
    expect(await axeViolations()).toEqual([]);
  });

  it("tells the teen to ask a parent when the tool is parent-operated, never to create their own account", () => {
    renderStep("s2", { tools: { replit: { ...REPLIT, parentMustSetUp: true } } });
    expect(screen.getByText("Ask a parent to set this up")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: "We've done this together" })).toHaveLength(4);
    expect(screen.getByRole("checkbox", { name: "Replit is set up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Replit/ })).toBeNull();
  });
});

describe("external task step", () => {
  it("shows the instructions and opens the tool through the leaving-site notice", async () => {
    renderStep("s3");
    expect(screen.getByRole("heading", { level: 2, name: "What to do in Replit" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(screen.getByText(/This page stays here/)).toBeInTheDocument();

    // No bare link to the tool: the button opens the notice first.
    expect(screen.queryByRole("link", { name: /Replit/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open Replit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/You're leaving/)).toBeInTheDocument();
    const out = within(dialog).getByRole("link");
    expect(out).toHaveAttribute("href", "https://replit.com/");
    expect(out).toHaveAttribute("target", "_blank");
    expect(out.getAttribute("rel")).toContain("noopener");
  });

  it("renders no link at all when the Register does not allow the tool", () => {
    renderStep("s3", { tools: { replit: { ...REPLIT, linkAllowed: false, officialUrl: null } } });
    expect(screen.queryByRole("button", { name: /Open Replit/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/can't be opened from here/)).toBeInTheDocument();
  });

  it("is confirmed with 'I've done this', and Next will not pass it until then", async () => {
    renderStep("s3", { frame: true });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Tick the box to say you've done this.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: "I've done this" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/p/s4"));
    expect(stored().s3?.status).toBe("completed");
  });

  it("can be skipped, and is marked as skipped", async () => {
    renderStep("s3", { frame: true });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Skip this step for now" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/p/s4"));
    expect(stored().s3?.status).toBe("skipped");
  });
});

describe("quiz step", () => {
  const feedbackTexts = helperFull.quizzes.flatMap((quiz) => quiz.questions.flatMap((question) => question.options.map((option) => option.feedback)));

  it("renders every question kind with no answers or feedback in the page before an attempt", async () => {
    const { container } = renderStep("s12", { course: helper, tools: {} });
    // single → radios, multi → checkboxes, order → move buttons (no dragging).
    expect(screen.getAllByRole("radio").length).toBe(3);
    expect(screen.getAllByRole("checkbox").length).toBe(4);
    expect(screen.getAllByRole("button", { name: /^Move “.*” up$/ })).toHaveLength(4);
    expect(screen.getByText(/No timer, and you can try as many times as you like/)).toBeInTheDocument();
    for (const text of feedbackTexts) expect(container.textContent).not.toContain(text);
    expect(container.innerHTML).not.toMatch(/correct/i);
    expect(await axeViolations()).toEqual([]);
  });

  it("is marked by the server, shows feedback for what was chosen, and allows another try", async () => {
    const grade = vi.fn(serverGrade(helperFull));
    renderStep("s12", { course: helper, tools: {}, grade });
    const quiz = helperFull.quizzes[0];
    const first = quiz?.questions[0];
    const wrong = first?.options.find((option) => !option.correct);
    const right = first?.options.find((option) => option.correct);
    if (!quiz || !first || !wrong || !right) throw new Error("fixture");

    await userEvent.click(screen.getByRole("radio", { name: wrong.text }));
    await userEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    expect(await screen.findByText(wrong.feedback)).toBeInTheDocument();
    expect(screen.queryByText(right.feedback)).toBeNull();
    expect(screen.getByText("0 of 3 right. You need 66% to pass")).toBeInTheDocument();
    // The ordering question was sent in the order shown, without the learner touching it.
    const sent = grade.mock.calls[0]?.[2] ?? {};
    expect(sent[quiz.questions[2]?.id ?? ""]).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByText(wrong.feedback)).toBeNull();
    expect(screen.getByRole("button", { name: "Check my answers" })).toBeInTheDocument();
  });

  it("lets an ordering question be answered with the keyboard buttons, and completes on a pass", async () => {
    const grade = serverGrade(helperFull);
    renderStep("s12", { course: helper, tools: {}, grade });
    const quiz = helperFull.quizzes[0];
    if (!quiz) throw new Error("fixture");
    const [single, multi, order] = quiz.questions;
    if (!single || !multi || !order) throw new Error("fixture");

    await userEvent.click(screen.getByRole("radio", { name: single.options.find((option) => option.correct)?.text ?? "" }));
    for (const option of multi.options.filter((entry) => entry.correct)) await userEvent.click(screen.getByRole("checkbox", { name: option.text }));
    // Bubble each item up into place: the authored order is the right one.
    for (const [target, option] of order.options.entries()) {
      for (let guard = 0; guard < 6; guard += 1) {
        const items = screen.getAllByRole("button", { name: /^Move “.*” up$/ }).map((button) => button.getAttribute("aria-label") ?? "");
        const at = items.indexOf(`Move “${option.text}” up`);
        if (at <= target) break;
        await userEvent.click(screen.getByRole("button", { name: `Move “${option.text}” up` }));
      }
    }
    await userEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    expect(await screen.findByText("Passed: 3 of 3 right")).toBeInTheDocument();
    await waitFor(() => expect(stored().s12?.status).toBe("completed"));
  });

  it("says so when the quiz cannot be marked, and keeps the answers", async () => {
    renderStep("s12", { course: helper, tools: {}, grade: async () => ({ error: "We couldn't reach the server." }) });
    await userEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server.");
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
  });
});

describe("ethics checkpoint and reflection steps", () => {
  it.each([
    ["s8", "I've thought this through"],
    ["s11", "I'm happy with my answer"],
  ])("step %s: private free text, saved as typed, needing words and a tick", async (stepKey, tickLabel) => {
    renderStep(stepKey, { frame: true });
    expect(screen.getByText(/This is private\. Your parent or carer and other learners can't read it/)).toBeInTheDocument();
    const box = screen.getAllByRole("textbox")[0] as HTMLElement;

    await userEvent.click(screen.getByRole("checkbox", { name: tickLabel }));
    await userEvent.click(screen.getByRole("button", { name: /Next|Finish/ }));
    expect(await screen.findByText("Write a sentence or two first. It's only for you.")).toBeInTheDocument();

    await userEvent.type(box, "Filters can change how people see themselves.");
    await waitFor(() => expect(stored()[stepKey]?.response).toBe("Filters can change how people see themselves."));
    await userEvent.click(screen.getByRole("button", { name: /Next|Finish/ }));
    await waitFor(() => expect(stored()[stepKey]?.status).toBe("completed"));
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("upload and submit steps", () => {
  it("mounts the submissions slice's submit step with the step, mode and config", () => {
    renderStep("s12");
    const stub = screen.getByTestId("submit-step");
    expect(stub).toHaveAttribute("data-step-key", "s12");
    expect(stub).toHaveAttribute("data-step-id", "null");
    expect(stub).toHaveAttribute("data-mode", "preview");
    expect(stub.getAttribute("data-evidence")).toContain("link");
  });

  it("mounts the upload step for an upload step", () => {
    const course = structuredClone(snaplab);
    const target = course.modules[1]?.lessons[1]?.steps[0];
    if (!target) throw new Error("fixture");
    Object.assign(target, { type: "upload", config: { evidence: ["screenshot"], hint: "A screenshot of the sample image with your filter on." }, completion: { rule: "upload_approved" } });
    renderStep(target.id, { course });
    expect(screen.getByTestId("upload-step")).toHaveAttribute("data-evidence", "screenshot");
  });

  it("cannot skip the final step", async () => {
    renderStep("s12", { frame: true });
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip this step for now" })).toBeNull();
  });
});

describe("hints, notes and a disabled step", () => {
  it("reveals hints one at a time, then offers Coach", async () => {
    renderStep("s3", { frame: true });
    const hints = snaplab.modules[1]?.lessons[0]?.steps[0]?.hints ?? [];
    expect(hints).toHaveLength(3);
    for (const hint of hints) expect(screen.queryByText(hint)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show a hint" }));
    expect(screen.getByText(hints[0] ?? "")).toBeInTheDocument();
    expect(screen.queryByText(hints[1] ?? "")).toBeNull();
    expect(screen.queryByRole("button", { name: "Still stuck? Ask Coach" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show another hint" }));
    await userEvent.click(screen.getByRole("button", { name: "Show another hint" }));
    expect(screen.getByText(hints[2] ?? "")).toBeInTheDocument();
    await waitFor(() => expect(stored().s3?.data.hintLevel).toBe(3));

    expect(screen.queryByRole("dialog", { name: "Coach" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Still stuck? Ask Coach" }));
    expect(screen.getByRole("dialog", { name: "Coach" })).toHaveAttribute("data-hints", "3");
  });

  it("keeps private notes on a step", async () => {
    renderStep("s16");
    await userEvent.click(screen.getByText("My notes"));
    await userEvent.type(screen.getByRole("textbox", { name: /Notes for this step/ }), "Try sepia");
    await waitFor(() => expect(stored().s16?.notes).toBe("Try sepia"));
    expect(screen.getByText(/your parent or carer and other learners can't see these/)).toBeInTheDocument();
  });

  it("shows a short notice for a switched-off step, nothing of the step itself, and lets Next pass", async () => {
    renderStep("s3", { disabled: true, frame: true });
    expect(screen.getByText("This step is switched off for now")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /What to do in/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show a hint" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(push).toHaveBeenCalledWith("/p/s4");
  });

  it("marks a preview clearly, with a Report control and a way to ask for help in the frame", () => {
    renderStep("s3", { frame: true });
    expect(screen.getByText("Staff preview")).toBeInTheDocument();
    expect(screen.getByText("Preview: nothing here is saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I'm stuck" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/p/s13");
  });
});
