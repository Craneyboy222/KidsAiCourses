import { describe, expect, it } from "vitest";

import type { Course } from "@/content/schema";
import {
  QA_CHECKLIST,
  VALIDATION_RULES,
  findAmericanSpellings,
  hintLeak,
  setupGuideWaiverKey,
  summariseIssues,
  validateCourse,
  type ValidationCode,
  type ValidationContext,
} from "@/content/validate";

import {
  at,
  codesOf,
  configOf,
  firstQuiz,
  lessonOf,
  publishableContext,
  snapchatCourse,
  stepOf,
} from "./helpers";

type Mutation = (course: Course, context: ValidationContext) => void;

const soleRequirement = (course: Course) => at(course.toolRequirements, 0);
const guide = (course: Course) => at(course.setupGuides, 0);
const question = (course: Course, index: number) => at(firstQuiz(course).questions, index);

/** One focused way to break each rule, starting from the valid Snapchat course. */
const FAILING_FIXTURES: Record<ValidationCode, Mutation> = {
  // Structure
  submit_step_count: (course) => {
    lessonOf(course, "m4l1").steps.pop();
  },
  submit_step_position: (course) => {
    const submit = lessonOf(course, "m4l1").steps.pop();
    if (submit) lessonOf(course, "m1l1").steps.push(submit);
  },
  submit_step_not_last: (course) => {
    lessonOf(course, "m4l1").steps.reverse();
  },
  ethics_checkpoint_missing: (course) => {
    stepOf(course, "s8").type = "reflection";
  },
  module_checkpoint_missing: (course) => {
    const lesson = lessonOf(course, "m1l1");
    lesson.steps = lesson.steps.filter((step) => step.type !== "checkpoint");
  },
  module_count: (course) => {
    course.modules.splice(0, 2);
  },
  step_type_forbidden: (course) => {
    (stepOf(course, "s3") as { type: string }).type = "code_runner";
  },
  step_config_invalid: (course) => {
    delete stepOf(course, "s9").config;
  },
  forbidden_config_key: (course) => {
    configOf(course, "s3").sandbox = { runtime: "node" };
  },
  completion_rule_mismatch: (course) => {
    stepOf(course, "s12").completion = { rule: "view" };
  },
  // Tools and setup guides
  setup_guide_missing: (course) => {
    course.setupGuides = [];
  },
  setup_guide_incomplete: (course) => {
    guide(course).steps = guide(course).steps.filter((step) => step.kind !== "privacy_settings");
  },
  setup_guide_waived: (course, context) => {
    course.setupGuides = [];
    context.waivers = [setupGuideWaiverKey("replit")];
  },
  setup_guide_cost_stated: (course) => {
    const freePlan = at(guide(course).steps, 2);
    freePlan.kind = "other";
    freePlan.body =
      "This project needs the Core plan. Ask first: a parent would pay £8 a month and can cancel at any time.";
  },
  setup_guide_orphan: (course) => {
    course.setupGuides.push({
      ...structuredClone(guide(course)),
      id: "guide-other",
      toolSlug: "another-tool",
    });
  },
  step_tool_missing: (course) => {
    configOf(course, "s3").toolSlug = "another-tool";
  },
  step_guide_missing: (course) => {
    configOf(course, "s2").guideId = "guide-nowhere";
  },
  step_guide_tool_mismatch: (course) => {
    configOf(course, "s2").toolSlug = "base44";
  },
  step_guide_step_missing: (course) => {
    configOf(course, "s2").throughStepIds = ["g1", "g2", "g3", "g4", "g9"];
  },
  external_task_no_instructions: (course) => {
    configOf(course, "s7").task = "Add a timer.";
  },
  tool_unknown: (course, context) => {
    delete soleRequirement(course).fallbackToolSlug;
    delete context.tools.replit;
  },
  tool_policy_unverified: (course, context) => {
    delete soleRequirement(course).fallbackToolSlug;
    context.tools.replit = { under18Policy: null, status: "pending_verification" };
  },
  tool_blocked: (_course, context) => {
    context.tools.replit = { under18Policy: "blocked", status: "approved" };
    context.tools.base44 = { under18Policy: "blocked", status: "approved" };
  },
  tool_not_approved: (course, context) => {
    delete soleRequirement(course).fallbackToolSlug;
    context.tools.replit = { under18Policy: "allowed", status: "pending_verification" };
  },
  tool_fallback_in_use: (_course, context) => {
    context.tools.replit = { under18Policy: "blocked", status: "approved" };
  },
  tool_parent_approval_required: (_course, context) => {
    context.tools.replit = { under18Policy: "parent_consent_required", status: "approved" };
  },
  tool_optional_unavailable: (course) => {
    course.toolRequirements.push({ toolSlug: "another-tool", purpose: "Optional extras", required: false });
  },
  // Assets
  asset_missing: (course) => {
    stepOf(course, "s16").assetIds = ["img-does-not-exist"];
  },
  video_missing_video: (course) => {
    stepOf(course, "s1").assetIds = ["vtt-snaplab-trailer", "tx-snaplab-trailer"];
  },
  video_missing_captions: (course) => {
    stepOf(course, "s1").assetIds = ["vid-snaplab-trailer", "tx-snaplab-trailer"];
  },
  video_missing_transcript: (course) => {
    stepOf(course, "s1").assetIds = ["vid-snaplab-trailer", "vtt-snaplab-trailer"];
  },
  trailer_missing_captions: (course) => {
    course.trailer.captionsAssetId = "tx-snaplab-trailer";
  },
  trailer_wrong_kind: (course) => {
    course.trailer.posterAssetId = "vid-snaplab-trailer";
  },
  image_missing_alt: (_course, context) => {
    context.assets["img-snaplab-sample"] = { kind: "image" };
  },
  // Quizzes
  quiz_missing: (course) => {
    configOf(course, "s9").quizId = "q-nowhere";
  },
  quiz_no_correct_option: (course) => {
    for (const option of question(course, 0).options) option.correct = false;
  },
  quiz_single_correct_count: (course) => {
    for (const option of question(course, 0).options) option.correct = true;
  },
  quiz_too_few_options: (course) => {
    question(course, 1).options.length = 1;
  },
  quiz_option_feedback_missing: (course) => {
    at(question(course, 0).options, 0).feedback = "  ";
  },
  quiz_pass_mark_range: (course) => {
    firstQuiz(course).passMark = 66;
  },
  quiz_threshold_mismatch: (course) => {
    stepOf(course, "s9").completion.threshold = 0.5;
  },
  quiz_unused: (course) => {
    course.quizzes.push({ ...structuredClone(firstQuiz(course)), id: "q-spare" });
  },
  // Hints
  hint_contains_solution: (course) => {
    stepOf(course, "s7").hints.push(
      [
        "Here is the whole thing:",
        "```js",
        "function vanish(message) {",
        "  setTimeout(() => {",
        "    message.remove();",
        "  }, 10000);",
        "}",
        "```",
      ].join("\n"),
    );
  },
  // Safety
  evidence_requires_real_people: (course) => {
    configOf(course, "s12").evidenceHint = "Paste your link, then upload a selfie with your filter applied.";
  },
  // Consistency
  duplicate_id: (course) => {
    stepOf(course, "s4").id = "s3";
  },
  order_not_increasing: (course) => {
    stepOf(course, "s4").order = 1;
  },
  minutes_course_mismatch: (course) => {
    course.estimatedMinutes += 5;
  },
  minutes_lesson_mismatch: (course) => {
    lessonOf(course, "m2l2").estimatedMinutes -= 2;
  },
  submit_brief_mismatch: (course) => {
    configOf(course, "s12").evidence = ["link", "screenshot", "video"];
  },
  interest_unknown: (course) => {
    course.interests.push("cooking");
  },
  rubric_levels_incomplete: (course) => {
    at(course.rubric.criteria, 0).levels.pop();
  },
  // Language
  spelling_american: (course) => {
    stepOf(course, "s5").hints.push("Pick your favorite color for the signature filter.");
  },
};

describe("validateCourse: the Snapchat-style course", () => {
  it("validates with no errors and no warnings when its tools are approved", () => {
    expect(validateCourse(snapchatCourse(), publishableContext())).toEqual([]);
  });

  it("does not change the course or the context", () => {
    const course = snapchatCourse();
    const context = publishableContext();
    const before = JSON.stringify([course, context]);
    validateCourse(course, context);
    expect(JSON.stringify([course, context])).toBe(before);
  });

  it("is publishable according to summariseIssues", () => {
    expect(summariseIssues(validateCourse(snapchatCourse(), publishableContext()))).toEqual({
      errors: 0,
      warnings: 0,
      publishable: true,
    });
  });
});

describe("validateCourse: one failing fixture per rule", () => {
  it("has a fixture for every rule code", () => {
    expect(Object.keys(FAILING_FIXTURES).sort()).toEqual(Object.keys(VALIDATION_RULES).sort());
  });

  it.each(Object.entries(FAILING_FIXTURES) as Array<[ValidationCode, Mutation]>)("%s", (code, mutate) => {
    const course = snapchatCourse();
    const context = publishableContext();
    mutate(course, context);

    const found = validateCourse(course, context).filter((item) => item.code === code);
    expect(found.length).toBeGreaterThan(0);
    for (const item of found) {
      expect(item.severity).toBe(VALIDATION_RULES[code].severity);
      expect(item.waivable).toBe(VALIDATION_RULES[code].waivable);
      expect(item.message.length).toBeGreaterThan(20);
      expect(typeof item.path).toBe("string");
    }
  });

  it("marks only the setup-guide rules as waivable", () => {
    const waivable = Object.entries(VALIDATION_RULES)
      .filter(([, rule]) => rule.waivable)
      .map(([code]) => code);
    expect(waivable.sort()).toEqual(["setup_guide_incomplete", "setup_guide_missing"]);
  });
});

describe("validateCourse: structure", () => {
  it("rejects a second submit step", () => {
    const course = snapchatCourse();
    lessonOf(course, "m3l1").steps.push({ ...structuredClone(stepOf(course, "s12")), id: "s99", order: 2 });
    const codes = codesOf(validateCourse(course, publishableContext()));
    expect(codes).toContain("submit_step_count");
    expect(codes).toContain("submit_step_position");
  });

  it("rejects a submit step in an earlier lesson of the last module", () => {
    const course = snapchatCourse();
    const last = at(course.modules, 3);
    last.lessons.push({
      id: "m4l2",
      title: "Afterwards",
      order: 2,
      estimatedMinutes: 1,
      steps: [{ ...structuredClone(stepOf(course, "s15")), id: "s98", order: 1 }],
    });
    expect(codesOf(validateCourse(course, publishableContext()))).toContain("submit_step_position");
  });

  it("accepts 3 and 5 modules and warns about 6", () => {
    const three = snapchatCourse();
    three.modules.splice(1, 1);
    expect(codesOf(validateCourse(three, publishableContext()))).not.toContain("module_count");

    const six = snapchatCourse();
    for (const id of ["m5", "m6"]) {
      six.modules.push({ ...structuredClone(at(six.modules, 0)), id });
    }
    const issue = validateCourse(six, publishableContext()).find((item) => item.code === "module_count");
    expect(issue?.severity).toBe("warning");
  });

  it.each(["sandbox", "runCode", "run_code", "preview", "generateMedia", "livePreview"])(
    "rejects the config key %s, even when nested",
    (key) => {
      const course = snapchatCourse();
      configOf(course, "s6").options = { [key]: true };
      const issue = validateCourse(course, publishableContext()).find(
        (item) => item.code === "forbidden_config_key",
      );
      expect(issue?.severity).toBe("error");
      expect(issue?.path).toContain(`config.options.${key}`);
    },
  );
});

describe("validateCourse: tools and setup guides", () => {
  it("accepts a reviewed waiver for a missing guide, and says so", () => {
    const course = snapchatCourse();
    course.setupGuides = [];
    // The step that walked through the guide goes too, as it would in a real edit.
    lessonOf(course, "m1l1").steps = lessonOf(course, "m1l1").steps.filter(
      (step) => step.type !== "setup_guide",
    );
    lessonOf(course, "m1l1").estimatedMinutes = 4;
    course.estimatedMinutes -= 11;

    const without = validateCourse(course, publishableContext());
    const missing = without.find((item) => item.code === "setup_guide_missing");
    expect(missing).toMatchObject({ severity: "error", waivable: true, waiverKey: "setup_guide:replit" });

    const waived = validateCourse(course, { ...publishableContext(), waivers: ["setup_guide:replit"] });
    expect(summariseIssues(waived).errors).toBe(0);
    expect(codesOf(waived)).toContain("setup_guide_waived");
  });

  it("ignores a waiver for a different tool", () => {
    const course = snapchatCourse();
    course.setupGuides = [];
    const issues = validateCourse(course, { ...publishableContext(), waivers: ["setup_guide:base44"] });
    expect(codesOf(issues)).toContain("setup_guide_missing");
  });

  it.each(["create_account", "verify_email", "choose_free_plan", "privacy_settings"] as const)(
    "requires the guide to cover %s",
    (kind) => {
      const course = snapchatCourse();
      guide(course).steps = guide(course).steps.filter((step) => step.kind !== kind);
      const issue = validateCourse(course, publishableContext()).find(
        (item) => item.code === "setup_guide_incomplete",
      );
      expect(issue).toMatchObject({ severity: "error", waivable: true, waiverKey: "setup_guide:replit" });
    },
  );

  it("accepts a guide that states the cost in place of a free-plan step, with a warning", () => {
    const course = snapchatCourse();
    FAILING_FIXTURES.setup_guide_cost_stated(course, publishableContext());
    const issues = validateCourse(course, publishableContext());
    expect(codesOf(issues)).not.toContain("setup_guide_incomplete");
    expect(summariseIssues(issues).errors).toBe(0);
  });

  it("falls back to an approved tool when the main tool is blocked, but then wants a guide for it", () => {
    const context = publishableContext();
    context.tools.replit = { under18Policy: "blocked", status: "approved" };
    const issues = validateCourse(snapchatCourse(), context);
    expect(codesOf(issues)).not.toContain("tool_blocked");
    expect(codesOf(issues)).toContain("tool_fallback_in_use");
    expect(issues.find((item) => item.code === "setup_guide_missing")?.waiverKey).toBe("setup_guide:base44");
  });

  it.each([
    ["blocked", { under18Policy: "blocked", status: "approved" }],
    ["unverified", { under18Policy: null, status: "pending_verification" }],
    ["not approved", { under18Policy: "allowed", status: "candidate" }],
  ] as const)("does not accept a fallback that is %s", (_label, fallback) => {
    const context = publishableContext();
    context.tools.replit = { under18Policy: "blocked", status: "approved" };
    context.tools.base44 = { ...fallback };
    const issues = validateCourse(snapchatCourse(), context);
    expect(issues.find((item) => item.code === "tool_blocked")?.severity).toBe("error");
    expect(codesOf(issues)).not.toContain("tool_fallback_in_use");
  });

  it("treats a tool missing from the Register like a blocked one", () => {
    const context = publishableContext();
    delete context.tools.replit;
    delete context.tools.base44;
    expect(
      validateCourse(snapchatCourse(), context).find((item) => item.code === "tool_unknown")?.severity,
    ).toBe("error");
  });

  it.each(["parent_consent_required", "parent_operated"] as const)(
    "warns that parent approval gates Start for a %s tool, without blocking",
    (policy) => {
      const context = publishableContext();
      context.tools.replit = { under18Policy: policy, status: "approved" };
      const issues = validateCourse(snapchatCourse(), context);
      expect(issues.find((item) => item.code === "tool_parent_approval_required")).toMatchObject({
        severity: "warning",
        path: "toolRequirements.0.toolSlug",
      });
      expect(summariseIssues(issues).publishable).toBe(true);
    },
  );

  it("reports every unverified tool in the real seed files as tool_policy_unverified and nothing else", () => {
    const context = publishableContext();
    context.tools.replit = { under18Policy: null, status: "pending_verification" };
    context.tools.base44 = { under18Policy: null, status: "pending_verification" };
    const errors = validateCourse(snapchatCourse(), context).filter((item) => item.severity === "error");
    expect(codesOf(errors)).toEqual(["tool_policy_unverified"]);
  });

  it("accepts external-task instructions given as a click path", () => {
    const course = snapchatCourse();
    const config = configOf(course, "s7");
    config.task = "Add a timer.";
    config.clicks = ["Open chat.js", "Find showMessage", "Add the timer"];
    expect(codesOf(validateCourse(course, publishableContext()))).not.toContain(
      "external_task_no_instructions",
    );
  });
});

describe("validateCourse: assets", () => {
  it("reports an unknown trailer asset", () => {
    const course = snapchatCourse();
    course.trailer.captionsAssetId = "vtt-does-not-exist";
    expect(validateCourse(course, publishableContext())).toContainEqual(
      expect.objectContaining({ code: "asset_missing", path: "trailer.captionsAssetId", severity: "error" }),
    );
  });

  it("wants captions and a transcript wherever a video is shown, not only on video steps", () => {
    const course = snapchatCourse();
    stepOf(course, "s16").assetIds = ["img-snaplab-sample", "vid-snaplab-trailer"];
    const codes = codesOf(validateCourse(course, publishableContext()));
    expect(codes).toContain("video_missing_captions");
    expect(codes).toContain("video_missing_transcript");
  });

  it("wants alt text on the trailer poster and on guide screenshots", () => {
    const course = snapchatCourse();
    at(guide(course).steps, 0).screenshotAssetIds = ["shot-signup"];
    const context = publishableContext();
    context.assets["img-snaplab-trailer-poster"] = { kind: "image", altText: "" };
    context.assets["shot-signup"] = { kind: "guide_screenshot" };
    const paths = validateCourse(course, context)
      .filter((item) => item.code === "image_missing_alt")
      .map((item) => item.path);
    expect(paths).toEqual(["trailer.posterAssetId", "setupGuides.0.steps.0.screenshotAssetIds.0"]);
  });
});

describe("validateCourse: quizzes", () => {
  it("allows several correct options on a multi question", () => {
    const course = snapchatCourse();
    const first = question(course, 0);
    first.kind = "multi";
    for (const option of first.options) option.correct = true;
    expect(codesOf(validateCourse(course, publishableContext()))).not.toContain("quiz_single_correct_count");
  });

  it.each([-0.1, 1.01, Number.NaN])("rejects a pass mark of %s", (passMark) => {
    const course = snapchatCourse();
    firstQuiz(course).passMark = passMark;
    expect(codesOf(validateCourse(course, publishableContext()))).toContain("quiz_pass_mark_range");
  });
});

describe("hints never contain the solution", () => {
  const code = (lines: number): string =>
    ["```js", ...Array.from({ length: lines }, (_, i) => `step${i}();`), "```"].join("\n");

  it("allows a short illustrative snippet", () => {
    expect(hintLeak(`Try something like this:\n${code(3)}`)).toBeNull();
    expect(hintLeak("Look up `navigator.mediaDevices.getUserMedia`.")).toBeNull();
    expect(hintLeak("Let the user choose a filter, then loop through your array to apply it.")).toBeNull();
  });

  it("flags a fenced block of more than three lines", () => {
    expect(hintLeak(`Paste this:\n${code(4)}`)).toMatch(/code block of 4 lines/);
  });

  it("flags more than about 400 characters of code without a fence", () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `const filter${i} = makeFilter("style-${i}", { strength: ${i} });`,
    );
    expect(lines.join("\n").length).toBeGreaterThan(400);
    expect(hintLeak(lines.join("\n"))).toMatch(/characters of code/);
  });

  it("flags a hint that repeats the reference solution", () => {
    const referenceSolution = "setTimeout(() => { message.remove(); renderChat(); }, 10000);";
    expect(
      hintLeak("Use `setTimeout(() => { message.remove(); renderChat(); }, 10000);`", referenceSolution),
    ).toMatch(/reference solution/);
    expect(hintLeak("setTimeout is your friend.", referenceSolution)).toBeNull();

    const course = snapchatCourse();
    configOf(course, "s7").referenceSolution = referenceSolution;
    stepOf(course, "s7").hints.push(`The answer is ${referenceSolution}`);
    expect(validateCourse(course, publishableContext())).toContainEqual(
      expect.objectContaining({
        code: "hint_contains_solution",
        path: "modules.2.lessons.1.steps.0.hints.2",
      }),
    );
  });
});

describe("validateCourse: the real-people rule (decision D3)", () => {
  const BAD_COPY = "Take a photo of yourself with the filter on and upload it.";

  const placements: Array<[string, (course: Course) => void, string]> = [
    [
      "the project brief scenario",
      (c) => void (c.projectBrief.scenario += ` ${BAD_COPY}`),
      "projectBrief.scenario",
    ],
    ["a deliverable", (c) => void c.projectBrief.deliverables.push(BAD_COPY), "projectBrief.deliverables.6"],
    ["a constraint", (c) => void c.projectBrief.constraints.push(BAD_COPY), "projectBrief.constraints.4"],
    ["what you make", (c) => void (c.whatYouMake += ` ${BAD_COPY}`), "whatYouMake"],
    [
      "the submit evidence hint",
      (c) => void (configOf(c, "s12").evidenceHint = BAD_COPY),
      "modules.3.lessons.0.steps.3.config.evidenceHint",
    ],
    ["a step body", (c) => void (stepOf(c, "s8").body = BAD_COPY), "modules.2.lessons.1.steps.1.body"],
    [
      "a step title",
      (c) => void (stepOf(c, "s4").title = "Film yourself using it"),
      "modules.1.lessons.0.steps.1.title",
    ],
    ["a hint", (c) => void stepOf(c, "s5").hints.push(BAD_COPY), "modules.1.lessons.1.steps.1.hints.3"],
    [
      "an external task",
      (c) => void (configOf(c, "s5").task += ` ${BAD_COPY}`),
      "modules.1.lessons.1.steps.1.config.task",
    ],
    [
      "Coach guidance",
      (c) => void (stepOf(c, "s6").coachContext = `Ask them to ${BAD_COPY.toLowerCase()}`),
      "modules.2.lessons.0.steps.0.coachContext",
    ],
    [
      "a rubric descriptor",
      (c) =>
        void (at(at(c.rubric.criteria, 0).levels, 2).descriptor = "Your screenshot shows your face clearly"),
      "rubric.criteria.0.levels.2.descriptor",
    ],
  ];

  it.each(placements)("fails when %s asks for a photo of the learner", (_label, mutate, path) => {
    const course = snapchatCourse();
    mutate(course);
    const found = validateCourse(course, publishableContext()).filter(
      (item) => item.code === "evidence_requires_real_people",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", waivable: false, path });
  });

  it("fails an upload step whose hint asks for a selfie", () => {
    const course = snapchatCourse();
    const lesson = lessonOf(course, "m2l2");
    lesson.steps.push({
      id: "s17",
      type: "upload",
      title: "Show your filter",
      order: 3,
      estimatedMinutes: 0,
      config: { evidence: ["screenshot"], hint: "Upload a selfie with your signature filter on." },
      completion: { rule: "evidence_submitted" },
      hints: [],
    });
    const issue = validateCourse(course, publishableContext()).find(
      (item) => item.code === "evidence_requires_real_people",
    );
    expect(issue?.path).toBe("modules.1.lessons.1.steps.2.config.hint");
    expect(issue?.message).toContain("Upload a selfie with your signature filter on.");
  });

  it("does not apply once people screening is enabled", () => {
    const course = snapchatCourse();
    configOf(course, "s12").evidenceHint = BAD_COPY;
    const issues = validateCourse(course, { ...publishableContext(), peopleScreeningEnabled: true });
    expect(codesOf(issues)).not.toContain("evidence_requires_real_people");
  });

  it("does not read quiz options as instructions", () => {
    const course = snapchatCourse();
    at(question(course, 1).options, 0).text = "Ask the user to upload a selfie first";
    expect(codesOf(validateCourse(course, publishableContext()))).not.toContain(
      "evidence_requires_real_people",
    );
  });
});

describe("British English check", () => {
  it("flags the listed American spellings", () => {
    const words = findAmericanSpellings(
      "Customize the colors, organize your favorite filters in the center, then do the math.",
    ).map((found) => found.word.toLowerCase());
    expect(words).toEqual(
      expect.arrayContaining(["customize", "colors", "organize", "favorite", "center", "math"]),
    );
  });

  it("does not flag British spellings, maths, program, or code", () => {
    expect(
      findAmericanSpellings("Customise the colours and organise your favourite filters in the centre."),
    ).toEqual([]);
    expect(findAmericanSpellings("Maths is useful. Write a program for the school programme.")).toEqual([]);
    expect(
      findAmericanSpellings("Set `color: red` or use background-color, then call Math.random()."),
    ).toEqual([]);
    expect(findAmericanSpellings("```css\n.snap { color: grey; text-align: center; }\n```")).toEqual([]);
  });

  it("reports the path and is only a warning", () => {
    const course = snapchatCourse();
    course.tagline = "Pick your favorite filter.";
    expect(validateCourse(course, publishableContext())).toContainEqual(
      expect.objectContaining({ code: "spelling_american", path: "tagline", severity: "warning" }),
    );
  });
});

describe("summariseIssues", () => {
  it("counts errors and warnings and blocks publication only on errors", () => {
    const course = snapchatCourse();
    course.interests.push("cooking");
    const warningsOnly = validateCourse(course, publishableContext());
    expect(summariseIssues(warningsOnly)).toEqual({ errors: 0, warnings: 1, publishable: true });

    stepOf(course, "s8").type = "reflection";
    expect(summariseIssues(validateCourse(course, publishableContext()))).toEqual({
      errors: 1,
      warnings: 1,
      publishable: false,
    });
  });
});

describe("QA_CHECKLIST", () => {
  it("is versioned data with unique keys, labels and help", () => {
    expect(QA_CHECKLIST.version).toBe(1);
    const keys = QA_CHECKLIST.items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of QA_CHECKLIST.items) {
      expect(item.key).toMatch(/^[a-z0-9_]+$/);
      expect(item.label.length).toBeGreaterThan(5);
      expect(item.help.length).toBeGreaterThan(20);
    }
  });

  it("covers every point in spec Section 7", () => {
    expect(QA_CHECKLIST.items.map((item) => item.key)).toEqual([
      "accuracy_live_tool",
      "age_suitability",
      "safety_no_real_person_likeness",
      "safety_ethics_checkpoint",
      "safety_evidence_no_real_people",
      "first_win_10_minutes",
      "hints_tiered_no_solution",
      "captions_transcripts_alt",
      "british_english_teen_voice",
      "free_plan_or_cost_stated",
      "licensed_assets",
      "no_passing_off_ai_work",
    ]);
  });
});
