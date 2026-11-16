import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { flattenSteps } from "@/content/course-utils";
import { resetEnvCache } from "@/env";
import {
  asset,
  auditLog,
  course,
  courseIdea,
  courseVersion,
  reviewDecision,
  reviewTask,
  staffRole,
  step,
  tool,
  user,
} from "@/server/db";
import { getPublishedCourseBySlug, saveRevision } from "@/server/services/course-store";
import { DEV_SEED_NOTE, updateToolFields } from "@/server/services/tools";
import { loadContent } from "../../../scripts/check-content";
import { DEV_SEED_REASON, importContent } from "../../../scripts/import-courses";
import { importIdeas, loadIdeas } from "../../../scripts/import-ideas";
import { closeDb, db, resetDb } from "../../helpers/db";
import { appError, ctxFor, fixtureCourse, staff, systemCtx } from "./helpers";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

const SNAPCHAT = "build-your-own-snapchat-style-app";
const content = loadContent();

/** Everything an import can write, as plain rows, to prove a second run changes nothing. */
async function snapshotOfDatabase() {
  return {
    tools: await db.select().from(tool).orderBy(tool.slug),
    assets: await db.select().from(asset).orderBy(asset.key),
    courses: await db.select().from(course).orderBy(course.slug),
    versions: await db.select().from(courseVersion).orderBy(courseVersion.courseId, courseVersion.revision),
    decisions: await db.select().from(reviewDecision).orderBy(reviewDecision.createdAt),
    tasks: await db.select().from(reviewTask).orderBy(reviewTask.createdAt),
    ideas: await db.select().from(courseIdea).orderBy(courseIdea.ideaKey),
    steps: await db.select().from(step).orderBy(step.courseVersionId, step.key),
    audit: (await db.select({ n: sql<number>`count(*)::int` }).from(auditLog))[0]?.n,
  };
}

describe("content import, default mode", () => {
  it("imports the repo's real content and leaves nothing published", async () => {
    const result = await importContent(systemCtx("content.import"));
    expect(result.problems).toEqual([]);
    expect(result.publishAsSeed).toBe(false);
    expect(result.tools.map((item) => item.slug).sort()).toEqual(
      content.tools.map(({ tool: seed }) => seed.slug).sort(),
    );
    expect(result.courses.map((item) => item.slug)).toContain(SNAPCHAT);

    // Tools: none approved, none with a policy.
    const tools = await db.select().from(tool);
    expect(tools).toHaveLength(content.tools.length);
    for (const row of tools) {
      expect(["pending_verification", "candidate"]).toContain(row.status);
      expect(row).toMatchObject({ under18Policy: null, verifiedBy: null, verifiedAt: null });
    }
    expect(await db.select().from(asset)).toHaveLength(content.assets.length);

    // Courses: hand-made, in review, not published, nothing materialised, no approval records.
    const courses = await db.select().from(course);
    expect(courses).toHaveLength(content.courses.length);
    for (const row of courses) {
      expect(row).toMatchObject({
        origin: "hand_made",
        status: "in_review",
        publishedVersionId: null,
        publishedAt: null,
        createdBy: null,
      });
      expect(await getPublishedCourseBySlug({ db }, row.slug)).toBeNull();
    }
    const versions = await db.select().from(courseVersion);
    expect(versions).toHaveLength(content.courses.length);
    for (const row of versions)
      expect(row).toMatchObject({
        revision: 1,
        status: "in_review",
        publishedAt: null,
        materialisedAt: null,
        lastEditedBy: null,
      });
    expect(await db.select().from(reviewDecision)).toHaveLength(0);
    expect(await db.select().from(step)).toHaveLength(0);
    expect(await db.select().from(reviewTask)).toHaveLength(content.courses.length);
    // No owner account is created in the default mode.
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("is idempotent", async () => {
    await importContent(systemCtx("content.import"));
    const before = await snapshotOfDatabase();
    const again = await importContent(systemCtx("content.import"));
    expect(again.problems).toEqual([]);
    expect(again.tools.every((item) => item.action === "unchanged")).toBe(true);
    expect(again.assets).toMatchObject({ created: [], updated: [] });
    expect(again.courses.every((item) => item.action === "unchanged" && !item.publishedNow)).toBe(true);
    expect(await snapshotOfDatabase()).toEqual(before);
  });

  it("never overwrites a tool or a course a person has edited", async () => {
    await importContent(systemCtx("content.import"));
    const editor = await staff("editor");
    await updateToolFields(ctxFor(editor), "replit", {
      notes: "Read the terms; waiting on a reply from the vendor.",
    });
    const [imported] = await db.select().from(course).where(eq(course.slug, SNAPCHAT));
    if (!imported) throw new Error("course missing");
    const edited = await saveRevision(
      ctxFor(editor),
      imported.id,
      fixtureCourse((c) => (c.title = "Edited in Studio")),
    );

    const again = await importContent(systemCtx("content.import"));
    expect(again.tools.find((item) => item.slug === "replit")?.action).toBe("kept_human_record");
    expect(again.courses.find((item) => item.slug === SNAPCHAT)?.action).toBe("kept_edited");
    const [after] = await db.select().from(course).where(eq(course.slug, SNAPCHAT));
    expect(after?.workingVersionId).toBe(edited.version.id);
    expect(await db.select().from(courseVersion).where(eq(courseVersion.courseId, imported.id))).toHaveLength(
      2,
    );
    expect((await db.select().from(tool).where(eq(tool.slug, "replit")))[0]?.notes).toBe(
      "Read the terms; waiting on a reply from the vendor.",
    );
  });
});

describe("content import with --publish-as-seed", () => {
  const original = { APP_ENV: process.env.APP_ENV, STAFF_2FA_REQUIRED: process.env.STAFF_2FA_REQUIRED };
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
  });

  it("publishes the Snapchat course through a real approval record by the owner", async () => {
    const result = await importContent(systemCtx("content.import"), { publishAsSeed: true });
    expect(result.problems).toEqual([]);
    expect(result.courses.find((item) => item.slug === SNAPCHAT)).toMatchObject({
      action: "created",
      status: "published",
      publishedNow: true,
    });

    // The owner account exists, as staff with super_admin.
    const [owner] = await db.select().from(user).where(eq(user.email, "owner@example.test"));
    expect(owner).toMatchObject({ kind: "staff", status: "active" });
    if (!owner) throw new Error("no owner");
    expect(
      (await db.select().from(staffRole).where(eq(staffRole.userId, owner.id))).map((row) => row.role),
    ).toEqual(["super_admin"]);

    // Tools: approved by the owner, with placeholders labelled in capitals.
    for (const row of await db.select().from(tool)) {
      expect(row).toMatchObject({ status: "approved", under18Policy: "allowed", verifiedBy: owner.id });
      expect(row.notes).toContain(DEV_SEED_NOTE);
    }

    // The course is live, and there is a real decision record behind it.
    const live = await getPublishedCourseBySlug({ db }, SNAPCHAT);
    expect(live?.course).toMatchObject({ status: "published", origin: "hand_made" });
    expect(live?.version.publishedAt).not.toBeNull();
    const decisions = await db
      .select()
      .from(reviewDecision)
      .where(eq(reviewDecision.courseVersionId, live?.version.id ?? ""));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: "approve",
      reviewerId: owner.id,
      reason: DEV_SEED_REASON,
      toolClaimsChecked: true,
      reviewerRoles: ["super_admin"],
      checklistVersion: "1",
    });
    expect(
      await db
        .select()
        .from(step)
        .where(eq(step.courseVersionId, live?.version.id ?? "")),
    ).toHaveLength(flattenSteps(fixtureCourse()).length);

    // The audit log shows the ordinary path: a review approval, then a publish, both by the owner.
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, live?.course.id ?? ""));
    const publish = audit.find((entry) => entry.action === "course.publish");
    expect(publish).toMatchObject({ actorType: "staff", actorId: owner.id, reason: DEV_SEED_REASON });
    expect(publish?.meta).toMatchObject({ via: "manual", approvalDecisionIds: [decisions[0]?.id] });
  });

  it("is idempotent, and also finishes a course that the default import left in review", async () => {
    await importContent(systemCtx("content.import"));
    expect(await getPublishedCourseBySlug({ db }, SNAPCHAT)).toBeNull();

    const seeded = await importContent(systemCtx("content.import"), { publishAsSeed: true });
    expect(seeded.problems).toEqual([]);
    expect(seeded.courses.find((item) => item.slug === SNAPCHAT)).toMatchObject({
      action: "unchanged",
      status: "published",
      publishedNow: true,
    });
    expect(await db.select().from(courseVersion)).toHaveLength(content.courses.length);

    const before = await snapshotOfDatabase();
    const again = await importContent(systemCtx("content.import"), { publishAsSeed: true });
    expect(again.problems).toEqual([]);
    expect(again.tools.every((item) => item.action === "kept_human_record" && !item.devSeedApproved)).toBe(
      true,
    );
    expect(again.courses.every((item) => item.action === "unchanged" && !item.publishedNow)).toBe(true);
    expect(await snapshotOfDatabase()).toEqual(before);
  });

  it("is refused outside local and test, before anything is written", async () => {
    process.env.APP_ENV = "preview";
    process.env.STAFF_2FA_REQUIRED = "true"; // a preview deployment may not relax staff two-step sign-in
    resetEnvCache();
    const error = await appError(() => importContent(systemCtx("content.import"), { publishAsSeed: true }));
    expect(error.code).toBe("forbidden");
    expect(await db.select().from(tool)).toHaveLength(0);
    expect(await db.select().from(course)).toHaveLength(0);
    expect(await db.select().from(user)).toHaveLength(0);
  });
});

describe("ideas import", () => {
  it("imports exactly the 175 ideas in the file, mapped per decisions D5 to D7", async () => {
    const result = await importIdeas(systemCtx("ideas.import"));
    expect(result).toMatchObject({ total: 175, inserted: 175, updated: 0, unchanged: 0, keptEdited: 0 });

    const ideas = await db.select().from(courseIdea);
    expect(ideas).toHaveLength(175);
    const by = (difficulty: string) => ideas.filter((idea) => idea.difficulty === difficulty).length;
    expect({ starter: by("starter"), builder: by("builder"), pro: by("pro") }).toEqual({
      starter: 52,
      builder: 92,
      pro: 31,
    });
    expect(new Set(ideas.map((idea) => idea.category)).size).toBe(24);
    for (const idea of ideas) expect(idea).toMatchObject({ status: "idea", pathways: [], courseId: null });

    const idea = (key: string) => {
      const found = ideas.find((item) => item.ideaKey === key);
      if (!found) throw new Error(`no ${key}`);
      return found;
    };
    // D6: a watch note that mentions "tools 18+" sets the flag, on top of the 36 the file already flags.
    expect(idea("IDEA-141").flags).toMatchObject({ age18Tools: true, safeguarding: true });
    expect(idea("IDEA-154").flags).toMatchObject({ age18Tools: true, safeguarding: true });
    expect(ideas.filter((item) => item.flags.age18Tools)).toHaveLength(38);
    expect(ideas.filter((item) => item.flags.safeguarding)).toHaveLength(20);
    // "trading 18+" and "betting (18+)" are not about tools.
    expect(idea("IDEA-144").flags.age18Tools).toBe(false);
    expect(idea("IDEA-169").flags.age18Tools).toBe(false);
    // D5: exam integrity comes from the watch note.
    expect(
      ideas
        .filter((item) => item.flags.examIntegrity)
        .map((item) => item.ideaKey)
        .sort(),
    ).toEqual(["IDEA-018", "IDEA-099"]);
    // D7: the course table wins for Portfolio and CV Studio.
    expect(idea("IDEA-157").minAge).toBe(15);
    expect(ideas.filter((item) => item.minAge !== 13).map((item) => item.ideaKey)).toEqual(["IDEA-157"]);

    expect(idea("IDEA-001")).toMatchObject({
      title: "Build Your Own Snapchat-Style App",
      category: "apps-websites",
      difficulty: "builder",
      summary:
        "Make a web app with photo capture, playful filters and short messages, using AI coding tools as your pair programmer.",
      careers: "Software development, product design",
      watchNote: null,
      suggestedForLaunch: true,
    });
    expect(ideas.filter((item) => item.suggestedForLaunch)).toHaveLength(15);
  });

  it("is idempotent and never overwrites an idea that was changed after import", async () => {
    await importIdeas(systemCtx("ideas.import"));
    const editor = await staff("editor");
    await db
      .update(courseIdea)
      .set({ title: "Chris's better title", createdBy: editor.userId })
      .where(eq(courseIdea.ideaKey, "IDEA-002"));
    const before = await db.select().from(courseIdea).orderBy(courseIdea.ideaKey);

    const again = await importIdeas(systemCtx("ideas.import"));
    expect(again).toMatchObject({ total: 175, inserted: 0, updated: 0, unchanged: 174, keptEdited: 1 });
    expect(await db.select().from(courseIdea).orderBy(courseIdea.ideaKey)).toEqual(before);
    expect((await db.select().from(courseIdea).where(eq(courseIdea.ideaKey, "IDEA-002")))[0]?.title).toBe(
      "Chris's better title",
    );
  });

  it("refreshes an untouched idea when the file changes, and keeps it refreshable", async () => {
    await importIdeas(systemCtx("ideas.import"));
    // Pretend the file said something different when the idea was first imported.
    await db
      .update(courseIdea)
      .set({ summary: "Old summary", updatedAt: sql`${courseIdea.createdAt}` })
      .where(eq(courseIdea.ideaKey, "IDEA-003"));
    const result = await importIdeas(systemCtx("ideas.import"));
    expect(result).toMatchObject({ updated: 1, unchanged: 174, keptEdited: 0 });
    const [row] = await db.select().from(courseIdea).where(eq(courseIdea.ideaKey, "IDEA-003"));
    expect(row?.summary).not.toBe("Old summary");
    expect(row?.updatedAt).toEqual(row?.createdAt);
    expect(await importIdeas(systemCtx("ideas.import"))).toMatchObject({ updated: 0, unchanged: 175 });
  });

  it("does not invent ideas: the rows are exactly the ids in the file", async () => {
    await importIdeas(systemCtx("ideas.import"));
    const keys = (await db.select({ key: courseIdea.ideaKey }).from(courseIdea)).map((row) => row.key).sort();
    expect(keys).toEqual(
      loadIdeas()
        .map((idea) => idea.ideaKey)
        .sort(),
    );
    expect(keys[0]).toBe("IDEA-001");
    expect(keys[174]).toBe("IDEA-175");
  });

  it("is refused for anyone who may not manage ideas", async () => {
    const reviewer = await staff("reviewer");
    expect((await appError(() => importIdeas(ctxFor(reviewer)))).code).toBe("forbidden");
    expect(await db.select().from(courseIdea)).toHaveLength(0);
  });

  it("links the launch idea to its course in either import order, and publishing marks it published", async () => {
    // Ideas first, then courses.
    await importIdeas(systemCtx("ideas.import"));
    await importContent(systemCtx("content.import"));
    let [idea] = await db.select().from(courseIdea).where(eq(courseIdea.ideaKey, "IDEA-001"));
    const [imported] = await db.select().from(course).where(eq(course.slug, SNAPCHAT));
    expect(imported?.sourceIdeaId).toBe(idea?.id);
    expect(idea).toMatchObject({ status: "drafted", courseId: imported?.id });

    await importContent(systemCtx("content.import"), { publishAsSeed: true });
    [idea] = await db.select().from(courseIdea).where(eq(courseIdea.ideaKey, "IDEA-001"));
    expect(idea?.status).toBe("published");

    // Courses first, then ideas.
    await resetDb();
    await importContent(systemCtx("content.import"), { publishAsSeed: true });
    const later = await importIdeas(systemCtx("ideas.import"));
    expect(later.linked).toBeGreaterThanOrEqual(1);
    [idea] = await db.select().from(courseIdea).where(eq(courseIdea.ideaKey, "IDEA-001"));
    expect(idea?.status).toBe("published");
    expect((await db.select().from(courseIdea).where(eq(courseIdea.status, "published"))).length).toBe(
      later.linked,
    );
  });
});
