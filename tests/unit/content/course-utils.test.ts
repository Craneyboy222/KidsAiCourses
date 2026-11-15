import { describe, expect, it } from "vitest";

import {
  CoursePatchError,
  applyPatch,
  applyPatches,
  collectText,
  evidenceTypes,
  findStep,
  firstStep,
  flattenSteps,
  nextStep,
  previousStep,
  requiredToolSlugs,
  stepCount,
  totalMinutes,
  type CoursePatch,
} from "@/content/course-utils";
import { courseSchema, type Course, type Step } from "@/content/schema";
import { summariseIssues, validateCourse } from "@/content/validate";

import { at, deepFreeze, firstQuiz, lessonOf, publishableContext, snapchatCourse, stepOf } from "./helpers";

const ORDER = [
  "s1",
  "s2",
  "s13",
  "s3",
  "s4",
  "s16",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s14",
  "s10",
  "s11",
  "s15",
  "s12",
];

const newStep = (id: string, minutes = 3): Step => ({
  id,
  type: "read",
  title: "A short read",
  order: 99,
  estimatedMinutes: minutes,
  body: "Read this before you carry on.",
  completion: { rule: "view" },
  hints: [],
});

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof CoursePatchError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

describe("reading helpers", () => {
  const course = snapchatCourse();

  it("flattenSteps lists every step in course order with its context", () => {
    const flat = flattenSteps(course);
    expect(flat.map((entry) => entry.step.id)).toEqual(ORDER);
    expect(flat.map((entry) => entry.index)).toEqual(ORDER.map((_, index) => index));
    expect(at(flat, 6)).toMatchObject({
      moduleIndex: 1,
      lessonIndex: 1,
      stepIndex: 1,
      index: 6,
      path: "modules.1.lessons.1.steps.1",
    });
    expect(at(flat, 6).module.id).toBe("m2");
    expect(at(flat, 6).lesson.id).toBe("m2l2");
  });

  it("findStep finds a step by id", () => {
    expect(findStep(course, "s12")?.path).toBe("modules.3.lessons.0.steps.3");
    expect(findStep(course, "nope")).toBeUndefined();
  });

  it("nextStep and previousStep cross lesson and module boundaries", () => {
    expect(nextStep(course, "s13")?.step.id).toBe("s3");
    expect(previousStep(course, "s3")?.step.id).toBe("s13");
    expect(nextStep(course, "s4")?.step.id).toBe("s16");
    expect(nextStep(course, "s12")).toBeUndefined();
    expect(previousStep(course, "s1")).toBeUndefined();
    expect(nextStep(course, "nope")).toBeUndefined();
    expect(previousStep(course, "nope")).toBeUndefined();
  });

  it("firstStep, stepCount and totalMinutes", () => {
    expect(firstStep(course)?.step.id).toBe("s1");
    expect(stepCount(course)).toBe(16);
    expect(totalMinutes(course)).toBe(177);
    expect(totalMinutes(course)).toBe(course.estimatedMinutes);
  });

  it("requiredToolSlugs lists required tools only, once each", () => {
    expect(requiredToolSlugs(course)).toEqual(["replit"]);
    const more: Course = {
      ...course,
      toolRequirements: [
        ...course.toolRequirements,
        { toolSlug: "canva", purpose: "Optional poster", required: false },
        { toolSlug: "replit", purpose: "Listed twice", required: true },
      ],
    };
    expect(requiredToolSlugs(more)).toEqual(["replit"]);
  });

  it("evidenceTypes comes from the project brief", () => {
    expect(evidenceTypes(course)).toEqual(["link", "screenshot"]);
  });

  it("collectText returns paths that set_text accepts", () => {
    const entries = collectText(course);
    expect(
      entries.find((entry) => entry.path === "modules.3.lessons.0.steps.3.config.evidenceHint")?.audience,
    ).toBe("copy");
    expect(entries.find((entry) => entry.path === "modules.0.lessons.0.steps.1.coachContext")?.audience).toBe(
      "coach",
    );
    expect(entries.find((entry) => entry.path === "quizzes.0.questions.0.options.1.feedback")?.audience).toBe(
      "quiz",
    );
    expect(entries.some((entry) => entry.path.endsWith("config.toolSlug"))).toBe(false);
    for (const entry of entries) {
      expect(() => applyPatch(course, { op: "set_text", path: entry.path, value: entry.text })).not.toThrow();
    }
  });
});

describe("applyPatch", () => {
  const replacementQuestion = (course: Course) => ({
    ...structuredClone(at(firstQuiz(course).questions, 1)),
    prompt: "When is the right moment to ask for the camera?",
  });

  const patches = (course: Course): Array<[string, CoursePatch]> => [
    ["set_text on the title", { op: "set_text", path: "title", value: "Build a Snap-Style Camera App" }],
    [
      "set_text on a hint",
      { op: "set_text", path: "modules.1.lessons.0.steps.0.hints.1", value: "What if they say no?" },
    ],
    [
      "set_text on quiz feedback",
      { op: "set_text", path: "quizzes.0.questions.0.options.0.feedback", value: "Copies can still exist." },
    ],
    [
      "set_text on a config field",
      {
        op: "set_text",
        path: "modules.2.lessons.1.steps.0.config.task",
        value: "Once a message has been seen, take it off the screen after ten seconds.",
      },
    ],
    [
      "set_text adding an optional body",
      { op: "set_text", path: "modules.0.lessons.0.steps.2.body", value: "Nice work." },
    ],
    [
      "replace_step",
      {
        op: "replace_step",
        stepId: "s4",
        step: { ...structuredClone(stepOf(course, "s4")), title: "Camera on" },
      },
    ],
    ["add_step", { op: "add_step", lessonId: "m2l1", step: newStep("s20"), index: 1 }],
    ["remove_step", { op: "remove_step", stepId: "s11" }],
    ["move_step", { op: "move_step", stepId: "s11", toLessonId: "m3l2", toIndex: 2 }],
    [
      "replace_quiz_question",
      {
        op: "replace_quiz_question",
        quizId: "q-snaplab-1",
        questionId: "q2",
        question: replacementQuestion(course),
      },
    ],
    [
      "replace_setup_guide_step",
      {
        op: "replace_setup_guide_step",
        guideId: "guide-replit",
        stepId: "g2",
        step: {
          id: "g2",
          title: "Confirm your email",
          order: 2,
          kind: "verify_email",
          body: "Open the email and press the button.",
        },
      },
    ],
    [
      "replace_asset_ref",
      { op: "replace_asset_ref", fromAssetId: "vid-snaplab-trailer", toAssetId: "vid-snaplab-trailer-v2" },
    ],
  ];

  it.each(patches(snapchatCourse()))(
    "%s never mutates its input and returns a course that still parses",
    (_label, patch) => {
      const input = deepFreeze(snapchatCourse());
      const before = JSON.stringify(input);

      const output = applyPatch(input, patch);

      expect(JSON.stringify(input)).toBe(before);
      expect(output).not.toBe(input);
      expect(JSON.stringify(output)).not.toBe(before);
      expect(courseSchema.safeParse(output).success).toBe(true);
    },
  );

  it("does not keep a reference to the objects inside a patch", () => {
    const step = newStep("s20");
    const output = applyPatch(snapchatCourse(), { op: "add_step", lessonId: "m2l1", step });
    step.title = "Changed afterwards";
    expect(findStep(output, "s20")?.step.title).toBe("A short read");
  });

  it("set_text changes exactly one field", () => {
    const course = snapchatCourse();
    const output = applyPatch(course, { op: "set_text", path: "modules.0.title", value: "Get set up" });
    expect(at(output.modules, 0).title).toBe("Get set up");
    expect({
      ...output,
      modules: [{ ...at(output.modules, 0), title: at(course.modules, 0).title }, ...output.modules.slice(1)],
    }).toEqual(course);
  });

  it("set_text refuses anything that is not text, or is not there", () => {
    const course = snapchatCourse();
    expect(errorCode(() => applyPatch(course, { op: "set_text", path: "minAge", value: "13" }))).toBe(
      "invalid_path",
    );
    expect(errorCode(() => applyPatch(course, { op: "set_text", path: "modules.0", value: "x" }))).toBe(
      "invalid_path",
    );
    expect(errorCode(() => applyPatch(course, { op: "set_text", path: "modules.9.title", value: "x" }))).toBe(
      "not_found",
    );
    expect(
      errorCode(() =>
        applyPatch(course, { op: "set_text", path: "modules.0.lessons.0.steps.0.hints.0", value: "x" }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(() => applyPatch(course, { op: "set_text", path: "modules.0.nickname", value: "x" })),
    ).toBe("not_found");
    expect(errorCode(() => applyPatch(course, { op: "set_text", path: "", value: "x" }))).toBe(
      "invalid_path",
    );
    expect(
      errorCode(() => applyPatch(course, { op: "set_text", path: "__proto__.polluted", value: "x" })),
    ).toBe("invalid_path");
    expect(
      errorCode(() => applyPatch(course, { op: "set_text", path: "modules.0.constructor.name", value: "x" })),
    ).toBe("invalid_path");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses a change the schema would reject, such as a title that is too long", () => {
    const course = snapchatCourse();
    let caught: unknown;
    try {
      applyPatch(course, { op: "set_text", path: "title", value: "T".repeat(61) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoursePatchError);
    expect(caught).toMatchObject({ code: "invalid_result", issues: [{ path: "title" }] });
  });

  it("add_step inserts at the index, renumbers order and adds the minutes up again", () => {
    const output = applyPatch(snapchatCourse(), {
      op: "add_step",
      lessonId: "m2l1",
      step: newStep("s20", 3),
      index: 1,
    });
    const lesson = lessonOf(output, "m2l1");
    expect(lesson.steps.map((step) => [step.id, step.order])).toEqual([
      ["s3", 1],
      ["s20", 2],
      ["s4", 3],
    ]);
    expect(lesson.estimatedMinutes).toBe(23);
    expect(output.estimatedMinutes).toBe(180);
    expect(summariseIssues(validateCourse(output, publishableContext()))).toEqual({
      errors: 0,
      warnings: 0,
      publishable: true,
    });
  });

  it("add_step appends when no index is given, and refuses a duplicate id or unknown lesson", () => {
    const course = snapchatCourse();
    const output = applyPatch(course, { op: "add_step", lessonId: "m1l1", step: newStep("s20") });
    expect(lessonOf(output, "m1l1").steps.at(-1)?.id).toBe("s20");
    expect(
      errorCode(() => applyPatch(course, { op: "add_step", lessonId: "m1l1", step: newStep("s5") })),
    ).toBe("conflict");
    expect(
      errorCode(() => applyPatch(course, { op: "add_step", lessonId: "nope", step: newStep("s20") })),
    ).toBe("not_found");
  });

  it("remove_step removes the step and keeps the totals right", () => {
    const output = applyPatch(snapchatCourse(), { op: "remove_step", stepId: "s11" });
    const lesson = lessonOf(output, "m4l1");
    expect(lesson.steps.map((step) => [step.id, step.order])).toEqual([
      ["s10", 1],
      ["s15", 2],
      ["s12", 3],
    ]);
    expect(lesson.estimatedMinutes).toBe(22);
    expect(output.estimatedMinutes).toBe(172);
    expect(findStep(output, "s11")).toBeUndefined();
  });

  it("remove_step will not empty a lesson", () => {
    const course = snapchatCourse();
    expect(errorCode(() => applyPatch(course, { op: "remove_step", stepId: "s6" }))).toBe("conflict");
    expect(errorCode(() => applyPatch(course, { op: "remove_step", stepId: "nope" }))).toBe("not_found");
  });

  it("move_step moves between lessons and within one", () => {
    const course = snapchatCourse();
    const across = applyPatch(course, { op: "move_step", stepId: "s11", toLessonId: "m3l2", toIndex: 2 });
    expect(lessonOf(across, "m3l2").steps.map((step) => step.id)).toEqual(["s7", "s8", "s11", "s9", "s14"]);
    expect(lessonOf(across, "m3l2").estimatedMinutes).toBe(38);
    expect(lessonOf(across, "m4l1").steps.map((step) => step.id)).toEqual(["s10", "s15", "s12"]);
    expect(lessonOf(across, "m4l1").estimatedMinutes).toBe(22);
    expect(across.estimatedMinutes).toBe(177);
    expect(stepCount(across)).toBe(16);

    const within = applyPatch(course, { op: "move_step", stepId: "s9", toLessonId: "m3l2", toIndex: 0 });
    expect(lessonOf(within, "m3l2").steps.map((step) => [step.id, step.order])).toEqual([
      ["s9", 1],
      ["s7", 2],
      ["s8", 3],
      ["s14", 4],
    ]);

    expect(errorCode(() => applyPatch(course, { op: "move_step", stepId: "s6", toLessonId: "m4l1" }))).toBe(
      "conflict",
    );
    expect(errorCode(() => applyPatch(course, { op: "move_step", stepId: "s9", toLessonId: "nope" }))).toBe(
      "not_found",
    );
  });

  it("replace_step swaps the step, keeps the id and follows a change in minutes", () => {
    const course = snapchatCourse();
    const edited: Step = {
      ...structuredClone(stepOf(course, "s4")),
      title: "Camera on",
      estimatedMinutes: 3,
    };
    const output = applyPatch(course, { op: "replace_step", stepId: "s4", step: edited });
    expect(stepOf(output, "s4").title).toBe("Camera on");
    expect(lessonOf(output, "m2l1").estimatedMinutes).toBe(22);
    expect(output.estimatedMinutes).toBe(179);
    expect(
      errorCode(() =>
        applyPatch(course, { op: "replace_step", stepId: "s4", step: { ...edited, id: "s40" } }),
      ),
    ).toBe("conflict");
    expect(
      errorCode(() =>
        applyPatch(course, { op: "replace_step", stepId: "nope", step: { ...edited, id: "nope" } }),
      ),
    ).toBe("not_found");
  });

  it("replace_quiz_question swaps one question", () => {
    const course = snapchatCourse();
    const question = replacementQuestion(course);
    const output = applyPatch(course, {
      op: "replace_quiz_question",
      quizId: "q-snaplab-1",
      questionId: "q2",
      question,
    });
    expect(firstQuiz(output).questions.map((item) => item.prompt)).toEqual([
      at(firstQuiz(course).questions, 0).prompt,
      "When is the right moment to ask for the camera?",
      at(firstQuiz(course).questions, 2).prompt,
    ]);
    expect(
      errorCode(() =>
        applyPatch(course, { op: "replace_quiz_question", quizId: "nope", questionId: "q2", question }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(() =>
        applyPatch(course, {
          op: "replace_quiz_question",
          quizId: "q-snaplab-1",
          questionId: "q9",
          question: { ...question, id: "q9" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(() =>
        applyPatch(course, {
          op: "replace_quiz_question",
          quizId: "q-snaplab-1",
          questionId: "q1",
          question,
        }),
      ),
    ).toBe("conflict");
  });

  it("replace_setup_guide_step swaps one guide step", () => {
    const course = snapchatCourse();
    const step = {
      id: "g2",
      title: "Confirm your email",
      order: 2,
      kind: "verify_email" as const,
      body: "Open the email and press the button.",
    };
    const output = applyPatch(course, {
      op: "replace_setup_guide_step",
      guideId: "guide-replit",
      stepId: "g2",
      step,
    });
    expect(at(at(output.setupGuides, 0).steps, 1)).toEqual(step);
    expect(at(output.setupGuides, 0).steps).toHaveLength(4);
    expect(
      errorCode(() =>
        applyPatch(course, { op: "replace_setup_guide_step", guideId: "nope", stepId: "g2", step }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(() =>
        applyPatch(course, {
          op: "replace_setup_guide_step",
          guideId: "guide-replit",
          stepId: "g7",
          step: { ...step, id: "g7" },
        }),
      ),
    ).toBe("not_found");
  });

  it("replace_asset_ref repoints every use, or only one step", () => {
    const course = snapchatCourse();
    const everywhere = applyPatch(course, {
      op: "replace_asset_ref",
      fromAssetId: "vid-snaplab-trailer",
      toAssetId: "vid-new",
    });
    expect(everywhere.trailer.assetId).toBe("vid-new");
    expect(stepOf(everywhere, "s1").assetIds).toEqual([
      "vid-new",
      "vtt-snaplab-trailer",
      "tx-snaplab-trailer",
    ]);

    const oneStep = applyPatch(course, {
      op: "replace_asset_ref",
      fromAssetId: "vid-snaplab-trailer",
      toAssetId: "vid-new",
      stepId: "s1",
    });
    expect(oneStep.trailer.assetId).toBe("vid-snaplab-trailer");
    expect(stepOf(oneStep, "s1").assetIds?.[0]).toBe("vid-new");

    expect(
      errorCode(() =>
        applyPatch(course, { op: "replace_asset_ref", fromAssetId: "img-unused", toAssetId: "x" }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(() =>
        applyPatch(course, {
          op: "replace_asset_ref",
          fromAssetId: "vid-snaplab-trailer",
          toAssetId: "x",
          stepId: "s3",
        }),
      ),
    ).toBe("not_found");
  });

  it("applyPatches applies edits in order and leaves the input alone", () => {
    const input = deepFreeze(snapchatCourse());
    const output = applyPatches(input, [
      { op: "add_step", lessonId: "m1l1", step: newStep("s20", 2) },
      { op: "set_text", path: "modules.0.lessons.0.steps.3.title", value: "One more thing" },
      { op: "move_step", stepId: "s20", toLessonId: "m1l1", toIndex: 0 },
    ]);
    expect(lessonOf(output, "m1l1").steps.map((step) => step.id)).toEqual(["s20", "s1", "s2", "s13"]);
    expect(stepOf(output, "s20").title).toBe("One more thing");
    expect(stepOf(input, "s1").order).toBe(1);
    expect(output.estimatedMinutes).toBe(179);
  });
});
