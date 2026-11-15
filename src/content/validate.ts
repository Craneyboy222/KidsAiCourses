/**
 * Semantic validation of a course (spec Section 6, "Validation (on save and
 * on submit-for-review)").
 *
 * `courseSchema` checks shape; `validateCourse` checks meaning. It never
 * throws and never changes its input. Each rule has a stable `code` listed in
 * `VALIDATION_RULES`, which is also where a rule's severity lives and whether
 * a reviewer may waive it.
 *
 * Errors stop a course being approved or published. Warnings are shown to
 * the editor and reviewer but do not block.
 */
import {
  collectText,
  flattenSteps,
  lessonPath,
  lessonStepMinutes,
  modulePath,
  type FlatStep,
} from "./course-utils";
import { findRealPeopleRequirements } from "./people-evidence";
import {
  INTEREST_TAGS,
  REQUIRED_SETUP_GUIDE_KINDS,
  RUBRIC_LEVEL_LABELS,
  STEP_TYPES,
  safeParseStepConfig,
  type CompletionRule,
  type Course,
  type SetupGuide,
  type SetupGuideStepKind,
  type StepType,
  type Under18Policy,
} from "./schema";

// ───────────────────────────── Types ─────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  /** Stable rule id from `VALIDATION_RULES`. */
  code: string;
  severity: ValidationSeverity;
  /** Dotted path to the content, in the form `applyPatch` accepts: `modules.1.lessons.0.steps.2.hints.0`. */
  path: string;
  /** Plain English for the editor: what is wrong and what to do. */
  message: string;
  /** True if a reviewer may record an explicit waiver for this issue. */
  waivable: boolean;
  /** For a waivable issue: the string to add to `context.waivers` once a reviewer has agreed. */
  waiverKey?: string;
}

export interface ValidationContext {
  /** Tool Register facts by slug. A tool that is not here is unknown to the Register. */
  tools: Record<string, { under18Policy: Under18Policy | null; status: string }>;
  /** Known assets by id. */
  assets: Record<string, { kind: string; altText?: string }>;
  /**
   * True only when a specialist CSAM hash-matching provider is approved and
   * enabled (decision D3). While false, the real-people rule applies.
   */
  peopleScreeningEnabled: boolean;
  /** Reviewed waivers, for example `setup_guide:replit`. */
  waivers?: string[];
}

interface RuleMeta {
  severity: ValidationSeverity;
  waivable: boolean;
  meaning: string;
}

/** The Tool Register status that lets a tool be used in a live course. */
export const APPROVED_TOOL_STATUS = "approved";

/** `setup_guide:<toolSlug>`: the one waiver the validator accepts (spec Section 6). */
export const setupGuideWaiverKey = (toolSlug: string): string => `setup_guide:${toolSlug}`;

/**
 * Every rule, with its severity and a one-line meaning.
 *
 * Only the two setup-guide rules are waivable. The spec names that waiver
 * ("or an explicit reviewed waiver") and no other. Every other error guards
 * either a child-safety rule or the integrity of the course data, so a
 * reviewer fixes the content instead of waiving the check.
 */
export const VALIDATION_RULES = {
  // Structure
  submit_step_count: {
    severity: "error",
    waivable: false,
    meaning: "The course does not have exactly one submit step.",
  },
  submit_step_position: {
    severity: "error",
    waivable: false,
    meaning: "The submit step is not in the last lesson of the last module.",
  },
  submit_step_not_last: {
    severity: "warning",
    waivable: false,
    meaning: "The submit step is not the final step of its lesson.",
  },
  ethics_checkpoint_missing: {
    severity: "error",
    waivable: false,
    meaning: "The course has no ethics checkpoint step.",
  },
  module_checkpoint_missing: {
    severity: "error",
    waivable: false,
    meaning: "A module has no checkpoint step.",
  },
  module_count: {
    severity: "warning",
    waivable: false,
    meaning: "The course has fewer than 3 or more than 5 modules.",
  },
  step_type_forbidden: {
    severity: "error",
    waivable: false,
    meaning:
      "A step has a type outside the launch set (for example one that runs code, previews an app or generates media).",
  },
  step_config_invalid: {
    severity: "error",
    waivable: false,
    meaning: "A step's config does not fit its step type.",
  },
  forbidden_config_key: {
    severity: "error",
    waivable: false,
    meaning:
      "A step's config asks the platform to run learner code, preview an app or generate project media.",
  },
  completion_rule_mismatch: {
    severity: "warning",
    waivable: false,
    meaning: "A step's completion rule does not suit its step type.",
  },
  // Tools and setup guides
  setup_guide_missing: { severity: "error", waivable: true, meaning: "A required tool has no setup guide." },
  setup_guide_incomplete: {
    severity: "error",
    waivable: true,
    meaning:
      "A required tool's setup guide does not cover account creation, email verification, the free plan and privacy settings.",
  },
  setup_guide_waived: {
    severity: "warning",
    waivable: false,
    meaning: "The setup-guide rule was skipped for a tool because a reviewed waiver is recorded.",
  },
  setup_guide_cost_stated: {
    severity: "warning",
    waivable: false,
    meaning:
      "A guide has no free-plan step and states a cost instead; check that it says clearly what a parent would pay.",
  },
  setup_guide_orphan: {
    severity: "warning",
    waivable: false,
    meaning: "A setup guide is for a tool the course does not list.",
  },
  step_tool_missing: {
    severity: "error",
    waivable: false,
    meaning:
      "A setup-guide or external-task step names a tool that is not in the course's tool requirements.",
  },
  step_guide_missing: {
    severity: "error",
    waivable: false,
    meaning: "A setup-guide step points at a guide that does not exist.",
  },
  step_guide_tool_mismatch: {
    severity: "error",
    waivable: false,
    meaning: "A setup-guide step's tool differs from the tool its guide is written for.",
  },
  step_guide_step_missing: {
    severity: "error",
    waivable: false,
    meaning: "A setup-guide step lists a guide step id that the guide does not have.",
  },
  external_task_no_instructions: {
    severity: "error",
    waivable: false,
    meaning:
      "An external-task step has no step-by-step instructions (a full task description or a click path).",
  },
  tool_unknown: {
    severity: "error",
    waivable: false,
    meaning: "A required tool is not in the Tool Register and there is no approved fallback.",
  },
  tool_policy_unverified: {
    severity: "error",
    waivable: false,
    meaning: "A required tool has no under-18 policy recorded yet and there is no approved fallback.",
  },
  tool_blocked: {
    severity: "error",
    waivable: false,
    meaning: "A required tool is blocked for under-18s and there is no approved fallback.",
  },
  tool_not_approved: {
    severity: "error",
    waivable: false,
    meaning:
      "A required tool has a policy but has not been approved in the Tool Register, and there is no approved fallback.",
  },
  tool_fallback_in_use: {
    severity: "warning",
    waivable: false,
    meaning: "A required tool cannot be used, so the course depends on its fallback tool.",
  },
  tool_parent_approval_required: {
    severity: "warning",
    waivable: false,
    meaning: "A tool needs parent consent or a parent-operated account, so parent approval gates Start.",
  },
  tool_optional_unavailable: {
    severity: "warning",
    waivable: false,
    meaning: "An optional tool is blocked, unverified or not in the Tool Register.",
  },
  // Assets
  asset_missing: {
    severity: "error",
    waivable: false,
    meaning: "The course refers to an asset id that is not in the asset list.",
  },
  video_missing_video: { severity: "error", waivable: false, meaning: "A video step has no video asset." },
  video_missing_captions: {
    severity: "error",
    waivable: false,
    meaning: "A video has no captions (captions_vtt) asset.",
  },
  video_missing_transcript: {
    severity: "error",
    waivable: false,
    meaning: "A video has no transcript (transcript_md) asset.",
  },
  trailer_missing_captions: {
    severity: "error",
    waivable: false,
    meaning: "The trailer's captions asset is not a captions file.",
  },
  trailer_wrong_kind: {
    severity: "error",
    waivable: false,
    meaning: "The trailer video or poster points at an asset of the wrong kind.",
  },
  image_missing_alt: {
    severity: "error",
    waivable: false,
    meaning: "An image or guide screenshot has no alt text.",
  },
  // Quizzes
  quiz_missing: {
    severity: "error",
    waivable: false,
    meaning: "A quiz step points at a quiz that does not exist.",
  },
  quiz_no_correct_option: {
    severity: "error",
    waivable: false,
    meaning: "A quiz question has no correct option.",
  },
  quiz_single_correct_count: {
    severity: "error",
    waivable: false,
    meaning: "A single-choice question has more than one correct option.",
  },
  quiz_too_few_options: {
    severity: "error",
    waivable: false,
    meaning: "A quiz question has fewer than two options.",
  },
  quiz_option_feedback_missing: {
    severity: "error",
    waivable: false,
    meaning: "A quiz option has no feedback.",
  },
  quiz_pass_mark_range: {
    severity: "error",
    waivable: false,
    meaning: "A quiz pass mark is not between 0 and 1.",
  },
  quiz_threshold_mismatch: {
    severity: "warning",
    waivable: false,
    meaning: "A quiz step's completion threshold differs from the quiz's pass mark.",
  },
  quiz_unused: { severity: "warning", waivable: false, meaning: "A quiz is not used by any step." },
  // Hints
  hint_contains_solution: {
    severity: "error",
    waivable: false,
    meaning:
      "A hint gives away the step's solution (a long code block, a lot of code, or text copied from the reference solution).",
  },
  // Safety
  evidence_requires_real_people: {
    severity: "error",
    waivable: false,
    meaning:
      "Course copy asks the learner for images or video of real people while people screening is not enabled.",
  },
  // Consistency
  duplicate_id: { severity: "error", waivable: false, meaning: "Two items of the same kind share an id." },
  order_not_increasing: {
    severity: "warning",
    waivable: false,
    meaning: "`order` values do not increase in the order the items are listed.",
  },
  minutes_course_mismatch: {
    severity: "warning",
    waivable: false,
    meaning: "The course's minutes differ from the sum of its lessons.",
  },
  minutes_lesson_mismatch: {
    severity: "warning",
    waivable: false,
    meaning: "A lesson's minutes differ from the sum of its steps.",
  },
  submit_brief_mismatch: {
    severity: "warning",
    waivable: false,
    meaning: "A submit or upload step accepts evidence or artefact types the project brief does not declare.",
  },
  interest_unknown: {
    severity: "warning",
    waivable: false,
    meaning: "An interest is not one of the 16 interest tags, so it will not drive recommendations.",
  },
  rubric_levels_incomplete: {
    severity: "warning",
    waivable: false,
    meaning:
      "A rubric criterion does not have exactly the three levels Not yet, Getting there and Nailed it.",
  },
  // Language
  spelling_american: {
    severity: "warning",
    waivable: false,
    meaning: "Learner-facing text uses an American spelling.",
  },
} as const satisfies Record<string, RuleMeta>;

export type ValidationCode = keyof typeof VALIDATION_RULES;

function issue(code: ValidationCode, path: string, message: string, waiverKey?: string): ValidationIssue {
  const rule: RuleMeta = VALIDATION_RULES[code];
  return {
    code,
    severity: rule.severity,
    path,
    message,
    waivable: rule.waivable,
    ...(rule.waivable && waiverKey !== undefined ? { waiverKey } : {}),
  };
}

// ───────────────────────────── Small helpers ─────────────────────────────

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

const quote = (text: string, max = 160): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function findDuplicates(items: ReadonlyArray<{ id: string; path: string }>, kind: string): ValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const item of items) {
    const first = seen.get(item.id);
    if (first === undefined) {
      seen.set(item.id, item.path);
    } else {
      issues.push(
        issue(
          "duplicate_id",
          item.path,
          `The ${kind} id "${item.id}" is already used at ${first}. Give each ${kind} its own id.`,
        ),
      );
    }
  }
  return issues;
}

function checkOrder(items: ReadonlyArray<{ order: number; path: string }>, kind: string): ValidationIssue[] {
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (previous && current && current.order <= previous.order) {
      return [
        issue(
          "order_not_increasing",
          `${current.path}.order`,
          `This ${kind} has order ${current.order} but the one before it has ${previous.order}. Number them upwards in the order they are listed.`,
        ),
      ];
    }
  }
  return [];
}

// ───────────────────────────── Tools ─────────────────────────────

type ToolProblem = "tool_unknown" | "tool_policy_unverified" | "tool_blocked" | "tool_not_approved";

type ToolState =
  | { usable: true; policy: Exclude<Under18Policy, "blocked"> }
  | { usable: false; code: ToolProblem; reason: string };

function toolState(slug: string, context: ValidationContext): ToolState {
  const tool = Object.hasOwn(context.tools, slug) ? context.tools[slug] : undefined;
  if (!tool) return { usable: false, code: "tool_unknown", reason: "is not in the Tool Register" };
  if (tool.under18Policy === null) {
    return { usable: false, code: "tool_policy_unverified", reason: "has no under-18 policy recorded yet" };
  }
  if (tool.under18Policy === "blocked") {
    return { usable: false, code: "tool_blocked", reason: "is blocked for under-18s" };
  }
  if (tool.status !== APPROVED_TOOL_STATUS) {
    return {
      usable: false,
      code: "tool_not_approved",
      reason: `has not been approved in the Tool Register (status: ${tool.status})`,
    };
  }
  return { usable: true, policy: tool.under18Policy };
}

function parentApprovalWarning(slug: string, policy: Under18Policy, path: string): ValidationIssue[] {
  if (policy === "parent_consent_required") {
    return [
      issue(
        "tool_parent_approval_required",
        path,
        `"${slug}" needs parent consent. A learner cannot start this course until a parent has approved the tool.`,
      ),
    ];
  }
  if (policy === "parent_operated") {
    return [
      issue(
        "tool_parent_approval_required",
        path,
        `"${slug}" must be set up and run by a parent. A learner cannot start this course until a parent has approved the tool, and the setup guide must be written for the parent.`,
      ),
    ];
  }
  return [];
}

/** True when the guide tells the family what a paid plan would cost (spec 3.3). */
function guideStatesCost(guide: SetupGuide): boolean {
  return guide.steps.some(
    (step) =>
      /£\s?\d/.test(step.body) ||
      /\b(?:a|your)\s+parent(?:\s+or\s+carer)?\b[^.]*\b(?:pay|pays|paying|cost|costs|buy|buys|subscription)\b/i.test(
        step.body,
      ),
  );
}

const KIND_LABELS: Record<(typeof REQUIRED_SETUP_GUIDE_KINDS)[number], string> = {
  create_account: "account creation",
  verify_email: "email verification",
  choose_free_plan: "choosing the free plan (or stating the cost)",
  privacy_settings: "privacy settings",
};

function checkTools(course: Course, context: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const waivers = new Set(context.waivers ?? []);
  /** Tools a learner will really use: required tools, plus a fallback the course depends on. */
  const needGuide: Array<{ slug: string; path: string }> = [];

  issues.push(
    ...findDuplicates(
      course.toolRequirements.map((tool, index) => ({
        id: tool.toolSlug,
        path: `toolRequirements.${index}.toolSlug`,
      })),
      "tool requirement",
    ),
  );

  course.toolRequirements.forEach((requirement, index) => {
    const path = `toolRequirements.${index}`;
    const primary = toolState(requirement.toolSlug, context);

    if (!requirement.required) {
      if (!primary.usable) {
        issues.push(
          issue(
            "tool_optional_unavailable",
            `${path}.toolSlug`,
            `The optional tool "${requirement.toolSlug}" ${primary.reason}. Learners will not be able to use it.`,
          ),
        );
      }
      return;
    }

    needGuide.push({ slug: requirement.toolSlug, path });

    if (primary.usable) {
      issues.push(...parentApprovalWarning(requirement.toolSlug, primary.policy, `${path}.toolSlug`));
      return;
    }

    const fallbackSlug =
      requirement.fallbackToolSlug !== undefined && requirement.fallbackToolSlug !== requirement.toolSlug
        ? requirement.fallbackToolSlug
        : undefined;
    const fallback = fallbackSlug === undefined ? undefined : toolState(fallbackSlug, context);

    if (fallbackSlug !== undefined && fallback?.usable) {
      issues.push(
        issue(
          "tool_fallback_in_use",
          `${path}.fallbackToolSlug`,
          `"${requirement.toolSlug}" ${primary.reason}, so the course depends on the fallback "${fallbackSlug}". Check that the steps and the setup guide work in "${fallbackSlug}".`,
        ),
      );
      issues.push(...parentApprovalWarning(fallbackSlug, fallback.policy, `${path}.fallbackToolSlug`));
      needGuide.push({ slug: fallbackSlug, path });
      return;
    }

    const fallbackNote =
      fallbackSlug === undefined
        ? "There is no fallback tool."
        : `The fallback "${fallbackSlug}" ${fallback && !fallback.usable ? fallback.reason : "cannot be used"}.`;
    issues.push(
      issue(
        primary.code,
        `${path}.toolSlug`,
        `The required tool "${requirement.toolSlug}" ${primary.reason}. ${fallbackNote} The course cannot be published until the tool is approved for under-18s or an approved fallback is named.`,
      ),
    );
  });

  // Setup guides (spec 3.3): every tool a learner must use needs a complete guide, or a reviewed waiver.
  const checked = new Set<string>();
  for (const { slug, path } of needGuide) {
    if (checked.has(slug)) continue;
    checked.add(slug);
    const waiverKey = setupGuideWaiverKey(slug);
    const guides = course.setupGuides
      .map((guide, index) => ({ guide, index }))
      .filter((entry) => entry.guide.toolSlug === slug);
    const kinds = new Set<SetupGuideStepKind>(
      guides.flatMap((entry) => entry.guide.steps.map((step) => step.kind)),
    );
    const costStated = guides.some((entry) => guideStatesCost(entry.guide));
    const missing = REQUIRED_SETUP_GUIDE_KINDS.filter(
      (kind) => !kinds.has(kind) && !(kind === "choose_free_plan" && costStated),
    );
    const firstGuide = guides[0];

    if (firstGuide === undefined || missing.length > 0) {
      if (waivers.has(waiverKey)) {
        issues.push(
          issue(
            "setup_guide_waived",
            path,
            `The setup-guide rule for "${slug}" was skipped because the reviewed waiver "${waiverKey}" is recorded.`,
          ),
        );
      } else if (firstGuide === undefined) {
        issues.push(
          issue(
            "setup_guide_missing",
            path,
            `The required tool "${slug}" has no setup guide. Add one that covers account creation, email verification, the free plan and privacy settings, or record a reviewed waiver.`,
            waiverKey,
          ),
        );
      } else {
        issues.push(
          issue(
            "setup_guide_incomplete",
            `setupGuides.${firstGuide.index}`,
            `The setup guide for "${slug}" does not cover ${missing.map((kind) => KIND_LABELS[kind]).join(", ")}. Add the missing steps, or record a reviewed waiver.`,
            waiverKey,
          ),
        );
      }
    } else if (!kinds.has("choose_free_plan") && costStated) {
      issues.push(
        issue(
          "setup_guide_cost_stated",
          `setupGuides.${firstGuide.index}`,
          `The setup guide for "${slug}" has no free-plan step and states a cost instead. Check that it says clearly what a parent would pay.`,
        ),
      );
    }
  }

  const listed = new Set(course.toolRequirements.flatMap((tool) => [tool.toolSlug, tool.fallbackToolSlug]));
  course.setupGuides.forEach((guide, index) => {
    if (!listed.has(guide.toolSlug)) {
      issues.push(
        issue(
          "setup_guide_orphan",
          `setupGuides.${index}.toolSlug`,
          `This guide is for "${guide.toolSlug}", which is not in the course's tool requirements.`,
        ),
      );
    }
  });

  return issues;
}

// ───────────────────────────── Hints ─────────────────────────────

const MAX_FENCED_LINES = 3;
const MAX_CODE_CHARS = 400;
const MAX_SOLUTION_CHARS = 20_000;

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A line that reads as code rather than prose. Deliberately strict, so "Let the user choose…" is not counted. */
const CODE_LINE = new RegExp(
  [
    "[;{}]\\s*$",
    "=>",
    "\\)\\s*\\{",
    "^\\s*(?:const|let|var)\\s+[\\w$]+\\s*=",
    "^\\s*function\\s*[\\w$]*\\s*\\(",
    "^\\s*(?:if|for|while)\\s*\\(.*\\)\\s*\\{?\\s*$",
    "^\\s*import\\s.+\\sfrom\\s",
    "^\\s*def\\s+\\w+\\(",
    "^\\s*<\\/?[a-z][^>]*>",
    "^\\s*[.#]?[\\w-]+\\s*\\{",
    "^\\s*[\\w-]+\\s*:\\s*[^;]+;",
  ].join("|"),
);

/** Why a hint gives too much away, or `null` if it is fine. */
export function hintLeak(hint: string, referenceSolution?: string): string | null {
  const fenced = [...hint.matchAll(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g)].map((match) => match[1] ?? "");
  for (const block of fenced) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0).length;
    if (lines > MAX_FENCED_LINES) {
      return `it contains a code block of ${lines} lines (the limit is ${MAX_FENCED_LINES})`;
    }
  }

  const outsideFences = hint.replace(/```[\s\S]*?(?:```|$)/g, "\n");
  const inline = [...outsideFences.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
  const codeLines = outsideFences
    .replace(/`[^`\n]+`/g, " ")
    .split("\n")
    .filter((line) => CODE_LINE.test(line));
  const codeChars = [...fenced, ...inline, ...codeLines].reduce((sum, part) => sum + part.trim().length, 0);
  if (codeChars > MAX_CODE_CHARS) {
    return `it contains about ${codeChars} characters of code (the limit is ${MAX_CODE_CHARS})`;
  }

  if (referenceSolution !== undefined) {
    // Compare against the start of a very long solution only, to keep the check quick.
    const solution = squash(referenceSolution).slice(0, MAX_SOLUTION_CHARS);
    const flatHint = squash(hint.replace(/```[^\n]*/g, " "));
    if (solution.length >= 20) {
      const window = Math.min(60, Math.max(20, Math.ceil(solution.length / 2)));
      for (let start = 0; start + window <= solution.length; start += 1) {
        if (flatHint.includes(solution.slice(start, start + window))) {
          return "it repeats part of the step's reference solution";
        }
      }
      const lines = referenceSolution
        .split("\n")
        .map(squash)
        .filter((line) => line.length >= 15);
      const copied = lines.filter((line) => flatHint.includes(line)).length;
      if (lines.length >= 2 && copied >= Math.max(2, Math.ceil(lines.length / 2))) {
        return "it repeats several lines of the step's reference solution";
      }
    }
  }
  return null;
}

// ───────────────────────────── Steps ─────────────────────────────

/** Config keys that would mean running learner code, previewing an app or generating media on our servers. */
const FORBIDDEN_CONFIG_KEYS = new Set([
  "sandbox",
  "runcode",
  "executecode",
  "coderunner",
  "codesandbox",
  "preview",
  "apppreview",
  "livepreview",
  "iframe",
  "embedapp",
  "generatemedia",
  "mediagenerator",
  "generateimage",
  "generatevideo",
  "generateaudio",
]);

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

function forbiddenKeys(value: unknown, path: string, found: Array<{ key: string; path: string }>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenKeys(item, `${path}.${index}`, found));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_CONFIG_KEYS.has(normaliseKey(key))) found.push({ key, path: `${path}.${key}` });
      forbiddenKeys(item, `${path}.${key}`, found);
    }
  }
}

const COMPLETION_RULES_BY_TYPE: Record<StepType, readonly CompletionRule[]> = {
  video: ["view"],
  read: ["view", "self_tick"],
  setup_guide: ["setup_acknowledged"],
  external_task: ["self_tick"],
  upload: ["upload_approved", "evidence_submitted"],
  quiz: ["quiz_pass"],
  ethics_checkpoint: ["self_tick", "view"],
  reflection: ["self_tick", "view"],
  checkpoint: ["view", "self_tick"],
  submit: ["submit"],
};

const MIN_TASK_CHARS = 40;
const MIN_TASK_WORDS = 6;
const MIN_CLICKS = 2;

const isStepType = (type: string): type is StepType => (STEP_TYPES as readonly string[]).includes(type);

function checkSteps(course: Course, context: ValidationContext, steps: FlatStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const toolSlugs = new Set(
    course.toolRequirements.flatMap((tool) =>
      tool.fallbackToolSlug === undefined ? [tool.toolSlug] : [tool.toolSlug, tool.fallbackToolSlug],
    ),
  );
  const guidesById = new Map(course.setupGuides.map((guide) => [guide.id, guide]));
  const quizzesById = new Map(course.quizzes.map((quiz) => [quiz.id, quiz]));
  const usedQuizIds = new Set<string>();

  for (const { step, path } of steps) {
    const stepType: string = step.type;
    if (!isStepType(stepType)) {
      issues.push(
        issue(
          "step_type_forbidden",
          `${path}.type`,
          `"${stepType}" is not a step type. Learners build in external tools: the platform does not run code, preview apps or generate project media.`,
        ),
      );
      continue;
    }

    const forbidden: Array<{ key: string; path: string }> = [];
    forbiddenKeys(step.config, `${path}.config`, forbidden);
    for (const entry of forbidden) {
      issues.push(
        issue(
          "forbidden_config_key",
          entry.path,
          `The config key "${entry.key}" is not allowed. The platform does not run learner code, preview apps or generate project media; that work happens in the external tool.`,
        ),
      );
    }

    const allowedRules = COMPLETION_RULES_BY_TYPE[stepType];
    if (!allowedRules.includes(step.completion.rule)) {
      issues.push(
        issue(
          "completion_rule_mismatch",
          `${path}.completion.rule`,
          `A ${stepType} step normally completes with ${allowedRules.map((rule) => `"${rule}"`).join(" or ")}, not "${step.completion.rule}".`,
        ),
      );
    }

    const parsed = safeParseStepConfig(step);
    if (!parsed.success) {
      for (const zodIssue of parsed.error.issues) {
        const suffix = zodIssue.path.map(String).join(".");
        issues.push(
          issue(
            "step_config_invalid",
            suffix ? `${path}.config.${suffix}` : `${path}.config`,
            `The config for this ${stepType} step is not valid: ${zodIssue.message}`,
          ),
        );
      }
    } else {
      const config = parsed.data;
      const checkTool = (toolSlug: string): void => {
        if (!toolSlugs.has(toolSlug)) {
          issues.push(
            issue(
              "step_tool_missing",
              `${path}.config.toolSlug`,
              `This step uses "${toolSlug}", which is not in the course's tool requirements. Add it to Tools you'll need, or change the step.`,
            ),
          );
        }
      };

      switch (config.type) {
        case "setup_guide": {
          checkTool(config.config.toolSlug);
          const guide = guidesById.get(config.config.guideId);
          if (!guide) {
            issues.push(
              issue(
                "step_guide_missing",
                `${path}.config.guideId`,
                `There is no setup guide with the id "${config.config.guideId}".`,
              ),
            );
            break;
          }
          if (guide.toolSlug !== config.config.toolSlug) {
            issues.push(
              issue(
                "step_guide_tool_mismatch",
                `${path}.config.guideId`,
                `This step is for "${config.config.toolSlug}" but the guide "${guide.id}" is written for "${guide.toolSlug}".`,
              ),
            );
          }
          const guideStepIds = new Set(guide.steps.map((guideStep) => guideStep.id));
          config.config.throughStepIds.forEach((id, index) => {
            if (!guideStepIds.has(id)) {
              issues.push(
                issue(
                  "step_guide_step_missing",
                  `${path}.config.throughStepIds.${index}`,
                  `The guide "${guide.id}" has no step with the id "${id}".`,
                ),
              );
            }
          });
          break;
        }
        case "external_task": {
          checkTool(config.config.toolSlug);
          const task = config.config.task.trim();
          const enoughTask = task.length >= MIN_TASK_CHARS && task.split(/\s+/).length >= MIN_TASK_WORDS;
          const enoughClicks = (config.config.clicks?.length ?? 0) >= MIN_CLICKS;
          if (!enoughTask && !enoughClicks) {
            issues.push(
              issue(
                "external_task_no_instructions",
                `${path}.config.task`,
                `Tell the learner what to do in the tool, step by step: write a task of at least ${MIN_TASK_CHARS} characters, or list the clicks in order.`,
              ),
            );
          }
          break;
        }
        case "quiz": {
          usedQuizIds.add(config.config.quizId);
          const quiz = quizzesById.get(config.config.quizId);
          if (!quiz) {
            issues.push(
              issue(
                "quiz_missing",
                `${path}.config.quizId`,
                `There is no quiz with the id "${config.config.quizId}".`,
              ),
            );
            break;
          }
          const threshold = step.completion.threshold;
          if (
            step.completion.rule === "quiz_pass" &&
            threshold !== undefined &&
            Math.abs(threshold - quiz.passMark) > 1e-9
          ) {
            issues.push(
              issue(
                "quiz_threshold_mismatch",
                `${path}.completion.threshold`,
                `This step passes at ${threshold} but the quiz "${quiz.id}" has a pass mark of ${quiz.passMark}. Make them the same.`,
              ),
            );
          }
          break;
        }
        case "upload":
        case "submit": {
          const undeclaredEvidence = config.config.evidence.filter(
            (type) => !course.projectBrief.evidence.includes(type),
          );
          if (undeclaredEvidence.length > 0) {
            issues.push(
              issue(
                "submit_brief_mismatch",
                `${path}.config.evidence`,
                `This step accepts ${undeclaredEvidence.join(", ")} evidence, which the project brief does not declare.`,
              ),
            );
          }
          if (config.type === "submit") {
            const undeclaredArtefacts = config.config.artefactTypes.filter(
              (type) => !course.projectBrief.artefactTypes.includes(type),
            );
            if (undeclaredArtefacts.length > 0) {
              issues.push(
                issue(
                  "submit_brief_mismatch",
                  `${path}.config.artefactTypes`,
                  `This step accepts ${undeclaredArtefacts.join(", ")} artefacts, which the project brief does not declare.`,
                ),
              );
            }
          }
          break;
        }
        default:
          break;
      }
    }

    // Hints must nudge, not hand over the answer (spec 3.2 and 3.5).
    const referenceSolution =
      typeof step.config?.referenceSolution === "string" ? step.config.referenceSolution : undefined;
    (step.hints ?? []).forEach((hint, index) => {
      const reason = hintLeak(hint, referenceSolution);
      if (reason !== null) {
        issues.push(
          issue(
            "hint_contains_solution",
            `${path}.hints.${index}`,
            `This hint gives too much away: ${reason}. Point the learner in the right direction instead of showing the answer.`,
          ),
        );
      }
    });
  }

  course.quizzes.forEach((quiz, index) => {
    if (!usedQuizIds.has(quiz.id)) {
      issues.push(issue("quiz_unused", `quizzes.${index}`, `The quiz "${quiz.id}" is not used by any step.`));
    }
  });

  return issues;
}

// ───────────────────────────── Structure ─────────────────────────────

const MIN_MODULES = 3;
const MAX_MODULES = 5;

function checkStructure(course: Course, steps: FlatStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const submits = steps.filter((entry) => entry.step.type === "submit");
  if (submits.length !== 1) {
    issues.push(
      issue(
        "submit_step_count",
        submits[1]?.path ?? "modules",
        submits.length === 0
          ? "The course has no submit step. Add one as the final step of the last lesson."
          : `The course has ${submits.length} submit steps. Keep exactly one, in the last lesson.`,
      ),
    );
  }
  const lastModuleIndex = course.modules.length - 1;
  const lastModule = course.modules[lastModuleIndex];
  const lastLessonIndex = (lastModule?.lessons.length ?? 0) - 1;
  for (const submit of submits) {
    if (submit.moduleIndex !== lastModuleIndex || submit.lessonIndex !== lastLessonIndex) {
      issues.push(
        issue(
          "submit_step_position",
          submit.path,
          "The submit step must be in the last lesson of the last module.",
        ),
      );
    } else if (submit.stepIndex !== submit.lesson.steps.length - 1) {
      issues.push(
        issue(
          "submit_step_not_last",
          submit.path,
          "The submit step is usually the final step. Steps after it may be missed.",
        ),
      );
    }
  }

  if (!steps.some((entry) => entry.step.type === "ethics_checkpoint")) {
    issues.push(
      issue(
        "ethics_checkpoint_missing",
        "modules",
        "Every course needs at least one ethics checkpoint step.",
      ),
    );
  }

  course.modules.forEach((mod, moduleIndex) => {
    const hasCheckpoint = mod.lessons.some((lesson) =>
      lesson.steps.some((step) => step.type === "checkpoint"),
    );
    if (!hasCheckpoint) {
      issues.push(
        issue(
          "module_checkpoint_missing",
          modulePath(moduleIndex),
          `The module "${mod.title}" has no checkpoint step. Add one so learners get a clear win in every module.`,
        ),
      );
    }
  });

  if (course.modules.length < MIN_MODULES || course.modules.length > MAX_MODULES) {
    issues.push(
      issue(
        "module_count",
        "modules",
        `The course has ${plural(course.modules.length, "module")}. Courses normally have ${MIN_MODULES} to ${MAX_MODULES}.`,
      ),
    );
  }

  return issues;
}

// ───────────────────────────── Assets ─────────────────────────────

const IMAGE_KINDS = new Set(["image", "guide_screenshot"]);

function checkAssets(course: Course, context: ValidationContext, steps: FlatStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const missingAlt = new Set<string>();
  const lookup = (id: string): { kind: string; altText?: string } | undefined =>
    Object.hasOwn(context.assets, id) ? context.assets[id] : undefined;

  /** Reports an unknown id, checks alt text, and returns the asset (if known). */
  const resolve = (id: string, path: string): { kind: string; altText?: string } | undefined => {
    const asset = lookup(id);
    if (!asset) {
      issues.push(
        issue(
          "asset_missing",
          path,
          `There is no asset with the id "${id}". Add it to the asset list or fix the id.`,
        ),
      );
      return undefined;
    }
    if (IMAGE_KINDS.has(asset.kind) && !asset.altText?.trim() && !missingAlt.has(id)) {
      missingAlt.add(id);
      issues.push(
        issue(
          "image_missing_alt",
          path,
          `The image "${id}" has no alt text. Describe what it shows for learners who cannot see it.`,
        ),
      );
    }
    return asset;
  };

  const trailerVideo = resolve(course.trailer.assetId, "trailer.assetId");
  if (trailerVideo && trailerVideo.kind !== "video") {
    issues.push(
      issue(
        "trailer_wrong_kind",
        "trailer.assetId",
        `The trailer must be a video, but "${course.trailer.assetId}" is a ${trailerVideo.kind} asset.`,
      ),
    );
  }
  const poster = resolve(course.trailer.posterAssetId, "trailer.posterAssetId");
  if (poster && poster.kind !== "image") {
    issues.push(
      issue(
        "trailer_wrong_kind",
        "trailer.posterAssetId",
        `The trailer poster must be an image, but "${course.trailer.posterAssetId}" is a ${poster.kind} asset.`,
      ),
    );
  }
  const captions = resolve(course.trailer.captionsAssetId, "trailer.captionsAssetId");
  if (captions && captions.kind !== "captions_vtt") {
    issues.push(
      issue(
        "trailer_missing_captions",
        "trailer.captionsAssetId",
        `The trailer needs captions, but "${course.trailer.captionsAssetId}" is a ${captions.kind} asset, not a captions file.`,
      ),
    );
  }

  for (const { step, path } of steps) {
    const kinds = new Set<string>();
    (step.assetIds ?? []).forEach((id, index) => {
      const asset = resolve(id, `${path}.assetIds.${index}`);
      if (asset) kinds.add(asset.kind);
    });
    const assetsPath = `${path}.assetIds`;
    if (step.type === "video" && !kinds.has("video")) {
      issues.push(issue("video_missing_video", assetsPath, "This video step has no video asset."));
    }
    // Captions and a transcript go with every video, whichever step type shows it.
    if (step.type === "video" || kinds.has("video")) {
      if (!kinds.has("captions_vtt")) {
        issues.push(
          issue(
            "video_missing_captions",
            assetsPath,
            "Every video needs captions. Add a captions (VTT) asset to this step.",
          ),
        );
      }
      if (!kinds.has("transcript_md")) {
        issues.push(
          issue(
            "video_missing_transcript",
            assetsPath,
            "Every video needs a transcript. Add a transcript asset to this step.",
          ),
        );
      }
    }
  }

  course.setupGuides.forEach((guide, guideIndex) => {
    guide.steps.forEach((guideStep, stepIndex) => {
      (guideStep.screenshotAssetIds ?? []).forEach((id, index) => {
        resolve(id, `setupGuides.${guideIndex}.steps.${stepIndex}.screenshotAssetIds.${index}`);
      });
    });
  });

  return issues;
}

// ───────────────────────────── Quizzes ─────────────────────────────

function checkQuizzes(course: Course): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  course.quizzes.forEach((quiz, quizIndex) => {
    const quizPath = `quizzes.${quizIndex}`;
    if (!(quiz.passMark >= 0 && quiz.passMark <= 1)) {
      issues.push(
        issue(
          "quiz_pass_mark_range",
          `${quizPath}.passMark`,
          `The pass mark is ${quiz.passMark}. Use a fraction between 0 and 1, for example 0.66 for two out of three.`,
        ),
      );
    }
    quiz.questions.forEach((question, questionIndex) => {
      const questionPath = `${quizPath}.questions.${questionIndex}`;
      if (question.options.length < 2) {
        issues.push(
          issue("quiz_too_few_options", `${questionPath}.options`, "A question needs at least two options."),
        );
      }
      const correct = question.options.filter((option) => option.correct).length;
      if (correct === 0) {
        issues.push(
          issue("quiz_no_correct_option", `${questionPath}.options`, "Mark at least one option as correct."),
        );
      } else if (question.kind === "single" && correct > 1) {
        issues.push(
          issue(
            "quiz_single_correct_count",
            `${questionPath}.options`,
            `A single-choice question needs exactly one correct option, but ${correct} are marked correct. Change the kind to "multi" or keep one.`,
          ),
        );
      }
      question.options.forEach((option, optionIndex) => {
        if (!option.feedback?.trim()) {
          issues.push(
            issue(
              "quiz_option_feedback_missing",
              `${questionPath}.options.${optionIndex}.feedback`,
              "Every option needs feedback, so the learner finds out why an answer is right or wrong.",
            ),
          );
        }
      });
    });
  });
  return issues;
}

// ───────────────────────────── Real people ─────────────────────────────

function checkRealPeople(course: Course, context: ValidationContext): ValidationIssue[] {
  if (context.peopleScreeningEnabled) return [];
  const issues: ValidationIssue[] = [];
  for (const entry of collectText(course)) {
    // Quiz text is not an instruction: a wrong answer may well mention a selfie.
    if (entry.audience === "quiz") continue;
    for (const finding of findRealPeopleRequirements(entry.text)) {
      issues.push(
        issue(
          "evidence_requires_real_people",
          entry.path,
          `This asks for images or video of real people ("${quote(finding.sentence)}"). Until people screening is enabled, ask for a link, or for media of the provided sample image, a cartoon avatar, an object, or illustrated or generated content without real people.`,
        ),
      );
    }
  }
  return issues;
}

// ───────────────────────────── Consistency ─────────────────────────────

function checkConsistency(course: Course, steps: FlatStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(
    ...findDuplicates(
      course.modules.map((mod, i) => ({ id: mod.id, path: `${modulePath(i)}.id` })),
      "module",
    ),
  );
  issues.push(
    ...findDuplicates(
      course.modules.flatMap((mod, mi) =>
        mod.lessons.map((lesson, li) => ({ id: lesson.id, path: `${lessonPath(mi, li)}.id` })),
      ),
      "lesson",
    ),
  );
  issues.push(
    ...findDuplicates(
      steps.map((entry) => ({ id: entry.step.id, path: `${entry.path}.id` })),
      "step",
    ),
  );
  issues.push(
    ...findDuplicates(
      course.quizzes.map((quiz, i) => ({ id: quiz.id, path: `quizzes.${i}.id` })),
      "quiz",
    ),
  );
  course.quizzes.forEach((quiz, qi) => {
    issues.push(
      ...findDuplicates(
        quiz.questions.map((question, i) => ({ id: question.id, path: `quizzes.${qi}.questions.${i}.id` })),
        "question",
      ),
    );
    quiz.questions.forEach((question, i) => {
      issues.push(
        ...findDuplicates(
          question.options.map((option, oi) => ({
            id: option.id,
            path: `quizzes.${qi}.questions.${i}.options.${oi}.id`,
          })),
          "option",
        ),
      );
    });
  });
  issues.push(
    ...findDuplicates(
      course.setupGuides.map((guide, i) => ({ id: guide.id, path: `setupGuides.${i}.id` })),
      "setup guide",
    ),
  );
  course.setupGuides.forEach((guide, gi) => {
    issues.push(
      ...findDuplicates(
        guide.steps.map((step, i) => ({ id: step.id, path: `setupGuides.${gi}.steps.${i}.id` })),
        "guide step",
      ),
    );
    issues.push(
      ...checkOrder(
        guide.steps.map((step, i) => ({ order: step.order, path: `setupGuides.${gi}.steps.${i}` })),
        "guide step",
      ),
    );
  });
  issues.push(
    ...findDuplicates(
      course.rubric.criteria.map((criterion, i) => ({ id: criterion.id, path: `rubric.criteria.${i}.id` })),
      "rubric criterion",
    ),
  );

  issues.push(
    ...checkOrder(
      course.modules.map((mod, i) => ({ order: mod.order, path: modulePath(i) })),
      "module",
    ),
  );
  let lessonMinutes = 0;
  course.modules.forEach((mod, mi) => {
    issues.push(
      ...checkOrder(
        mod.lessons.map((lesson, li) => ({ order: lesson.order, path: lessonPath(mi, li) })),
        "lesson",
      ),
    );
    mod.lessons.forEach((lesson, li) => {
      issues.push(
        ...checkOrder(
          lesson.steps.map((step, si) => ({ order: step.order, path: `${lessonPath(mi, li)}.steps.${si}` })),
          "step",
        ),
      );
      lessonMinutes += lesson.estimatedMinutes;
      const stepMinutes = lessonStepMinutes(lesson);
      if (stepMinutes !== lesson.estimatedMinutes) {
        issues.push(
          issue(
            "minutes_lesson_mismatch",
            `${lessonPath(mi, li)}.estimatedMinutes`,
            `The lesson "${lesson.title}" says ${plural(lesson.estimatedMinutes, "minute")} but its steps add up to ${stepMinutes}.`,
          ),
        );
      }
    });
  });
  if (lessonMinutes !== course.estimatedMinutes) {
    issues.push(
      issue(
        "minutes_course_mismatch",
        "estimatedMinutes",
        `The course says ${plural(course.estimatedMinutes, "minute")} but its lessons add up to ${lessonMinutes}.`,
      ),
    );
  }

  course.interests.forEach((interest, index) => {
    if (!(INTEREST_TAGS as readonly string[]).includes(interest)) {
      issues.push(
        issue(
          "interest_unknown",
          `interests.${index}`,
          `"${interest}" is not one of the interest tags (${INTEREST_TAGS.join(", ")}), so it will not be used for recommendations.`,
        ),
      );
    }
  });

  course.rubric.criteria.forEach((criterion, index) => {
    const labels = criterion.levels.map((level) => level.label);
    const complete =
      labels.length === RUBRIC_LEVEL_LABELS.length &&
      RUBRIC_LEVEL_LABELS.every((label) => labels.includes(label));
    if (!complete) {
      issues.push(
        issue(
          "rubric_levels_incomplete",
          `rubric.criteria.${index}.levels`,
          `The criterion "${criterion.name}" needs one descriptor for each level: ${RUBRIC_LEVEL_LABELS.join(", ")}.`,
        ),
      );
    }
  });

  return issues;
}

// ───────────────────────────── British English ─────────────────────────────

/**
 * A short list of common American spellings. "program" is not here: British
 * English uses it for software, and "programme" for a plan or broadcast.
 */
const AMERICAN_SPELLINGS: ReadonlyArray<{ pattern: RegExp; british: string }> = [
  { pattern: /\bcolor(?:s|ed|ing|ful)?\b/gi, british: "colour" },
  { pattern: /\bcustomiz(?:e|ed|es|ing|ation|ations)\b/gi, british: "customise" },
  { pattern: /\borganiz(?:e|ed|es|ing|er|ers|ation|ations)\b/gi, british: "organise" },
  { pattern: /\bpersonaliz(?:e|ed|es|ing|ation)\b/gi, british: "personalise" },
  { pattern: /\brecogniz(?:e|ed|es|ing)\b/gi, british: "recognise" },
  { pattern: /\brealiz(?:e|ed|es|ing)\b/gi, british: "realise" },
  { pattern: /\banalyz(?:e|ed|es|ing)\b/gi, british: "analyse" },
  { pattern: /\bfavorites?\b/gi, british: "favourite" },
  { pattern: /\bcenter(?:s|ed|ing)?\b/gi, british: "centre" },
  { pattern: /\bmath\b/gi, british: "maths" },
  { pattern: /\bbehaviors?\b/gi, british: "behaviour" },
  { pattern: /\bflavors?\b/gi, british: "flavour" },
  { pattern: /\bneighbors?\b/gi, british: "neighbour" },
  { pattern: /\bgray\b/gi, british: "grey" },
  { pattern: /\bcancel(?:ed|ing)\b/gi, british: "cancelled" },
  { pattern: /\btravel(?:ed|ing|er|ers)\b/gi, british: "travelled" },
  { pattern: /\bmodel(?:ed|ing)\b/gi, british: "modelled" },
  { pattern: /\blabel(?:ed|ing)\b/gi, british: "labelled" },
  { pattern: /\bdefense\b/gi, british: "defence" },
  { pattern: /\bcatalogs?\b/gi, british: "catalogue" },
];

/** Characters next to a word that mark it as code (`background-color`, `Math.random()`, `color:`), not prose. */
const CODE_BEFORE = /[-._#/<=$]$/;
const CODE_AFTER = /^(?:[-_/(:=>]|\.\w)/;

/** American spellings in a piece of prose. Code spans and code blocks are ignored. */
export function findAmericanSpellings(text: string): Array<{ word: string; british: string }> {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
  const found: Array<{ word: string; british: string }> = [];
  const seen = new Set<string>();
  for (const { pattern, british } of AMERICAN_SPELLINGS) {
    for (const match of prose.matchAll(pattern)) {
      const before = prose.slice(0, match.index);
      const after = prose.slice(match.index + match[0].length);
      if (CODE_BEFORE.test(before) || CODE_AFTER.test(after)) continue;
      const key = match[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ word: match[0], british });
    }
  }
  return found;
}

function checkSpelling(course: Course): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of collectText(course)) {
    if (entry.audience === "coach") continue;
    for (const { word, british } of findAmericanSpellings(entry.text)) {
      issues.push(
        issue(
          "spelling_american",
          entry.path,
          `"${word}" is the American spelling. Use British English ("${british}"), unless it is the name of a button or a piece of code.`,
        ),
      );
    }
  }
  return issues;
}

// ───────────────────────────── Public API ─────────────────────────────

/**
 * Checks a course against every content rule and returns the issues found,
 * errors and warnings together, in a stable order. An empty array means the
 * course is clean.
 */
export function validateCourse(course: Course, context: ValidationContext): ValidationIssue[] {
  const steps = flattenSteps(course);
  return [
    ...checkStructure(course, steps),
    ...checkTools(course, context),
    ...checkSteps(course, context, steps),
    ...checkAssets(course, context, steps),
    ...checkQuizzes(course),
    ...checkRealPeople(course, context),
    ...checkConsistency(course, steps),
    ...checkSpelling(course),
  ];
}

export interface ValidationSummary {
  /** Number of errors. */
  errors: number;
  /** Number of warnings. */
  warnings: number;
  /** True when there are no errors. Warnings do not block. */
  publishable: boolean;
}

export function summariseIssues(issues: readonly ValidationIssue[]): ValidationSummary {
  const errors = issues.filter((item) => item.severity === "error").length;
  return { errors, warnings: issues.length - errors, publishable: errors === 0 };
}

// ───────────────────────────── Reviewer QA checklist ─────────────────────────────

export interface QaChecklistItem {
  /** Stable key, stored with the reviewer's answer on the approval record. */
  key: string;
  label: string;
  help: string;
}

/**
 * The reviewer QA checklist from spec Section 7, as versioned data. Approval
 * records store `version` with the answers. Never edit a published version:
 * add a new one, so old approvals still say what was actually checked.
 *
 * The spec lists safety as one line with three parts; they are three items
 * here so each gets its own answer.
 */
export const QA_CHECKLIST: { version: number; items: readonly QaChecklistItem[] } = {
  version: 1,
  items: [
    {
      key: "accuracy_live_tool",
      label: "Accurate against the live tool",
      help: "Follow every setup-guide step and external task in the real tool today. Screens, button names, plans and links match what the course says.",
    },
    {
      key: "age_suitability",
      label: "Suitable for the course's minimum age",
      help: "Content, tone and tools suit the youngest learner who can open the course, and the minimum age fits each tool's policy in the Tool Register.",
    },
    {
      key: "safety_no_real_person_likeness",
      label: "No real-person likeness generation",
      help: "No step asks the learner to generate, clone or edit the face, voice or likeness of a real person.",
    },
    {
      key: "safety_ethics_checkpoint",
      label: "Meaningful ethics checkpoint",
      help: "The ethics checkpoint asks a real question about this project and makes the learner decide something, rather than tick a box.",
    },
    {
      key: "safety_evidence_no_real_people",
      label: "Evidence does not need images or video of real people",
      help: "Until a CSAM screening provider is approved and enabled, the brief and steps ask only for a link, or for media of a provided sample image, a cartoon avatar, an object, or illustrated or generated content without real people. Media containing people is rejected.",
    },
    {
      key: "first_win_10_minutes",
      label: "A first win within about 10 minutes",
      help: "A new learner makes or sees something that works within roughly the first ten minutes.",
    },
    {
      key: "hints_tiered_no_solution",
      label: "Tiered hints that do not give away the solution",
      help: "Hints go from a nudge to a stronger pointer. None contains the finished code or answer.",
    },
    {
      key: "captions_transcripts_alt",
      label: "Captions, transcripts and alt text",
      help: "Every video has accurate captions and a transcript, and every image has alt text that says what it shows.",
    },
    {
      key: "british_english_teen_voice",
      label: "British English, teen voice",
      help: "British spelling throughout. Confident and friendly, never childish, and no piles of exclamation marks.",
    },
    {
      key: "free_plan_or_cost_stated",
      label: "Completable on the free plan, or the cost is clearly stated",
      help: "The whole project can be finished on the tool's free plan. If not, the guide says exactly what a parent would pay.",
    },
    {
      key: "licensed_assets",
      label: "Licensed assets",
      help: "Every video, image, sound, font and dataset is owned by us or licensed for this use, with attribution where the licence needs it.",
    },
    {
      key: "no_passing_off_ai_work",
      label: "No step encourages passing off AI work as the learner's own for school",
      help: "Nothing suggests handing in AI-made work as homework, coursework or exam answers.",
    },
  ],
};
