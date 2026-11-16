import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { flattenSteps } from "@/content/course-utils";
import { ANONYMOUS } from "@/server/authz";
import {
  auditLog,
  course,
  courseModule,
  courseTool,
  courseVersion,
  lesson,
  quiz,
  quizQuestion,
  rubricCriterion,
  step,
  toolGuide,
  toolGuideStep,
} from "@/server/db";
import {
  buildDbValidationContext,
  createCourse,
  getPublishedCourseBySlug,
  getRevision,
  getWorkingVersion,
  listRevisions,
  loadVersionContent,
  materialiseVersion,
  restoreRevision,
  revalidateVersion,
  saveRevision,
  syncCatalogueFields,
  type StoredValidation,
} from "@/server/services/course-store";
import { disableStep, publishVersion } from "@/server/services/publish";
import { blockTool } from "@/server/services/tools";
import { closeDb, db, resetDb } from "../../helpers/db";
import { createLearner } from "../../helpers/factories";
import {
  appError,
  approvedCourse,
  auditActions,
  ctxFor,
  fixtureCourse,
  readCourse,
  readVersion,
  setUpRegister,
  staff,
  systemCtx,
} from "./helpers";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function count(table: PgTable): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.n ?? 0;
}

describe("createCourse", () => {
  it("creates the course with revision 1 as a draft, validated against the database", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created, version } = await createCourse(ctxFor(editor), fixtureCourse(), {
      origin: "hand_made",
    });

    expect(created).toMatchObject({
      slug: "build-your-own-snapchat-style-app",
      status: "draft",
      origin: "hand_made",
      publishedVersionId: null,
    });
    expect(created.workingVersionId).toBe(version.id);
    expect(version).toMatchObject({
      revision: 1,
      status: "draft",
      semver: "1.0.0",
      createdBy: editor.userId,
      lastEditedBy: editor.userId,
      publishedAt: null,
    });
    expect((version.validation as unknown as StoredValidation).ok).toBe(true);
    expect((version.snapshot as { id?: string }).id).toBe(created.id);
    // A draft is never live.
    expect(await getPublishedCourseBySlug({ db }, created.slug)).toBeNull();
    expect(await auditActions()).toContain("course.create");
  });

  it("gives an AI origin the status ai_draft and no last editor", async () => {
    await setUpRegister();
    const { course: created, version } = await createCourse(systemCtx("draft.generate"), fixtureCourse(), {
      origin: "ai_on_demand",
    });
    expect(created.status).toBe("ai_draft");
    expect(version).toMatchObject({
      status: "ai_draft",
      origin: "ai_on_demand",
      lastEditedBy: null,
      createdBy: null,
    });
  });

  it("records validation errors against the live Register and still saves", async () => {
    // No tools approved: replit and base44 are pending verification.
    await setUpRegister({ approve: [] });
    const { version } = await createCourse(ctxFor(await staff("editor")), fixtureCourse(), {
      origin: "hand_made",
    });
    const validation = version.validation as unknown as StoredValidation;
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("tool_policy_unverified");
  });

  it("refuses a second course with the same slug, and a snapshot that does not fit the schema", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    expect(
      (await appError(() => createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" }))).code,
    ).toBe("conflict");

    const broken = {
      ...fixtureCourse(),
      slug: "another-course",
      coachContex: "typo",
    } as unknown as ReturnType<typeof fixtureCourse>;
    expect((await appError(() => createCourse(ctxFor(editor), broken, { origin: "hand_made" }))).code).toBe(
      "validation_failed",
    );
    expect(await count(course)).toBe(1);
  });

  it("is refused for learners, signed-out visitors and staff without the editor role", async () => {
    await setUpRegister();
    const learner = await createLearner();
    for (const actor of [ANONYMOUS, learner.actor, await staff("moderator"), await staff("reviewer")]) {
      const error = await appError(() =>
        createCourse(ctxFor(actor), fixtureCourse(), { origin: "hand_made" }),
      );
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await count(course)).toBe(0);
  });
});

describe("saveRevision", () => {
  it("always inserts revision + 1 and never changes an earlier revision", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created, version: first } = await createCourse(ctxFor(editor), fixtureCourse(), {
      origin: "hand_made",
    });
    const firstBefore = await readVersion(first.id);

    const second = await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "Second title")),
      { note: "Retitled" },
    );
    const third = await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "Third title")),
    );

    expect(second.version).toMatchObject({
      revision: 2,
      parentVersionId: first.id,
      changeSummary: "Retitled",
      status: "draft",
    });
    expect(third.version).toMatchObject({ revision: 3, parentVersionId: second.version.id });
    expect(third.course.workingVersionId).toBe(third.version.id);

    // Revision 1 is byte-for-byte what it was.
    expect(await readVersion(first.id)).toEqual(firstBefore);
    expect((await readVersion(second.version.id)).snapshot).toMatchObject({ title: "Second title" });

    const revisions = await listRevisions(ctxFor(editor), created.id);
    expect(revisions.map((revision) => revision.revision)).toEqual([3, 2, 1]);
    expect(revisions[0]).not.toHaveProperty("snapshot");
    expect((await getRevision(ctxFor(editor), created.id, 2)).content.title).toBe("Second title");
    expect((await getWorkingVersion(ctxFor(editor), created.id)).content.title).toBe("Third title");
    expect((await auditActions()).filter((action) => action === "course.revision.save")).toHaveLength(2);
  });

  it("saves a draft that has validation errors and stores the issues", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    const withoutEthics = fixtureCourse((c) => {
      for (const mod of c.modules)
        for (const item of mod.lessons)
          item.steps = item.steps.filter((entry) => entry.type !== "ethics_checkpoint");
    });
    const saved = await saveRevision(ctxFor(editor), created.id, withoutEthics);
    const validation = saved.version.validation as unknown as StoredValidation;
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("ethics_checkpoint_missing");
    expect(saved.version.revision).toBe(2);
  });

  it("refuses a stale save when expectedRevision is given, and a snapshot that does not parse", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "Tab one")),
      { expectedRevision: 1 },
    );
    const stale = await appError(() =>
      saveRevision(
        ctxFor(editor),
        created.id,
        fixtureCourse((c) => (c.title = "Tab two")),
        { expectedRevision: 1 },
      ),
    );
    expect(stale.code).toBe("conflict");

    const tooLong = fixtureCourse((c) => (c.title = "x".repeat(61)));
    expect((await appError(() => saveRevision(ctxFor(editor), created.id, tooLong))).code).toBe(
      "validation_failed",
    );
    expect(await count(courseVersion)).toBe(2);
  });

  it("is refused for a reviewer, a learner and a signed-out visitor", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    const learner = await createLearner();
    for (const actor of [ANONYMOUS, learner.actor, await staff("reviewer")]) {
      const error = await appError(() => saveRevision(ctxFor(actor), created.id, fixtureCourse()));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await count(courseVersion)).toBe(1);
  });

  it("keeps the last human editor when a job writes the next revision of an AI draft", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(systemCtx("draft.generate"), fixtureCourse(), {
      origin: "ai_radar",
    });
    const human = await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "Edited by a person")),
    );
    expect(human.version).toMatchObject({ status: "draft", lastEditedBy: editor.userId });
    const regenerated = await saveRevision(
      systemCtx("draft.edit_request"),
      created.id,
      fixtureCourse((c) => (c.title = "Regenerated")),
    );
    expect(regenerated.version).toMatchObject({
      revision: 3,
      status: "ai_draft",
      lastEditedBy: editor.userId,
      createdBy: null,
    });
  });
});

describe("restoreRevision", () => {
  it("makes a new revision with the old snapshot and leaves the old one alone", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created, version: first } = await createCourse(ctxFor(editor), fixtureCourse(), {
      origin: "hand_made",
    });
    await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "A change we regret")),
    );
    const firstBefore = await readVersion(first.id);

    const restored = await restoreRevision(ctxFor(editor), created.id, 1);
    expect(restored.version).toMatchObject({
      revision: 3,
      parentVersionId: first.id,
      changeSummary: "Restored from revision 1",
      status: "draft",
    });
    expect(restored.version.snapshot).toEqual(firstBefore.snapshot);
    expect(restored.course.workingVersionId).toBe(restored.version.id);
    expect(await readVersion(first.id)).toEqual(firstBefore);
    expect(await count(courseVersion)).toBe(3);
    expect(await auditActions()).toContain("course.revision.restore");

    expect((await appError(() => restoreRevision(ctxFor(editor), created.id, 99))).code).toBe("not_found");
  });
});

describe("materialiseVersion", () => {
  it("writes every row once, maps step keys to ids, and is idempotent", async () => {
    await setUpRegister();
    const { course: created, version } = await createCourse(ctxFor(await staff("editor")), fixtureCourse(), {
      origin: "hand_made",
    });
    const snapshot = fixtureCourse();
    const flat = flattenSteps(snapshot);

    const first = await db.transaction((tx) => materialiseVersion(tx, version.id));
    const counts = async () => ({
      modules: await count(courseModule),
      lessons: await count(lesson),
      steps: await count(step),
      quizzes: await count(quiz),
      questions: await count(quizQuestion),
      criteria: await count(rubricCriterion),
      tools: await count(courseTool),
      guides: await count(toolGuide),
      guideSteps: await count(toolGuideStep),
    });
    const expected = {
      modules: snapshot.modules.length,
      lessons: snapshot.modules.reduce((sum, mod) => sum + mod.lessons.length, 0),
      steps: flat.length,
      quizzes: snapshot.quizzes.length,
      questions: snapshot.quizzes.reduce((sum, item) => sum + item.questions.length, 0),
      criteria: snapshot.rubric.criteria.length,
      tools: snapshot.toolRequirements.length,
      guides: snapshot.setupGuides.length,
      guideSteps: snapshot.setupGuides.reduce((sum, guide) => sum + guide.steps.length, 0),
    };
    expect(await counts()).toEqual(expected);

    // Every JSON step id maps to the id of the row that holds it.
    expect([...first.keys()].sort()).toEqual(flat.map((entry) => entry.step.id).sort());
    const rows = await db.select().from(step).where(eq(step.courseVersionId, version.id));
    for (const row of rows) expect(first.get(row.key)).toBe(row.id);

    const s2 = rows.find((row) => row.key === "s2");
    expect(s2).toMatchObject({
      type: "setup_guide",
      toolSlug: "replit",
      completionRule: "setup_acknowledged",
      position: 1,
      disabled: false,
    });
    expect(rows.find((row) => row.key === "s1")).toMatchObject({
      completionThreshold: 80,
      completionRule: "view",
    });
    const [aQuiz] = await db.select().from(quiz);
    expect(aQuiz?.passMark).toBe(66);
    const [tool] = await db.select().from(courseTool);
    expect(tool).toMatchObject({ courseId: created.id, required: true });
    expect(tool?.fallbackToolId).not.toBeNull();

    // An urgent step take-down must survive a second run.
    const stepId = first.get("s3");
    if (!stepId) throw new Error("no s3");
    await disableStep(ctxFor(await staff("moderator")), stepId, "Screenshot shows the wrong menu");

    const second = await db.transaction((tx) => materialiseVersion(tx, version.id));
    expect(await counts()).toEqual(expected);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
    const [disabled] = await db.select().from(step).where(eq(step.id, stepId));
    expect(disabled).toMatchObject({ disabled: true, disabledReason: "Screenshot shows the wrong menu" });
    expect((await readVersion(version.id)).materialisedAt).not.toBeNull();
  });

  it("refuses to materialise a required tool that is not in the Register", async () => {
    const { version } = await createCourse(ctxFor(await staff("editor")), fixtureCourse(), {
      origin: "hand_made",
    });
    const error = await appError(() => db.transaction((tx) => materialiseVersion(tx, version.id)));
    expect(error.code).toBe("validation_failed");
    expect(await count(step)).toBe(0);
  });
});

describe("published versions and catalogue fields", () => {
  it("a draft revision of a published course changes nothing learners see", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    const live = await readCourse(approved.course.id);
    expect(live.course).toMatchObject({
      status: "published",
      title: "Build Your Own Snapchat-Style App",
      minAge: 13,
      isFree: false,
      difficulty: "builder",
      category: "apps-websites",
      toolSlugs: ["replit"],
    });

    const draft = await saveRevision(
      ctxFor(editor),
      approved.course.id,
      fixtureCourse((c) => {
        c.title = "A much edgier title";
        c.tagline = "Draft tagline that learners must not see yet.";
        c.minAge = 16;
        c.isFree = true;
        c.difficulty = "pro";
        c.interests = ["music"];
        c.safeguardingSensitive = true;
      }),
    );

    const after = await readCourse(approved.course.id);
    // The draft is the working version; the published one is still live and still drives the catalogue.
    expect(after.course.workingVersionId).toBe(draft.version.id);
    expect(after.course.publishedVersionId).toBe(approved.version.id);
    expect(after.course).toMatchObject({
      status: "published",
      title: live.course.title,
      tagline: live.course.tagline,
      minAge: 13,
      isFree: false,
      difficulty: "builder",
      interests: live.course.interests,
      safeguardingSensitive: false,
    });
    const published = await getPublishedCourseBySlug({ db }, after.course.slug);
    expect(published?.version.id).toBe(approved.version.id);
    expect(published?.content.title).toBe("Build Your Own Snapchat-Style App");

    // syncCatalogueFields in draft mode is a no-op for a course that has ever been published.
    const wrote = await db.transaction((tx) =>
      syncCatalogueFields(
        tx,
        approved.course.id,
        fixtureCourse((c) => (c.title = "Sneaky")),
        { draft: true },
      ),
    );
    expect(wrote).toBe(false);
    expect((await readCourse(approved.course.id)).course.title).toBe(live.course.title);
  });

  it("a slug cannot change once the course has been published", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    const error = await appError(() =>
      saveRevision(
        ctxFor(editor),
        approved.course.id,
        fixtureCourse((c) => (c.slug = "a-new-address")),
      ),
    );
    expect(error.code).toBe("invalid_input");
  });

  it("a published version cannot be modified: the database trigger refuses, and edits become a new revision", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    const frozen = await readVersion(approved.version.id);
    expect(frozen.publishedAt).not.toBeNull();

    const tampered = { ...frozen.snapshot, title: "Changed behind everyone's back" };
    await expect(
      db.update(courseVersion).set({ snapshot: tampered }).where(eq(courseVersion.id, frozen.id)),
    ).rejects.toThrow();
    await expect(
      db.update(courseVersion).set({ publishedAt: null }).where(eq(courseVersion.id, frozen.id)),
    ).rejects.toThrow();
    await expect(
      db.update(courseVersion).set({ revision: 99 }).where(eq(courseVersion.id, frozen.id)),
    ).rejects.toThrow();

    const edited = await saveRevision(
      ctxFor(editor),
      approved.course.id,
      fixtureCourse((c) => (c.title = "The next version")),
    );
    expect(edited.version.revision).toBe(frozen.revision + 1);
    expect(edited.version.publishedAt).toBeNull();
    const still = await readVersion(frozen.id);
    expect(still.snapshot).toEqual(frozen.snapshot);
    expect(still.status).toBe("published");
  });
});

describe("reading", () => {
  it("drafts are invisible to learners and signed-out visitors, by slug and by version id", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created, version } = await createCourse(ctxFor(editor), fixtureCourse(), {
      origin: "hand_made",
    });
    const learner = await createLearner();

    expect(await getPublishedCourseBySlug({ db }, created.slug)).toBeNull();
    for (const actor of [ANONYMOUS, learner.actor]) {
      expect((await appError(() => loadVersionContent(ctxFor(actor), version.id))).code).toBe("not_found");
      const read = await appError(() => getWorkingVersion(ctxFor(actor), created.id));
      expect(["forbidden", "unauthenticated"]).toContain(read.code);
      const list = await appError(() => listRevisions(ctxFor(actor), created.id));
      expect(["forbidden", "unauthenticated"]).toContain(list.code);
    }
    expect((await loadVersionContent(ctxFor(editor), version.id)).slug).toBe(created.slug);
  });

  it("a published version can be loaded for a learner pinned to it", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(await staff("editor"), reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    const learner = await createLearner();
    expect((await loadVersionContent(ctxFor(learner.actor), approved.version.id)).title).toBe(
      "Build Your Own Snapchat-Style App",
    );
  });

  it("the validation context follows the live Register, and revalidateVersion stores the new result", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { version } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    const context = await buildDbValidationContext({ db }, fixtureCourse(), {
      waivers: ["setup_guide:replit"],
    });
    expect(context.tools.replit).toEqual({ under18Policy: "allowed", status: "approved" });
    expect(context.assets["img-snaplab-sample"]?.kind).toBe("image");
    expect(context.peopleScreeningEnabled).toBe(false);
    expect(context.waivers).toEqual(["setup_guide:replit"]);

    await blockTool(ctxFor(editor), "replit", "Terms changed");
    await blockTool(ctxFor(editor), "base44", "Terms changed");
    const after = await revalidateVersion(ctxFor(editor), version.id);
    expect(after.ok).toBe(false);
    expect(after.issues.map((issue) => issue.code)).toContain("tool_blocked");
    expect(((await readVersion(version.id)).validation as unknown as StoredValidation).ok).toBe(false);
  });

  it("every mutation leaves an audit entry naming the actor", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    await saveRevision(
      ctxFor(editor),
      created.id,
      fixtureCourse((c) => (c.title = "Again")),
    );
    const entries = await db.select().from(auditLog).where(eq(auditLog.targetId, created.id));
    expect(entries.map((entry) => entry.action).sort()).toEqual(["course.create", "course.revision.save"]);
    for (const entry of entries)
      expect(entry).toMatchObject({ actorType: "staff", actorId: editor.userId, targetType: "course" });
  });
});
