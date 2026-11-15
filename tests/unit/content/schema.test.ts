import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assetManifestSchema } from "@/content/asset-schema";
import {
  CATEGORY_LABELS,
  CATEGORY_SLUGS,
  COURSE_STATUSES,
  DIFFICULTY_LABELS,
  EVIDENCE_TYPES,
  INTEREST_TAGS,
  STEP_TYPES,
  categorySlugFromLabel,
  courseSchema,
  difficultyFromLabel,
  parseStepConfig,
  safeParseStepConfig,
  stripInternalFields,
  toLearnerCourse,
  type Course,
} from "@/content/schema";
import { toolSeedSchema } from "@/content/tool-schema";

import {
  REPO_ROOT,
  SNAPCHAT_FILE,
  at,
  deepFreeze,
  firstQuiz,
  readJson,
  snapchatCourse,
  stepOf,
} from "./helpers";

const withInternalFields = (): Course => ({
  ...snapchatCourse(),
  editorNotes: "Free plan claim from https://example.com/pricing — check before publish.",
  verifyFlags: [{ path: "setupGuides.0.steps.2.body", claim: "[VERIFY] No card is needed on the free plan" }],
  sourceCandidateId: "cand-123",
  ideaId: "IDEA-001",
  generationJobId: "job-456",
});

/** Every key that appears anywhere in a JSON value. */
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      allKeys(item, keys);
    }
  }
  return keys;
}

describe("constants", () => {
  it("has the 24 categories and 16 interest tags from spec Section 15", () => {
    expect(CATEGORY_SLUGS).toHaveLength(24);
    expect(new Set(CATEGORY_SLUGS).size).toBe(24);
    expect(INTEREST_TAGS).toHaveLength(16);
    expect(new Set(INTEREST_TAGS).size).toBe(16);
  });

  it("has the launch step types, evidence types and course statuses from spec Section 6", () => {
    expect([...STEP_TYPES]).toEqual([
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
    ]);
    expect([...EVIDENCE_TYPES]).toEqual(["link", "screenshot", "file", "video"]);
    expect(COURSE_STATUSES).toHaveLength(11);
  });

  it("gives every category a distinct display name", () => {
    const labels = CATEGORY_SLUGS.map((slug) => CATEGORY_LABELS[slug]);
    expect(new Set(labels).size).toBe(24);
    expect(CATEGORY_LABELS["apps-websites"]).toBe("Apps & websites");
    expect(DIFFICULTY_LABELS).toEqual({ starter: "Starter", builder: "Builder", pro: "Pro" });
  });
});

describe("content/course-ideas.json", () => {
  const { ideas } = readJson("content/course-ideas.json") as {
    ideas: Array<{ id: string; category: string; level: string }>;
  };

  it("uses category display names that map one-to-one onto the 24 slugs", () => {
    const names = [...new Set(ideas.map((idea) => idea.category))];
    expect(names).toHaveLength(24);
    const slugs = names.map((name) => categorySlugFromLabel(name));
    expect(slugs).not.toContain(undefined);
    expect(new Set(slugs).size).toBe(24);
    expect([...slugs].sort()).toEqual([...CATEGORY_SLUGS].sort());
    for (const name of names) {
      const slug = categorySlugFromLabel(name);
      expect(slug && CATEGORY_LABELS[slug]).toBe(name);
    }
  });

  it("uses level names that map onto a difficulty", () => {
    for (const level of new Set(ideas.map((idea) => idea.level))) {
      expect(difficultyFromLabel(level)).toBeDefined();
    }
  });

  it("returns undefined for a name it does not know", () => {
    expect(categorySlugFromLabel("Cooking")).toBeUndefined();
    expect(categorySlugFromLabel("  apps & WEBSITES ")).toBe("apps-websites");
    expect(categorySlugFromLabel("video-film")).toBe("video-film");
    expect(difficultyFromLabel("Expert")).toBeUndefined();
  });
});

describe("courseSchema", () => {
  it("parses the Snapchat-style course without changing it", () => {
    const raw = readJson(SNAPCHAT_FILE);
    const parsed = courseSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(parsed.id).toBeUndefined();
  });

  it("keeps the course as spec Section 6.1 has it, apart from the four recorded changes", () => {
    const spec = readFileSync(resolve(REPO_ROOT, "PLATFORM_SPEC.md"), "utf8");
    const section = spec.slice(spec.indexOf("### 6.1 Example JSON"));
    const block = /```json\n([\s\S]*?)\n```/.exec(section);
    const expected = JSON.parse(block?.[1] ?? "null") as Course;
    const course = readJson(SNAPCHAT_FILE) as Course;

    // 1. The tagline in the spec is 134 characters; the schema limit is 120.
    expect(expected.tagline.length).toBeGreaterThan(120);
    expected.tagline = course.tagline;
    // 2–4. A read step with the sample image goes before the filter task, and the minutes follow.
    const lesson = at(at(expected.modules, 1).lessons, 1);
    const added = at(at(at(course.modules, 1).lessons, 1).steps, 0);
    expect(added).toMatchObject({
      id: "s16",
      type: "read",
      assetIds: ["img-snaplab-sample"],
      estimatedMinutes: 2,
    });
    at(lesson.steps, 0).order = 2;
    lesson.steps.unshift(added);
    lesson.estimatedMinutes += added.estimatedMinutes;
    expected.estimatedMinutes += added.estimatedMinutes;

    expect(course).toEqual(expected);
  });

  it("accepts an id once the database has assigned one", () => {
    expect(
      courseSchema.safeParse({ ...snapchatCourse(), id: "0b0e7a52-0c5c-4c0e-9a55-3f6f2f5f4b11" }).success,
    ).toBe(true);
  });

  it.each<[string, (course: Course) => unknown]>([
    ["a title over 60 characters", (c) => ({ ...c, title: "T".repeat(61) })],
    ["a tagline over 120 characters", (c) => ({ ...c, tagline: "T".repeat(121) })],
    ["a minimum age of 12", (c) => ({ ...c, minAge: 12 })],
    ["a minimum age of 19", (c) => ({ ...c, minAge: 19 })],
    ["a category that is not one of the 24", (c) => ({ ...c, category: "cooking" })],
    ["a difficulty that does not exist", (c) => ({ ...c, difficulty: "expert" })],
    ["a pathway that does not exist", (c) => ({ ...c, pathways: ["ks2"] })],
    ["an unknown top-level key", (c) => ({ ...c, coachPersona: "pirate" })],
    ["no modules", (c) => ({ ...c, modules: [] })],
    ["a slug with capitals", (c) => ({ ...c, slug: "Snap App" })],
    ["a version that is not three numbers", (c) => ({ ...c, version: "v1" })],
    [
      "an evidence type that does not exist",
      (c) => ({ ...c, projectBrief: { ...c.projectBrief, evidence: ["selfie"] } }),
    ],
  ])("rejects %s", (_label, build) => {
    expect(courseSchema.safeParse(build(snapchatCourse())).success).toBe(false);
  });

  it("accepts a title of exactly 60 and a tagline of exactly 120 characters", () => {
    const course = { ...snapchatCourse(), title: "T".repeat(60), tagline: "T".repeat(120) };
    expect(courseSchema.safeParse(course).success).toBe(true);
  });

  it("rejects a step type that would run code, preview an app or generate media", () => {
    for (const type of ["code_sandbox", "app_preview", "generate_image"]) {
      const course = snapchatCourse();
      (stepOf(course, "s3") as { type: string }).type = type;
      expect(courseSchema.safeParse(course).success).toBe(false);
    }
  });

  it("rejects a misspelt key on a step instead of dropping it", () => {
    const course = snapchatCourse();
    Object.assign(stepOf(course, "s3"), { coachContex: "typo" });
    const result = courseSchema.safeParse(course);
    expect(result.success).toBe(false);
  });

  it("accepts the internal fields on a version", () => {
    expect(courseSchema.safeParse(withInternalFields()).success).toBe(true);
  });
});

describe("parseStepConfig", () => {
  it("gives a typed config for every step in the Snapchat course", () => {
    const course = snapchatCourse();
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        for (const step of lesson.steps) expect(parseStepConfig(step).type).toBe(step.type);
      }
    }
  });

  it("narrows by type", () => {
    const course = snapchatCourse();
    const setup = parseStepConfig(stepOf(course, "s2"));
    if (setup.type !== "setup_guide") throw new Error("expected a setup_guide step");
    expect(setup.config.guideId).toBe("guide-replit");
    expect(setup.config.throughStepIds).toEqual(["g1", "g2", "g3", "g4"]);

    const task = parseStepConfig(stepOf(course, "s3"));
    if (task.type !== "external_task") throw new Error("expected an external_task step");
    expect(task.config.toolSlug).toBe("replit");
    expect(task.config.clicks).toHaveLength(4);

    const submit = parseStepConfig(stepOf(course, "s12"));
    if (submit.type !== "submit") throw new Error("expected a submit step");
    expect(submit.config.requireRubricSelfCheck).toBe(true);
    expect(submit.config.evidence).toEqual(["link", "screenshot"]);

    const quiz = parseStepConfig(stepOf(course, "s9"));
    if (quiz.type !== "quiz") throw new Error("expected a quiz step");
    expect(quiz.config.quizId).toBe("q-snaplab-1");
  });

  it("reads a missing config as empty for step types that need none", () => {
    expect(parseStepConfig({ type: "checkpoint" })).toEqual({ type: "checkpoint", config: {} });
    expect(parseStepConfig({ type: "video", config: undefined })).toEqual({ type: "video", config: {} });
  });

  it("throws for a config that does not fit, and safeParse reports it instead", () => {
    expect(() => parseStepConfig({ type: "quiz", config: {} })).toThrow();
    expect(safeParseStepConfig({ type: "quiz", config: {} }).success).toBe(false);
    expect(safeParseStepConfig({ type: "upload", config: { evidence: ["selfie"], hint: "x" } }).success).toBe(
      false,
    );
    expect(safeParseStepConfig({ type: "submit", config: { evidence: ["link"] } }).success).toBe(false);
    expect(
      safeParseStepConfig({ type: "upload", config: { evidence: ["file"], hint: "Upload your export." } })
        .success,
    ).toBe(true);
  });

  it("keeps extra keys so a round trip loses nothing", () => {
    const parsed = parseStepConfig({ type: "reflection", config: { prompt: "Why?", minWords: 20 } });
    expect(parsed.config).toEqual({ prompt: "Why?", minWords: 20 });
  });
});

describe("stripInternalFields and toLearnerCourse", () => {
  it("stripInternalFields removes the staff-only fields and nothing else", () => {
    const course = deepFreeze(withInternalFields());
    const stripped = stripInternalFields(course);
    expect(stripped).toEqual(snapchatCourse());
    expect(course.editorNotes).toBeDefined();
  });

  it("toLearnerCourse removes correct flags, option feedback, coachContext, editor notes and verify flags", () => {
    const course = withInternalFields();
    stepOf(course, "s7").config = {
      ...stepOf(course, "s7").config,
      referenceSolution: "setTimeout(() => el.remove(), 10000)",
    };
    const learner = toLearnerCourse(deepFreeze(course));

    const keys = allKeys(learner);
    for (const leaked of [
      "correct",
      "feedback",
      "coachContext",
      "editorNotes",
      "verifyFlags",
      "sourceCandidateId",
      "ideaId",
      "generationJobId",
      "referenceSolution",
    ]) {
      expect(keys.has(leaked)).toBe(false);
    }

    const json = JSON.stringify(learner);
    expect(json).not.toContain("Never ask for their password"); // coachContext
    expect(json).not.toContain("Exactly. Be honest with users about this."); // option feedback
    expect(json).not.toContain("[VERIFY]");
    expect(json).not.toContain("el.remove()");
  });

  it("keeps what the player needs", () => {
    const course = snapchatCourse();
    const learner = toLearnerCourse(course);
    expect(learner.title).toBe(course.title);
    expect(learner.modules).toHaveLength(4);
    expect(at(at(at(learner.modules, 0).lessons, 0).steps, 1).hints).toEqual(stepOf(course, "s2").hints);
    expect(at(at(at(learner.modules, 0).lessons, 0).steps, 1).config).toEqual(stepOf(course, "s2").config);
    const quiz = at(learner.quizzes, 0);
    expect(quiz.passMark).toBe(0.66);
    expect(at(quiz.questions, 0).options).toEqual([
      { id: "a", text: "Nobody can ever see it again" },
      { id: "b", text: "It's gone from your app's screen, but copies may exist elsewhere" },
      { id: "c", text: "It's illegal to screenshot it" },
    ]);
  });

  it("does not give away the answer to an order question through the order of its options", () => {
    const course = snapchatCourse();
    const authored = ["first", "second", "third", "fourth"];
    firstQuiz(course).questions.push({
      id: "q4",
      kind: "order",
      prompt: "Put the steps in order.",
      options: authored.map((id) => ({
        id,
        text: `Step ${id}`,
        correct: true,
        feedback: "This is where it goes.",
      })),
    });
    const sent = at(at(toLearnerCourse(course).quizzes, 0).questions, 3).options.map((option) => option.id);
    expect([...sent].sort()).toEqual([...authored].sort());
    expect(sent).not.toEqual(authored);
    // The same scramble every time, so a refresh is not a second look.
    expect(
      at(at(toLearnerCourse(course).quizzes, 0).questions, 3).options.map((option) => option.id),
    ).toEqual(sent);
  });

  it("never mutates the course it is given", () => {
    const course = withInternalFields();
    const before = JSON.stringify(course);
    toLearnerCourse(course);
    stripInternalFields(course);
    expect(JSON.stringify(course)).toBe(before);
  });
});

describe("tool seed schema", () => {
  it.each(["replit", "base44"])(
    "parses content/tools/%s.json, which makes no claims about the vendor's terms",
    (slug) => {
      const tool = toolSeedSchema.parse(readJson(`content/tools/${slug}.json`));
      expect(tool.slug).toBe(slug);
      expect(tool).toMatchObject({
        under18Policy: null,
        minAge: null,
        consentRule: null,
        cost: { freeTier: null, paidNote: null },
        seedStatus: "pending_verification",
        lastCheckedAt: null,
        evidence: [],
        toVerify: true,
      });
    },
  );

  const base = () => toolSeedSchema.parse(readJson("content/tools/replit.json"));

  it("will not let a tool be approved without a policy, a check date and evidence", () => {
    expect(toolSeedSchema.safeParse({ ...base(), seedStatus: "approved" }).success).toBe(false);
    const approved = {
      ...base(),
      seedStatus: "approved",
      toVerify: false,
      under18Policy: "parent_consent_required",
      minAge: 13,
      consentRule: "Fixture only.",
      lastCheckedAt: "2026-11-15",
      evidence: [{ claim: "Fixture only", url: "https://replit.com/terms" }],
    };
    expect(toolSeedSchema.safeParse(approved).success).toBe(true);
  });

  it("keeps official links on the vendor's domain and inside the allow-list", () => {
    expect(
      toolSeedSchema.safeParse({ ...base(), officialUrl: "https://replit.com.evil.example/" }).success,
    ).toBe(false);
    expect(toolSeedSchema.safeParse({ ...base(), officialUrl: "http://replit.com/" }).success).toBe(false);
    expect(toolSeedSchema.safeParse({ ...base(), allowedUrlPrefixes: ["https://replit.com"] }).success).toBe(
      false,
    );
    expect(
      toolSeedSchema.safeParse({ ...base(), allowedUrlPrefixes: ["https://replit.com/@someone/"] }).success,
    ).toBe(false);
  });
});

describe("asset manifest schema", () => {
  const manifest = () => assetManifestSchema.parse(readJson("content/assets/snaplab.json"));

  it("lists every asset the Snapchat course refers to, as owned placeholders under courses/snaplab/", () => {
    const assets = manifest();
    expect(assets.map((asset) => asset.id).sort()).toEqual(
      [
        "img-snaplab-sample",
        "img-snaplab-trailer-poster",
        "tx-snaplab-trailer",
        "vid-snaplab-trailer",
        "vtt-snaplab-trailer",
      ].sort(),
    );
    for (const asset of assets) {
      expect(asset.placeholder).toBe(true);
      expect(asset.licence).toBe("owned");
      expect(asset.storageKey.startsWith("courses/snaplab/")).toBe(true);
    }
    expect(assets.find((asset) => asset.id === "img-snaplab-sample")?.altText).toMatch(
      /not a photo of a real person/,
    );
  });

  it("rejects duplicate ids, absolute or parent paths, and CC BY without attribution", () => {
    const [first] = manifest();
    if (!first) throw new Error("empty manifest");
    expect(assetManifestSchema.safeParse([first, first]).success).toBe(false);
    expect(assetManifestSchema.safeParse([{ ...first, storageKey: "/etc/passwd" }]).success).toBe(false);
    expect(assetManifestSchema.safeParse([{ ...first, storageKey: "courses/../secrets.mp4" }]).success).toBe(
      false,
    );
    expect(assetManifestSchema.safeParse([{ ...first, licence: "cc_by" }]).success).toBe(false);
    expect(assetManifestSchema.safeParse([{ ...first, placeholder: false }]).success).toBe(false);
  });
});
