/**
 * One place that decides what course content may be rendered for a learner.
 *
 * The page and the player accept either a full `Course` (a staff preview hands over the draft) or
 * a `LearnerCourse` (the live player has already stripped it). `toLearnerCourse` must run exactly
 * once: running it twice would shuffle an `order` question a second time, which can land back on
 * the authored (correct) order. So: if anything marks the content as unstripped, strip it;
 * otherwise leave it alone.
 */
import { INTERNAL_COURSE_FIELDS, SOLUTION_CONFIG_KEYS, toLearnerCourse, type Course, type LearnerCourse, type LearnerStep } from "@/content/schema";

type AnyCourse = Course | LearnerCourse;

/** True when the content still carries anything a learner must not receive. */
export function hasInternalContent(course: AnyCourse): boolean {
  const record = course as unknown as Record<string, unknown>;
  if (INTERNAL_COURSE_FIELDS.some((field) => field in record)) return true;
  for (const quiz of course.quizzes) {
    for (const question of quiz.questions) {
      for (const option of question.options as ReadonlyArray<Record<string, unknown>>) {
        if ("correct" in option || "feedback" in option) return true;
      }
    }
  }
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      for (const step of lesson.steps as ReadonlyArray<Record<string, unknown>>) {
        if ("coachContext" in step) return true;
        const config = step.config;
        if (typeof config === "object" && config !== null && SOLUTION_CONFIG_KEYS.some((key) => key in config)) return true;
      }
    }
  }
  return false;
}

export function ensureLearnerCourse(course: AnyCourse): LearnerCourse {
  return hasInternalContent(course) ? toLearnerCourse(course as Course) : (course as LearnerCourse);
}

export type FlatLearnerStep = { step: LearnerStep; moduleId: string; lessonId: string; lessonTitle: string; index: number };

/** Every step in course order, with where it sits. */
export function flattenLearnerSteps(course: LearnerCourse): FlatLearnerStep[] {
  const flat: FlatLearnerStep[] = [];
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      for (const step of lesson.steps) flat.push({ step, moduleId: mod.id, lessonId: lesson.id, lessonTitle: lesson.title, index: flat.length });
    }
  }
  return flat;
}
