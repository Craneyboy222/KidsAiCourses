/**
 * Turns one step of a `Course` snapshot into what Coach is allowed to know about it (spec
 * Section 8, "Context available to Coach"). Pure: no database, no clock.
 *
 * The result is for the server only. It holds `coachContext` and the reference solution, neither
 * of which may ever reach a learner's browser.
 */
import { findStep } from "@/content/course-utils";
import type { Course } from "@/content/schema";
import type { StepContext } from "./types";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value : null);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export function stepContextFromCourse(
  content: Course,
  stepKey: string,
  ids: { courseId: string | null; courseVersionId: string; enrolmentId: string | null; stepId: string | null },
): StepContext | null {
  const found = findStep(content, stepKey);
  if (!found) return null;
  const { step, module: mod, lesson } = found;
  const config = step.config ?? {};

  // What the learner has been asked to do, in whichever field this step type keeps it.
  const clicks = list(config.clicks);
  const task =
    text(config.task) ?? text(config.prompt) ?? text(config.hint) ?? text(config.evidenceHint);
  const taskWithClicks = task && clicks.length > 0 ? `${task}\nClick path: ${clicks.join(" → ")}` : task;

  let guide: StepContext["guide"] = null;
  const guideId = text(config.guideId);
  if (guideId) {
    const match = content.setupGuides.find((candidate) => candidate.id === guideId);
    if (match) {
      const through = new Set(list(config.throughStepIds));
      const steps = match.steps.filter((guideStep) => through.size === 0 || through.has(guideStep.id));
      guide = { title: match.title, steps: steps.map((guideStep) => ({ title: guideStep.title, body: guideStep.body })) };
    }
  }

  return {
    courseId: ids.courseId,
    courseVersionId: ids.courseVersionId,
    courseSlug: content.slug,
    courseTitle: content.title,
    moduleTitle: mod.title,
    lessonTitle: lesson.title,
    enrolmentId: ids.enrolmentId,
    stepId: ids.stepId,
    step: {
      key: step.id,
      type: step.type,
      title: step.title,
      body: text(step.body),
      task: taskWithClicks,
      coachContext: text(step.coachContext),
      hints: step.hints,
      referenceSolution: text(config.referenceSolution),
      toolSlug: text(config.toolSlug),
    },
    guide,
    rubric: content.rubric.criteria.map((criterion) => ({ name: criterion.name, description: criterion.description })),
  };
}
