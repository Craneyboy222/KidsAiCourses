/**
 * Course content model (spec Section 6).
 *
 * These Zod schemas are the single definition of what a course is. They are
 * shared by the server, the CMS and the player, so this file must stay free of
 * server-only imports.
 *
 * Two layers work together:
 * - this file checks SHAPE (field names, unions, limits). A `course_version`
 *   snapshot always parses with `courseSchema`, drafts included.
 * - `validate.ts` checks MEANING (one submit step, setup guides, the
 *   real-people rule and so on) and returns issues a draft may carry.
 *
 * Objects are strict: an unknown key is an error rather than being silently
 * dropped, so a typo such as `coachContex` cannot quietly lose content. The
 * one open shape is `step.config`, which the spec stores as
 * `Record<string, unknown>`; use `parseStepConfig` to read it with types.
 */
import { z } from "zod";

// ───────────────────────────── Closed sets ─────────────────────────────

/** The 24 category slugs (spec Section 15). */
export const CATEGORY_SLUGS = [
  "apps-websites",
  "games",
  "chatbots-agents",
  "automations",
  "data-analysis",
  "prompt-engineering",
  "image-design",
  "video-film",
  "music-audio",
  "writing-storytelling",
  "marketing-social",
  "entrepreneurship",
  "research-study",
  "maths-science",
  "coding-ml",
  "robotics-iot",
  "ar-vr-3d",
  "cybersecurity",
  "ethics-safety",
  "careers",
  "productivity",
  "accessibility",
  "environment",
  "fun-hobbies",
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** Display names. These match the `category` values in content/course-ideas.json one-to-one. */
export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  "apps-websites": "Apps & websites",
  games: "Games",
  "chatbots-agents": "Chatbots & agents",
  automations: "Automations",
  "data-analysis": "Data & analysis",
  "prompt-engineering": "Prompt engineering",
  "image-design": "Image & design",
  "video-film": "Video & film",
  "music-audio": "Music & audio",
  "writing-storytelling": "Writing & storytelling",
  "marketing-social": "Marketing & social",
  entrepreneurship: "Entrepreneurship",
  "research-study": "Research & study",
  "maths-science": "Maths & science",
  "coding-ml": "Coding & ML",
  "robotics-iot": "Robotics & IoT",
  "ar-vr-3d": "AR, VR & 3D",
  cybersecurity: "Cybersecurity",
  "ethics-safety": "Ethics & safety",
  careers: "Careers",
  productivity: "Productivity",
  accessibility: "Accessibility",
  environment: "Environment",
  "fun-hobbies": "Fun & hobbies",
};

const normaliseLabel = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, " ");

const CATEGORY_SLUG_BY_LABEL: ReadonlyMap<string, CategorySlug> = new Map(
  CATEGORY_SLUGS.map((slug) => [normaliseLabel(CATEGORY_LABELS[slug]), slug]),
);

/** `"Apps & websites"` → `"apps-websites"`. Also accepts a slug. Returns `undefined` for an unknown name. */
export function categorySlugFromLabel(label: string): CategorySlug | undefined {
  const key = normaliseLabel(label);
  return CATEGORY_SLUG_BY_LABEL.get(key) ?? CATEGORY_SLUGS.find((slug) => slug === key);
}

/** The 16 interest tags (spec Section 15). */
export const INTEREST_TAGS = [
  "music",
  "film",
  "games",
  "apps",
  "coding",
  "art",
  "fashion",
  "sport",
  "business",
  "study",
  "writing",
  "science",
  "social",
  "design",
  "environment",
  "careers",
] as const;
export type InterestTag = (typeof INTEREST_TAGS)[number];

export const DIFFICULTIES = ["starter", "builder", "pro"] as const;
export const DIFFICULTY_LABELS: Record<(typeof DIFFICULTIES)[number], string> = {
  starter: "Starter",
  builder: "Builder",
  pro: "Pro",
};

/** `"Builder"` → `"builder"`. Returns `undefined` for an unknown name. */
export function difficultyFromLabel(label: string): Difficulty | undefined {
  const key = normaliseLabel(label);
  return DIFFICULTIES.find((d) => d === key);
}

export const PATHWAYS = ["ks3", "ks4", "sixth_form"] as const;
export const PATHWAY_LABELS: Record<(typeof PATHWAYS)[number], string> = {
  ks3: "Key Stage 3",
  ks4: "Key Stage 4",
  sixth_form: "Sixth form",
};

export const COURSE_STATUSES = [
  "ai_draft",
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "needs_review",
  "taken_down",
  "retired",
  "declined",
] as const;

export const UNDER18_POLICIES = ["allowed", "parent_consent_required", "parent_operated", "blocked"] as const;

/**
 * Every launch step type. The union is closed on purpose: there is no step
 * type that runs learner code, previews an app or generates project media on
 * our servers (spec 3.2 and the Section 6 validation paragraph).
 */
export const STEP_TYPES = [
  "video",
  "read",
  "setup_guide",
  "external_task",
  "upload",
  "quiz",
  "ethics_checkpoint",
  "reflection",
  "checkpoint",
  "submit",
] as const;

export const COMPLETION_RULES = [
  "view",
  "quiz_pass",
  "self_tick",
  "setup_acknowledged",
  "upload_approved",
  "evidence_submitted",
  "submit",
] as const;

export const EVIDENCE_TYPES = ["link", "screenshot", "file", "video"] as const;

export const ARTEFACT_TYPES = [
  "web_app",
  "bot_config",
  "video",
  "audio",
  "image_set",
  "document",
  "code_bundle",
  "dataset",
  "external_link",
] as const;

export const SETUP_GUIDE_STEP_KINDS = [
  "create_account",
  "verify_email",
  "choose_free_plan",
  "privacy_settings",
  "do_in_tool",
  "export",
  "other",
] as const;

/** The four things every required tool's guide must cover (spec 3.3). */
export const REQUIRED_SETUP_GUIDE_KINDS = [
  "create_account",
  "verify_email",
  "choose_free_plan",
  "privacy_settings",
] as const satisfies ReadonlyArray<(typeof SETUP_GUIDE_STEP_KINDS)[number]>;

export const QUIZ_QUESTION_KINDS = ["single", "multi", "order", "spot_the_problem"] as const;

export const RUBRIC_LEVEL_LABELS = ["Not yet", "Getting there", "Nailed it"] as const;

export const WATCH_OUT_TYPES = ["age18_tools", "safeguarding", "data", "exam_integrity"] as const;

export const ASSET_KINDS = [
  "video",
  "image",
  "audio",
  "captions_vtt",
  "transcript_md",
  "template_zip",
  "dataset_csv",
  "font",
  "guide_screenshot",
] as const;

export const ASSET_LICENCES = ["owned", "cc0", "cc_by", "licensed_platform_only"] as const;

export const MIN_AGES = [13, 14, 15, 16, 17, 18] as const;

export const TITLE_MAX_LENGTH = 60;
export const TAGLINE_MAX_LENGTH = 120;

// ───────────────────────────── Primitives ─────────────────────────────

const text = z.string().trim().min(1, "This cannot be empty.");

/** Lower-case words joined by hyphens: `build-your-own-snapchat-style-app`, `replit`. */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, numbers and single hyphens only.");

/** An id used inside a course (`m1`, `s12`, `guide-replit`, `q-snaplab-1`) or for an asset. */
export const localIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens and underscores only.");

/** `2026-11-01` or a full ISO timestamp. */
export const isoDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const minutes = z.number().int().min(0);
const order = z.number().int().min(0);

export const difficultySchema = z.enum(DIFFICULTIES);
export const pathwaySchema = z.enum(PATHWAYS);
export const courseStatusSchema = z.enum(COURSE_STATUSES);
export const under18PolicySchema = z.enum(UNDER18_POLICIES);
export const stepTypeSchema = z.enum(STEP_TYPES);
export const completionRuleSchema = z.enum(COMPLETION_RULES);
export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const artefactTypeSchema = z.enum(ARTEFACT_TYPES);
export const categorySlugSchema = z.enum(CATEGORY_SLUGS);
export const interestTagSchema = z.enum(INTEREST_TAGS);
export const minAgeSchema = z.literal(MIN_AGES);

export type Difficulty = z.infer<typeof difficultySchema>;
export type Pathway = z.infer<typeof pathwaySchema>;
export type CourseStatus = z.infer<typeof courseStatusSchema>;
export type Under18Policy = z.infer<typeof under18PolicySchema>;
export type StepType = z.infer<typeof stepTypeSchema>;
export type CompletionRule = z.infer<typeof completionRuleSchema>;
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type ArtefactType = z.infer<typeof artefactTypeSchema>;
export type MinAge = z.infer<typeof minAgeSchema>;

// ───────────────────────────── Tools and guides ─────────────────────────────

/** A course names a tool by slug only. Display facts are read from the Tool Register at request time. */
export const toolRequirementSchema = z.strictObject({
  toolSlug: slugSchema,
  purpose: text,
  required: z.boolean(),
  fallbackToolSlug: slugSchema.optional(),
});
export type ToolRequirement = z.infer<typeof toolRequirementSchema>;

export const setupGuideStepKindSchema = z.enum(SETUP_GUIDE_STEP_KINDS);
export type SetupGuideStepKind = z.infer<typeof setupGuideStepKindSchema>;

export const setupGuideStepSchema = z.strictObject({
  id: localIdSchema,
  title: text,
  order,
  kind: setupGuideStepKindSchema,
  body: text,
  screenshotAssetIds: z.array(localIdSchema).optional(),
});
export type SetupGuideStep = z.infer<typeof setupGuideStepSchema>;

export const setupGuideSchema = z.strictObject({
  id: localIdSchema,
  toolSlug: slugSchema,
  title: text,
  lastVerifiedAt: isoDateSchema,
  steps: z.array(setupGuideStepSchema).min(1),
});
export type SetupGuide = z.infer<typeof setupGuideSchema>;

// ───────────────────────────── Project brief ─────────────────────────────

export const projectBriefSchema = z.strictObject({
  scenario: text,
  deliverables: z.array(text).min(1),
  constraints: z.array(text),
  stretchGoals: z.array(text),
  artefactTypes: z.array(artefactTypeSchema).min(1),
  evidence: z.array(evidenceTypeSchema).min(1),
});
export type ProjectBrief = z.infer<typeof projectBriefSchema>;

// ───────────────────────────── Steps ─────────────────────────────

export const completionSchema = z.strictObject({
  rule: completionRuleSchema,
  /** A fraction from 0 to 1: how much of a video must be watched, or the quiz pass mark. */
  threshold: z.number().min(0).max(1).optional(),
});
export type Completion = z.infer<typeof completionSchema>;

export const stepSchema = z.strictObject({
  id: localIdSchema,
  type: stepTypeSchema,
  title: text,
  order,
  estimatedMinutes: minutes,
  body: z.string().optional(),
  assetIds: z.array(localIdSchema).optional(),
  /** Stored open, as the spec has it. Read it with `parseStepConfig`. */
  config: z.record(z.string(), z.unknown()).optional(),
  completion: completionSchema,
  /** Guidance for Coach on this step. Internal: never sent to the learner's browser. */
  coachContext: z.string().optional(),
  hints: z.array(text),
});
export type Step = z.infer<typeof stepSchema>;

/**
 * Typed `config` per step type. The objects are loose so that extra keys
 * survive a round trip; `validate.ts` rejects keys that are not allowed.
 *
 * `referenceSolution` may sit on any step. It is for staff and the hint
 * checker only, and `toLearnerCourse` removes it.
 */
const configBase = { referenceSolution: z.string().optional() };

export const stepConfigSchemas = {
  video: z.looseObject({ ...configBase }),
  read: z.looseObject({ ...configBase }),
  checkpoint: z.looseObject({ ...configBase }),
  setup_guide: z.looseObject({
    ...configBase,
    toolSlug: slugSchema,
    guideId: localIdSchema,
    throughStepIds: z.array(localIdSchema).min(1),
  }),
  external_task: z.looseObject({
    ...configBase,
    toolSlug: slugSchema,
    /** What to do in the tool, step by step. */
    task: text,
    /** Optional short click path, in order: `["Create Repl", "Choose HTML/CSS/JS"]`. */
    clicks: z.array(text).optional(),
  }),
  quiz: z.looseObject({ ...configBase, quizId: localIdSchema }),
  ethics_checkpoint: z.looseObject({ ...configBase, prompt: text }),
  reflection: z.looseObject({ ...configBase, prompt: text }),
  upload: z.looseObject({
    ...configBase,
    evidence: z.array(evidenceTypeSchema).min(1),
    /** Tells the learner what to upload. Checked by the real-people rule. */
    hint: text,
  }),
  submit: z.looseObject({
    ...configBase,
    artefactTypes: z.array(artefactTypeSchema).min(1),
    evidence: z.array(evidenceTypeSchema).min(1),
    requireRubricSelfCheck: z.boolean(),
    /** Tells the learner what evidence to give. Checked by the real-people rule. */
    evidenceHint: text,
  }),
} as const satisfies Record<StepType, z.ZodType>;

export type StepConfigByType = { [K in StepType]: z.infer<(typeof stepConfigSchemas)[K]> };
export type StepConfig<K extends StepType = StepType> = StepConfigByType[K];
export type SetupGuideStepConfig = StepConfigByType["setup_guide"];
export type ExternalTaskStepConfig = StepConfigByType["external_task"];
export type QuizStepConfig = StepConfigByType["quiz"];
export type PromptStepConfig = StepConfigByType["reflection"];
export type UploadStepConfig = StepConfigByType["upload"];
export type SubmitStepConfig = StepConfigByType["submit"];

/** A step's type together with its typed config. Switch on `type` to narrow `config`. */
export type ParsedStepConfig = { [K in StepType]: { type: K; config: StepConfigByType[K] } }[StepType];

export type SafeParsedStepConfig =
  { success: true; data: ParsedStepConfig } | { success: false; error: z.ZodError };

/** Reads `step.config` with the schema for `step.type`. A missing config is read as `{}`. Never throws. */
export function safeParseStepConfig(step: Pick<Step, "type" | "config">): SafeParsedStepConfig {
  const type = stepTypeSchema.safeParse(step.type);
  if (!type.success) return { success: false, error: type.error };
  const parsed = stepConfigSchemas[type.data].safeParse(step.config ?? {});
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, data: { type: type.data, config: parsed.data } as ParsedStepConfig };
}

/**
 * Reads `step.config` with the schema for `step.type`.
 * @throws ZodError when the config does not fit. Use `safeParseStepConfig` for drafts.
 */
export function parseStepConfig(step: Pick<Step, "type" | "config">): ParsedStepConfig {
  const result = safeParseStepConfig(step);
  if (!result.success) throw result.error;
  return result.data;
}

// ───────────────────────────── Modules ─────────────────────────────

export const lessonSchema = z.strictObject({
  id: localIdSchema,
  title: text,
  order,
  estimatedMinutes: minutes,
  steps: z.array(stepSchema).min(1),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const moduleSchema = z.strictObject({
  id: localIdSchema,
  title: text,
  summary: text,
  order,
  lessons: z.array(lessonSchema).min(1),
});
export type Module = z.infer<typeof moduleSchema>;

// ───────────────────────────── Quizzes ─────────────────────────────

export const quizQuestionKindSchema = z.enum(QUIZ_QUESTION_KINDS);
export type QuizQuestionKind = z.infer<typeof quizQuestionKindSchema>;

export const quizOptionSchema = z.strictObject({
  id: localIdSchema,
  text,
  correct: z.boolean(),
  /** Shown after the learner answers. `validate.ts` requires it to be filled in. */
  feedback: z.string(),
});
export type QuizOption = z.infer<typeof quizOptionSchema>;

/**
 * For `order` questions the options are written in the correct order and
 * every option is marked `correct`. `toLearnerCourse` shuffles them.
 */
export const quizQuestionSchema = z.strictObject({
  id: localIdSchema,
  kind: quizQuestionKindSchema,
  prompt: text,
  options: z.array(quizOptionSchema).min(1),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizSchema = z.strictObject({
  id: localIdSchema,
  title: text,
  /** A fraction from 0 to 1. The range is checked in `validate.ts` so a draft can still be saved. */
  passMark: z.number(),
  questions: z.array(quizQuestionSchema).min(1),
});
export type Quiz = z.infer<typeof quizSchema>;

// ───────────────────────────── Rubric ─────────────────────────────

export const rubricLevelSchema = z.strictObject({
  label: z.enum(RUBRIC_LEVEL_LABELS),
  descriptor: text,
});
export type RubricLevel = z.infer<typeof rubricLevelSchema>;

export const rubricCriterionSchema = z.strictObject({
  id: localIdSchema,
  name: text,
  description: text,
  levels: z.array(rubricLevelSchema).min(1),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

export const rubricSchema = z.strictObject({
  criteria: z.array(rubricCriterionSchema).min(1),
});
export type Rubric = z.infer<typeof rubricSchema>;

// ───────────────────────────── Assets ─────────────────────────────

export const assetKindSchema = z.enum(ASSET_KINDS);
export const assetLicenceSchema = z.enum(ASSET_LICENCES);
export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetLicence = z.infer<typeof assetLicenceSchema>;

export const assetSchema = z.strictObject({
  id: localIdSchema,
  kind: assetKindSchema,
  storageKey: z
    .string()
    .min(1)
    .regex(
      /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\/-]+$/,
      "Use a relative storage key such as courses/snaplab/trailer.mp4.",
    ),
  licence: assetLicenceSchema,
  attribution: z.string().optional(),
  altText: z.string().optional(),
  durationSec: z.number().min(0).optional(),
});
export type Asset = z.infer<typeof assetSchema>;

// ───────────────────────────── Course ─────────────────────────────

export const trailerSchema = z.strictObject({
  assetId: localIdSchema,
  posterAssetId: localIdSchema,
  captionsAssetId: localIdSchema,
});
export type Trailer = z.infer<typeof trailerSchema>;

export const watchOutSchema = z.strictObject({
  type: z.enum(WATCH_OUT_TYPES),
  note: text,
});
export type WatchOut = z.infer<typeof watchOutSchema>;

/** A claim in an AI draft that has no evidence yet. Shown to reviewers as unverified. */
export const verifyFlagSchema = z.strictObject({
  /** Where the claim sits, in the same dotted form as a validation issue path. */
  path: z.string(),
  claim: text,
  evidenceUrl: z.url({ protocol: /^https$/ }).optional(),
});
export type VerifyFlag = z.infer<typeof verifyFlagSchema>;

/** Fields a course version may carry for staff. None of them is ever shown to a learner. */
export const INTERNAL_COURSE_FIELDS = [
  "editorNotes",
  "verifyFlags",
  "sourceCandidateId",
  "ideaId",
  "generationJobId",
] as const;
export type InternalCourseField = (typeof INTERNAL_COURSE_FIELDS)[number];

export const courseSchema = z.strictObject({
  /** Assigned by the database. Absent in authored JSON. */
  id: z.string().min(1).optional(),
  slug: slugSchema,
  title: text.max(TITLE_MAX_LENGTH, `Keep the title to ${TITLE_MAX_LENGTH} characters or fewer.`),
  tagline: text.max(TAGLINE_MAX_LENGTH, `Keep the tagline to ${TAGLINE_MAX_LENGTH} characters or fewer.`),
  category: categorySlugSchema,
  /** Normally from `INTEREST_TAGS`; `validate.ts` warns about any other value. */
  interests: z.array(text),
  difficulty: difficultySchema,
  pathways: z.array(pathwaySchema),
  minAge: minAgeSchema,
  estimatedMinutes: minutes,
  sessions: z.number().int().min(1),
  isFree: z.boolean(),
  careers: z.array(text),
  skills: z.array(text),
  trailer: trailerSchema,
  whatYouMake: text,
  ethicsNote: text,
  safeguardingSensitive: z.boolean(),
  watchOut: watchOutSchema.optional(),
  toolRequirements: z.array(toolRequirementSchema),
  setupGuides: z.array(setupGuideSchema),
  projectBrief: projectBriefSchema,
  modules: z.array(moduleSchema).min(1),
  quizzes: z.array(quizSchema),
  rubric: rubricSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Use a version such as 1.0.0."),
  lastVerifiedAt: isoDateSchema.optional(),
  guidesLastVerifiedAt: isoDateSchema.optional(),

  // Internal, staff-only (spec Section 6: "none of these are shown to learners").
  editorNotes: z.string().optional(),
  verifyFlags: z.array(verifyFlagSchema).optional(),
  sourceCandidateId: z.string().min(1).optional(),
  ideaId: z.string().min(1).optional(),
  generationJobId: z.string().min(1).optional(),
});
export type Course = z.infer<typeof courseSchema>;

// ───────────────────────────── Learner payload ─────────────────────────────

export type PublicCourse = Omit<Course, InternalCourseField>;

export type LearnerQuizOption = Omit<QuizOption, "correct" | "feedback">;
export type LearnerQuizQuestion = Omit<QuizQuestion, "options"> & { options: LearnerQuizOption[] };
export type LearnerQuiz = Omit<Quiz, "questions"> & { questions: LearnerQuizQuestion[] };
export type LearnerStep = Omit<Step, "coachContext">;
export type LearnerLesson = Omit<Lesson, "steps"> & { steps: LearnerStep[] };
export type LearnerModule = Omit<Module, "lessons"> & { lessons: LearnerLesson[] };
/** What the learner's browser may receive: no internal fields and nothing that gives an answer away. */
export type LearnerCourse = Omit<PublicCourse, "modules" | "quizzes"> & {
  modules: LearnerModule[];
  quizzes: LearnerQuiz[];
};

/** Config keys that hold an answer. Removed from every step in the learner payload. */
export const SOLUTION_CONFIG_KEYS = ["referenceSolution"] as const;

/** Returns a copy of the course without editor notes, `[VERIFY]` flags or source and job ids. */
export function stripInternalFields(course: Course): PublicCourse {
  const copy: Course = structuredClone(course);
  for (const field of INTERNAL_COURSE_FIELDS) delete copy[field];
  return copy;
}

/** FNV-1a. Small, stable and good enough to shuffle a handful of options the same way every time. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * `order` questions are authored in the correct order, so sending them as
 * written would give the answer away. This puts them in a fixed scrambled
 * order (the same on every request, so a refresh is not a second look).
 */
function scrambleOptions<T extends { id: string }>(seed: string, options: T[]): T[] {
  if (options.length < 2) return options;
  const scrambled = options
    .map((option, index) => ({ option, index, key: hashString(`${seed}:${option.id}:${index}`) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.option);
  const unchanged = scrambled.every((option, index) => option === options[index]);
  if (!unchanged) return scrambled;
  // The hash happened to give the authored order back: rotate by one instead.
  return [...scrambled.slice(1), ...scrambled.slice(0, 1)];
}

/**
 * The course as the learner's browser may see it.
 *
 * Removes the internal fields, and everything that would leak a solution:
 * each quiz option's `correct` flag and `feedback` (answers are checked on
 * the server, which returns feedback for the option chosen), each step's
 * `coachContext`, any `referenceSolution` in step config, and the authored
 * order of `order` questions.
 */
export function toLearnerCourse(course: Course): LearnerCourse {
  const base = stripInternalFields(course);
  return {
    ...base,
    modules: base.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({
        ...lesson,
        steps: lesson.steps.map((step): LearnerStep => {
          const { coachContext: _coachContext, config, ...rest } = step;
          if (config === undefined) return rest;
          const safeConfig = Object.fromEntries(
            Object.entries(config).filter(
              ([key]) => !(SOLUTION_CONFIG_KEYS as readonly string[]).includes(key),
            ),
          );
          return { ...rest, config: safeConfig };
        }),
      })),
    })),
    quizzes: base.quizzes.map((quiz) => ({
      ...quiz,
      questions: quiz.questions.map((question) => {
        const options = question.options.map(({ id, text: optionText }) => ({ id, text: optionText }));
        return {
          ...question,
          options:
            question.kind === "order" ? scrambleOptions(`${quiz.id}:${question.id}`, options) : options,
        };
      }),
    })),
  };
}
