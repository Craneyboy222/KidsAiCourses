/**
 * Pure helpers over a `Course`, shared by the player, the CMS and the
 * validator. Nothing here mutates its input or touches the network, the
 * clock or the database.
 *
 * Paths are dotted, with array positions as numbers, exactly as Zod reports
 * them: `modules.1.lessons.0.steps.2.config.task`. Validation issues use the
 * same form, so an issue's `path` can be handed straight to a `set_text`
 * patch.
 */
import {
  courseSchema,
  type Course,
  type EvidenceType,
  type Lesson,
  type Module,
  type QuizQuestion,
  type SetupGuideStep,
  type Step,
} from "./schema";

// ───────────────────────────── Reading ─────────────────────────────

export interface FlatStep {
  step: Step;
  module: Module;
  lesson: Lesson;
  moduleIndex: number;
  lessonIndex: number;
  /** Position within the lesson. */
  stepIndex: number;
  /** Position within the whole course, from 0. */
  index: number;
  /** `modules.0.lessons.0.steps.1` */
  path: string;
}

export const modulePath = (moduleIndex: number): string => `modules.${moduleIndex}`;
export const lessonPath = (moduleIndex: number, lessonIndex: number): string =>
  `${modulePath(moduleIndex)}.lessons.${lessonIndex}`;
export const stepPath = (moduleIndex: number, lessonIndex: number, stepIndex: number): string =>
  `${lessonPath(moduleIndex, lessonIndex)}.steps.${stepIndex}`;

/** Every step in course order, with its module, lesson and position. */
export function flattenSteps(course: Course): FlatStep[] {
  const flat: FlatStep[] = [];
  course.modules.forEach((mod, moduleIndex) => {
    mod.lessons.forEach((lesson, lessonIndex) => {
      lesson.steps.forEach((step, stepIndex) => {
        flat.push({
          step,
          module: mod,
          lesson,
          moduleIndex,
          lessonIndex,
          stepIndex,
          index: flat.length,
          path: stepPath(moduleIndex, lessonIndex, stepIndex),
        });
      });
    });
  });
  return flat;
}

export function findStep(course: Course, stepId: string): FlatStep | undefined {
  return flattenSteps(course).find((entry) => entry.step.id === stepId);
}

/** The step after `stepId` in course order, or `undefined` at the end (or if the id is unknown). */
export function nextStep(course: Course, stepId: string): FlatStep | undefined {
  const flat = flattenSteps(course);
  const index = flat.findIndex((entry) => entry.step.id === stepId);
  return index === -1 ? undefined : flat[index + 1];
}

/** The step before `stepId` in course order, or `undefined` at the start (or if the id is unknown). */
export function previousStep(course: Course, stepId: string): FlatStep | undefined {
  const flat = flattenSteps(course);
  const index = flat.findIndex((entry) => entry.step.id === stepId);
  return index <= 0 ? undefined : flat[index - 1];
}

export function firstStep(course: Course): FlatStep | undefined {
  return flattenSteps(course)[0];
}

export function stepCount(course: Course): number {
  return course.modules.reduce(
    (total, mod) => total + mod.lessons.reduce((sum, lesson) => sum + lesson.steps.length, 0),
    0,
  );
}

export const lessonStepMinutes = (lesson: Lesson): number =>
  lesson.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);

/** Minutes for the whole course, added up from its steps. */
export function totalMinutes(course: Course): number {
  return course.modules.reduce(
    (total, mod) => total + mod.lessons.reduce((sum, lesson) => sum + lessonStepMinutes(lesson), 0),
    0,
  );
}

/** Slugs of the tools a learner must have, in the order the course lists them, without repeats. */
export function requiredToolSlugs(course: Course): string[] {
  return [...new Set(course.toolRequirements.filter((tool) => tool.required).map((tool) => tool.toolSlug))];
}

/** The evidence types the project brief declares (spec 3.4), without repeats. */
export function evidenceTypes(course: Course): EvidenceType[] {
  return [...new Set(course.projectBrief.evidence)];
}

// ───────────────────────────── Text ─────────────────────────────

export interface CourseText {
  path: string;
  text: string;
  /**
   * - `copy`: shown to the learner as instruction or description
   * - `quiz`: quiz prompts, options and feedback
   * - `coach`: guidance for Coach, never shown to the learner
   */
  audience: "copy" | "quiz" | "coach";
}

/** Config keys that hold identifiers or staff-only material, not copy. */
const NON_COPY_CONFIG_KEYS = new Set([
  "toolSlug",
  "guideId",
  "throughStepIds",
  "quizId",
  "artefactTypes",
  "evidence",
  "referenceSolution",
]);

function collectStrings(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === "string") {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}.${index}`, out));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) collectStrings(item, `${path}.${key}`, out);
  }
}

/**
 * Every piece of written text in a course with its path: titles, bodies,
 * hints, the brief, guides, quizzes, the rubric and Coach guidance. Used by
 * the real-people rule and the spelling check, and handy for search.
 */
export function collectText(course: Course): CourseText[] {
  const out: CourseText[] = [];
  const add = (path: string, text: string | undefined, audience: CourseText["audience"] = "copy"): void => {
    if (typeof text === "string" && text.trim().length > 0) out.push({ path, text, audience });
  };
  const addList = (path: string, list: readonly string[] | undefined): void => {
    (list ?? []).forEach((text, index) => add(`${path}.${index}`, text));
  };

  add("title", course.title);
  add("tagline", course.tagline);
  add("whatYouMake", course.whatYouMake);
  add("ethicsNote", course.ethicsNote);
  add("watchOut.note", course.watchOut?.note);
  course.toolRequirements.forEach((tool, index) => add(`toolRequirements.${index}.purpose`, tool.purpose));

  course.setupGuides.forEach((guide, guideIndex) => {
    add(`setupGuides.${guideIndex}.title`, guide.title);
    guide.steps.forEach((step, stepIndex) => {
      add(`setupGuides.${guideIndex}.steps.${stepIndex}.title`, step.title);
      add(`setupGuides.${guideIndex}.steps.${stepIndex}.body`, step.body);
    });
  });

  add("projectBrief.scenario", course.projectBrief.scenario);
  addList("projectBrief.deliverables", course.projectBrief.deliverables);
  addList("projectBrief.constraints", course.projectBrief.constraints);
  addList("projectBrief.stretchGoals", course.projectBrief.stretchGoals);

  course.modules.forEach((mod, moduleIndex) => {
    add(`${modulePath(moduleIndex)}.title`, mod.title);
    add(`${modulePath(moduleIndex)}.summary`, mod.summary);
    mod.lessons.forEach((lesson, lessonIndex) => {
      add(`${lessonPath(moduleIndex, lessonIndex)}.title`, lesson.title);
      lesson.steps.forEach((step, stepIndex) => {
        const base = stepPath(moduleIndex, lessonIndex, stepIndex);
        add(`${base}.title`, step.title);
        add(`${base}.body`, step.body);
        addList(`${base}.hints`, step.hints);
        add(`${base}.coachContext`, step.coachContext, "coach");
        for (const [key, value] of Object.entries(step.config ?? {})) {
          if (NON_COPY_CONFIG_KEYS.has(key)) continue;
          const strings: Array<{ path: string; text: string }> = [];
          collectStrings(value, `${base}.config.${key}`, strings);
          for (const entry of strings) add(entry.path, entry.text);
        }
      });
    });
  });

  course.quizzes.forEach((quiz, quizIndex) => {
    add(`quizzes.${quizIndex}.title`, quiz.title, "quiz");
    quiz.questions.forEach((question, questionIndex) => {
      const base = `quizzes.${quizIndex}.questions.${questionIndex}`;
      add(`${base}.prompt`, question.prompt, "quiz");
      question.options.forEach((option, optionIndex) => {
        add(`${base}.options.${optionIndex}.text`, option.text, "quiz");
        add(`${base}.options.${optionIndex}.feedback`, option.feedback, "quiz");
      });
    });
  });

  course.rubric.criteria.forEach((criterion, criterionIndex) => {
    const base = `rubric.criteria.${criterionIndex}`;
    add(`${base}.name`, criterion.name);
    add(`${base}.description`, criterion.description);
    criterion.levels.forEach((level, levelIndex) =>
      add(`${base}.levels.${levelIndex}.descriptor`, level.descriptor),
    );
  });

  return out;
}

// ───────────────────────────── Editing ─────────────────────────────

/**
 * One inline edit. `applyPatch` turns a course and a patch into a new course.
 *
 * - `set_text`: change one piece of text by path (`modules.0.title`,
 *   `modules.1.lessons.0.steps.0.hints.2`, `quizzes.0.questions.1.options.0.feedback`).
 *   The path must point at existing text, or at an optional text field
 *   (`body`, `coachContext`, `editorNotes`) that is not set yet.
 * - `replace_step`, `replace_quiz_question`, `replace_setup_guide_step`:
 *   swap one item for an edited copy. The id must stay the same.
 * - `add_step`, `remove_step`, `move_step`: change a lesson's steps. `order`
 *   is renumbered, and the minutes of the lessons touched (and of the course)
 *   are added up again.
 * - `replace_asset_ref`: point every use of one asset at another (trailer,
 *   step assets, guide screenshots), or only the uses in one step.
 */
export type CoursePatch =
  | { op: "set_text"; path: string; value: string }
  | { op: "replace_step"; stepId: string; step: Step }
  | { op: "add_step"; lessonId: string; step: Step; index?: number }
  | { op: "remove_step"; stepId: string }
  | { op: "move_step"; stepId: string; toLessonId: string; toIndex?: number }
  | { op: "replace_quiz_question"; quizId: string; questionId: string; question: QuizQuestion }
  | { op: "replace_setup_guide_step"; guideId: string; stepId: string; step: SetupGuideStep }
  | { op: "replace_asset_ref"; fromAssetId: string; toAssetId: string; stepId?: string };

export type CoursePatchErrorCode = "not_found" | "invalid_path" | "conflict" | "invalid_result";

/** Thrown by `applyPatch`. `message` is written for an editor and is safe to show in the CMS. */
export class CoursePatchError extends Error {
  readonly code: CoursePatchErrorCode;
  /** Present for `invalid_result`: what the schema objected to. */
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    code: CoursePatchErrorCode,
    message: string,
    issues: ReadonlyArray<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = "CoursePatchError";
    this.code = code;
    this.issues = issues;
  }
}

const UNSAFE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Optional text fields that `set_text` may create when they are not set yet. */
const OPTIONAL_TEXT_KEYS = new Set(["body", "coachContext", "editorNotes"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function setTextAtPath(root: Course, path: string, value: string): void {
  const segments = path.split(".");
  if (path.trim() === "" || segments.some((segment) => segment === "" || UNSAFE_SEGMENTS.has(segment))) {
    throw new CoursePatchError("invalid_path", `"${path}" is not a valid path.`);
  }
  let cursor: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(cursor)) {
      cursor = /^\d+$/.test(segment) ? cursor[Number(segment)] : undefined;
    } else if (isRecord(cursor) && Object.hasOwn(cursor, segment)) {
      cursor = cursor[segment];
    } else {
      cursor = undefined;
    }
    if (cursor === undefined || cursor === null) {
      throw new CoursePatchError("not_found", `Nothing was found at "${path}".`);
    }
  }
  const last = segments[segments.length - 1] ?? "";
  if (Array.isArray(cursor)) {
    const index = /^\d+$/.test(last) ? Number(last) : -1;
    if (index < 0 || index >= cursor.length) {
      throw new CoursePatchError("not_found", `Nothing was found at "${path}".`);
    }
    if (typeof cursor[index] !== "string") {
      throw new CoursePatchError("invalid_path", `"${path}" is not a piece of text.`);
    }
    cursor[index] = value;
    return;
  }
  if (!isRecord(cursor)) {
    throw new CoursePatchError("invalid_path", `"${path}" is not a piece of text.`);
  }
  const current = Object.hasOwn(cursor, last) ? cursor[last] : undefined;
  if (typeof current === "string" || (current === undefined && OPTIONAL_TEXT_KEYS.has(last))) {
    // An unset optional field may be filled in. The schema check at the end
    // of applyPatch rejects it if it does not belong on that object.
    cursor[last] = value;
    return;
  }
  throw new CoursePatchError(
    current === undefined ? "not_found" : "invalid_path",
    current === undefined ? `Nothing was found at "${path}".` : `"${path}" is not a piece of text.`,
  );
}

function locateLesson(course: Course, lessonId: string): Lesson {
  for (const mod of course.modules) {
    const lesson = mod.lessons.find((candidate) => candidate.id === lessonId);
    if (lesson) return lesson;
  }
  throw new CoursePatchError("not_found", `There is no lesson with the id "${lessonId}".`);
}

function locateStep(course: Course, stepId: string): { lesson: Lesson; index: number } {
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      const index = lesson.steps.findIndex((candidate) => candidate.id === stepId);
      if (index !== -1) return { lesson, index };
    }
  }
  throw new CoursePatchError("not_found", `There is no step with the id "${stepId}".`);
}

function insertAt<T>(list: T[], item: T, index: number | undefined): void {
  const position = index === undefined ? list.length : Math.max(0, Math.min(Math.trunc(index), list.length));
  list.splice(position, 0, item);
}

/** Renumbers `order` from 1 and adds the lesson's minutes up again. */
function tidyLesson(lesson: Lesson): void {
  lesson.steps.forEach((step, index) => {
    step.order = index + 1;
  });
  lesson.estimatedMinutes = lessonStepMinutes(lesson);
}

function tidyCourseMinutes(course: Course): void {
  course.estimatedMinutes = course.modules.reduce(
    (total, mod) => total + mod.lessons.reduce((sum, lesson) => sum + lesson.estimatedMinutes, 0),
    0,
  );
}

function applyToDraft(draft: Course, patch: CoursePatch): void {
  switch (patch.op) {
    case "set_text": {
      setTextAtPath(draft, patch.path, patch.value);
      return;
    }
    case "replace_step": {
      if (patch.step.id !== patch.stepId) {
        throw new CoursePatchError("conflict", "A replacement step must keep the same id.");
      }
      const { lesson, index } = locateStep(draft, patch.stepId);
      const previous = lesson.steps[index];
      lesson.steps[index] = structuredClone(patch.step);
      if (previous && previous.estimatedMinutes !== patch.step.estimatedMinutes) {
        lesson.estimatedMinutes = lessonStepMinutes(lesson);
        tidyCourseMinutes(draft);
      }
      return;
    }
    case "add_step": {
      const lesson = locateLesson(draft, patch.lessonId);
      if (flattenSteps(draft).some((entry) => entry.step.id === patch.step.id)) {
        throw new CoursePatchError("conflict", `There is already a step with the id "${patch.step.id}".`);
      }
      insertAt(lesson.steps, structuredClone(patch.step), patch.index);
      tidyLesson(lesson);
      tidyCourseMinutes(draft);
      return;
    }
    case "remove_step": {
      const { lesson, index } = locateStep(draft, patch.stepId);
      if (lesson.steps.length === 1) {
        throw new CoursePatchError(
          "conflict",
          "A lesson needs at least one step. Remove the lesson instead.",
        );
      }
      lesson.steps.splice(index, 1);
      tidyLesson(lesson);
      tidyCourseMinutes(draft);
      return;
    }
    case "move_step": {
      const from = locateStep(draft, patch.stepId);
      const target = locateLesson(draft, patch.toLessonId);
      if (from.lesson !== target && from.lesson.steps.length === 1) {
        throw new CoursePatchError(
          "conflict",
          "A lesson needs at least one step. Move another step in first.",
        );
      }
      const [step] = from.lesson.steps.splice(from.index, 1);
      if (!step) throw new CoursePatchError("not_found", `There is no step with the id "${patch.stepId}".`);
      insertAt(target.steps, step, patch.toIndex);
      tidyLesson(from.lesson);
      tidyLesson(target);
      tidyCourseMinutes(draft);
      return;
    }
    case "replace_quiz_question": {
      if (patch.question.id !== patch.questionId) {
        throw new CoursePatchError("conflict", "A replacement question must keep the same id.");
      }
      const quiz = draft.quizzes.find((candidate) => candidate.id === patch.quizId);
      if (!quiz) throw new CoursePatchError("not_found", `There is no quiz with the id "${patch.quizId}".`);
      const index = quiz.questions.findIndex((candidate) => candidate.id === patch.questionId);
      if (index === -1) {
        throw new CoursePatchError("not_found", `There is no question with the id "${patch.questionId}".`);
      }
      quiz.questions[index] = structuredClone(patch.question);
      return;
    }
    case "replace_setup_guide_step": {
      if (patch.step.id !== patch.stepId) {
        throw new CoursePatchError("conflict", "A replacement guide step must keep the same id.");
      }
      const guide = draft.setupGuides.find((candidate) => candidate.id === patch.guideId);
      if (!guide)
        throw new CoursePatchError("not_found", `There is no setup guide with the id "${patch.guideId}".`);
      const index = guide.steps.findIndex((candidate) => candidate.id === patch.stepId);
      if (index === -1) {
        throw new CoursePatchError("not_found", `There is no guide step with the id "${patch.stepId}".`);
      }
      guide.steps[index] = structuredClone(patch.step);
      return;
    }
    case "replace_asset_ref": {
      const swap = (id: string): string => (id === patch.fromAssetId ? patch.toAssetId : id);
      let replaced = 0;
      const swapList = (ids: string[] | undefined): string[] | undefined => {
        if (!ids) return ids;
        replaced += ids.filter((id) => id === patch.fromAssetId).length;
        return ids.map(swap);
      };
      if (patch.stepId !== undefined) {
        const { lesson, index } = locateStep(draft, patch.stepId);
        const step = lesson.steps[index];
        if (step?.assetIds) step.assetIds = swapList(step.assetIds);
      } else {
        for (const key of ["assetId", "posterAssetId", "captionsAssetId"] as const) {
          if (draft.trailer[key] === patch.fromAssetId) {
            draft.trailer[key] = patch.toAssetId;
            replaced += 1;
          }
        }
        for (const { step } of flattenSteps(draft)) {
          if (step.assetIds) step.assetIds = swapList(step.assetIds);
        }
        for (const guide of draft.setupGuides) {
          for (const step of guide.steps) {
            if (step.screenshotAssetIds) step.screenshotAssetIds = swapList(step.screenshotAssetIds);
          }
        }
      }
      if (replaced === 0) {
        throw new CoursePatchError("not_found", `The asset "${patch.fromAssetId}" is not used there.`);
      }
      return;
    }
  }
}

/**
 * Applies one inline edit and returns a NEW course. The input is never
 * changed. The result is checked against `courseSchema`, so what comes back
 * always parses.
 *
 * @throws CoursePatchError if the target does not exist, the patch conflicts
 * with the course, or the result would not parse (`invalid_result`).
 */
export function applyPatch(course: Course, patch: CoursePatch): Course {
  const draft: Course = structuredClone(course);
  applyToDraft(draft, patch);
  const result = courseSchema.safeParse(draft);
  if (!result.success) {
    throw new CoursePatchError(
      "invalid_result",
      "That change would leave the course in a state that cannot be saved.",
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Applies several edits in order. If any fails, nothing is applied (the input is untouched either way). */
export function applyPatches(course: Course, patches: readonly CoursePatch[]): Course {
  return patches.reduce((current, patch) => applyPatch(current, patch), course);
}
