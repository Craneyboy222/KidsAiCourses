import { notFound } from "next/navigation";
import { isPreview, type PlayerMode } from "@/components/course/types";
import { ReportControl } from "@/components/safety/ReportControl";
import { safeParseStepConfig, type Course, type LearnerCourse } from "@/content/schema";
import type { StepState } from "@/lib/learning/completion";
import { ensureLearnerCourse, flattenLearnerSteps } from "@/lib/learning/safe-course";
import type { StepData } from "@/lib/learning/step-data";
import { db } from "@/server/db";
import { isVideoPlayable, resolveCourseMedia, stepToolsFor } from "@/server/services/course-page";
import { gradePreviewQuizAction } from "./actions";
import { PlayerFrame } from "./PlayerFrame";
import { StepBody } from "./steps";
import { PlayerProvider, type StepMeta } from "./store";

/** What the live player knows about this learner's progress, from `loadPlayer` in `@/server/services/progress`. */
export type PlayerLiveState = {
  /** Every step of the pinned version: the materialised id, where the learner is, and whether staff have switched it off. */
  steps: { key: string; id: string; status: StepState; disabled: boolean }[];
  /** The step being shown. */
  current: { data: StepData; notes: string; response: string; quiz: { attempts: number; passed: boolean; bestScore: number | null } | null };
};

export type PlayerViewProps = {
  /**
   * The course to play: the version a learner is pinned to, or the draft a member of staff is
   * previewing. A full `Course` is fine: it is passed through `toLearnerCourse` here before
   * anything is rendered, so answers, option feedback, `coachContext` and editor notes never
   * reach the page.
   */
  content: Course | LearnerCourse;
  /** `course.id`. */
  courseId: string;
  /** `live` reads and writes real progress. `preview` keeps progress in the browser tab and writes nothing. */
  mode: PlayerMode;
  /** The step to show: its id in the course JSON. An unknown key renders the not-found page. */
  stepKey: string;
  /** Where "Back to course" goes. */
  courseHref: string;
  /** Steps are linked as `${playerBasePath}/${stepKey}`, e.g. `/learn/my-course` or `/studio/preview/<versionId>/learn`. */
  playerBasePath: string;
  /** Required in `live` mode; ignored in `preview`. */
  live?: PlayerLiveState;
};

/**
 * The course player: one step in its frame, with the step list, Coach, hints, notes, autosave and
 * Previous / Next. A Server Component. The same view serves a learner and a staff preview of a
 * draft (spec 6.3); the only difference is where progress lives.
 */
export async function PlayerView({ content, courseId, mode, stepKey, courseHref, playerBasePath, live }: PlayerViewProps) {
  const course = ensureLearnerCourse(content);
  const flat = flattenLearnerSteps(course);
  const here = flat.find((entry) => entry.step.id === stepKey);
  if (!here) notFound();
  const preview = isPreview(mode);
  if (!preview && !live) throw new Error("PlayerView: `live` is required in live mode.");

  const liveByKey = new Map((preview ? [] : (live?.steps ?? [])).map((entry) => [entry.key, entry]));
  const order = flat.map((entry) => ({ key: entry.step.id, disabled: liveByKey.get(entry.step.id)?.disabled ?? false }));
  const mine = liveByKey.get(stepKey);
  const disabled = mine?.disabled ?? false;
  const { step } = here;

  const parsed = safeParseStepConfig(step);
  const config = parsed.success ? parsed.data : null;
  const guide = config?.type === "setup_guide" ? (course.setupGuides.find((entry) => entry.id === config.config.guideId) ?? null) : null;
  const quiz = config?.type === "quiz" ? (course.quizzes.find((entry) => entry.id === config.config.quizId) ?? null) : null;
  const guideStepIds = config?.type === "setup_guide" ? config.config.throughStepIds : [];
  const toolSlug = config?.type === "setup_guide" || config?.type === "external_task" ? config.config.toolSlug : null;

  const screenshotIds = guide ? guide.steps.filter((entry) => guideStepIds.includes(entry.id)).flatMap((entry) => entry.screenshotAssetIds ?? []) : [];
  const [media, tools] = await Promise.all([
    resolveCourseMedia({ db }, [...(step.assetIds ?? []), ...screenshotIds], { transcripts: step.type === "video" }),
    stepToolsFor({ db }, toolSlug ? [toolSlug] : []),
  ]);

  const meta: StepMeta = {
    key: step.id,
    type: step.type,
    rule: step.completion.rule,
    threshold: step.completion.threshold ?? null,
    hintCount: step.hints.length,
    guideStepIds,
    disabled,
    videoPlayable: step.type === "video" ? isVideoPlayable(media) : true,
  };

  const lessonSteps = flat
    .filter((entry) => entry.lessonId === here.lessonId)
    .map((entry) => ({ key: entry.step.id, title: entry.step.title, href: `${playerBasePath}/${entry.step.id}`, disabled: liveByKey.get(entry.step.id)?.disabled ?? false }));
  const previous = flat[here.index - 1];
  const next = flat[here.index + 1];
  const stepId = mine?.id ?? null;

  return (
    // Keyed by step: moving to another step is a fresh store, never the last step's state under a new title.
    <PlayerProvider
      key={`${mode.kind}:${step.id}`}
      mode={mode}
      step={meta}
      order={order}
      initial={
        preview || !live
          ? null
          : {
              statuses: Object.fromEntries(live.steps.map((entry) => [entry.key, entry.status])),
              current: { status: mine?.status ?? "not_started", data: live.current.data, notes: live.current.notes, response: live.current.response, quiz: live.current.quiz },
            }
      }
      gradePreview={preview ? gradePreviewQuizAction : undefined}
    >
      <PlayerFrame
        courseSlug={course.slug}
        courseTitle={course.title}
        lessonTitle={here.lessonTitle}
        exitHref={courseHref}
        stepTitle={step.title}
        hints={step.hints}
        lessonSteps={lessonSteps}
        prevHref={previous ? `${playerBasePath}/${previous.step.id}` : null}
        nextHref={next ? `${playerBasePath}/${next.step.id}` : null}
        report={<ReportControl target={{ type: "step", id: stepId ?? step.id, courseId, stepKey: step.id }} compact />}
      >
        <StepBody
          mode={mode}
          courseId={courseId}
          courseSlug={course.slug}
          moduleId={here.moduleId}
          lessonId={here.lessonId}
          step={step}
          stepId={stepId}
          disabled={disabled}
          quiz={quiz}
          guide={guide}
          media={media}
          tools={tools}
          brief={course.projectBrief}
          rubric={course.rubric}
          order={order}
        />
      </PlayerFrame>
    </PlayerProvider>
  );
}
