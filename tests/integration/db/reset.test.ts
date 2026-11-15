import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditLog,
  certificate,
  consentRecord,
  course,
  courseModule,
  courseTool,
  courseVersion,
  creditLedger,
  enrolment,
  lesson,
  plan,
  project,
  projectVersion,
  reviewDecision,
  safeguardingAccessLog,
  safeguardingCase,
  step,
  stepProgress,
  subscription,
  tool,
} from "@/server/db/schema";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff, recordConsent } from "../../helpers/factories";

afterAll(async () => {
  await closeDb();
});

async function nonEmptyTables(): Promise<string[]> {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const found: string[] = [];
  for (const { tablename } of tables) {
    const rows = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${tablename}"`));
    if ((rows[0]?.n ?? 0) > 0) found.push(tablename);
  }
  return found.sort();
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row;
}

describe("resetDb", () => {
  it("empties every table, including append-only ones and rows held together by RESTRICT keys", async () => {
    await resetDb();

    // A deliberately tangled set of rows: circular pointers, RESTRICT keys and append-only tables.
    const { family, parent } = await createFamily();
    const learner = await createLearner({ familyId: family.id });
    const staff = await createStaff({ roles: ["dsl", "reviewer"] });

    const aTool = one(await db.insert(tool).values({ slug: "replit", name: "Replit" }).returning());
    const aCourse = one(await db.insert(course).values({ slug: "c1", title: "Course one" }).returning());
    const version = one(
      await db.insert(courseVersion).values({ courseId: aCourse.id, revision: 1, snapshot: {} }).returning(),
    );
    await db.update(course).set({ publishedVersionId: version.id, workingVersionId: version.id });
    await db.update(courseVersion).set({ status: "published", publishedAt: new Date() });
    const aModule = one(
      await db
        .insert(courseModule)
        .values({ courseVersionId: version.id, key: "m1", title: "Module", position: 1 })
        .returning(),
    );
    const aLesson = one(
      await db
        .insert(lesson)
        .values({
          courseVersionId: version.id,
          moduleId: aModule.id,
          key: "l1",
          title: "Lesson",
          position: 1,
        })
        .returning(),
    );
    const aStep = one(
      await db
        .insert(step)
        .values({
          courseVersionId: version.id,
          lessonId: aLesson.id,
          key: "s1",
          type: "read",
          title: "Step",
          position: 1,
          completionRule: "view",
        })
        .returning(),
    );
    await db
      .insert(courseTool)
      .values({ courseVersionId: version.id, courseId: aCourse.id, toolId: aTool.id, purpose: "Build" });
    await db.insert(reviewDecision).values({
      courseId: aCourse.id,
      courseVersionId: version.id,
      reviewerId: staff.user.id,
      decision: "approve",
      toolClaimsChecked: true,
    });

    const anEnrolment = one(
      await db
        .insert(enrolment)
        .values({
          learnerId: learner.user.id,
          courseId: aCourse.id,
          courseVersionId: version.id,
          currentStepId: aStep.id,
        })
        .returning(),
    );
    await db
      .insert(stepProgress)
      .values({ enrolmentId: anEnrolment.id, learnerId: learner.user.id, stepId: aStep.id });
    const aProject = one(
      await db
        .insert(project)
        .values({
          learnerId: learner.user.id,
          enrolmentId: anEnrolment.id,
          courseId: aCourse.id,
          title: "My app",
        })
        .returning(),
    );
    const submission = one(
      await db
        .insert(projectVersion)
        .values({ projectId: aProject.id, learnerId: learner.user.id, version: 1 })
        .returning(),
    );
    await db.update(project).set({ currentVersionId: submission.id });
    await db.insert(certificate).values({
      learnerId: learner.user.id,
      enrolmentId: anEnrolment.id,
      courseId: aCourse.id,
      courseVersionId: version.id,
      verifyCode: "VERIFY-TEST",
      displayName: "Maya",
      courseTitle: "Course one",
    });

    const aPlan = one(await db.insert(plan).values({ key: "family", name: "Family", seats: 4 }).returning());
    await db.insert(subscription).values({ familyId: family.id, planId: aPlan.id, status: "active" });

    const aCase = one(
      await db
        .insert(safeguardingCase)
        .values({ learnerId: learner.user.id, severity: "low", trigger: "manual", isTest: true })
        .returning(),
    );
    await db
      .insert(safeguardingAccessLog)
      .values({ caseId: aCase.id, staffUserId: staff.user.id, action: "view_notes", reason: "Test" });

    await recordConsent({ learnerId: learner.user.id, actorUserId: parent.id, consentKey: "ai_processing" });
    await db.insert(creditLedger).values({
      learnerId: learner.user.id,
      entryType: "grant",
      amount: 50,
      periodKey: "2026-11",
      idempotencyKey: "reset-test",
    });
    await db
      .insert(auditLog)
      .values({ actorType: "staff", actorId: staff.user.id, action: "course.publish" });

    expect((await nonEmptyTables()).length).toBeGreaterThan(20);
    expect((await db.select().from(consentRecord)).length).toBe(1);

    await resetDb();

    expect(await nonEmptyTables()).toEqual([]);
  });

  it("is safe to call on an already empty database", async () => {
    await resetDb();
    await resetDb();
    expect(await nonEmptyTables()).toEqual([]);
  });
});

describe("testCtx", () => {
  it("is anonymous by default and carries the given actor and overrides", async () => {
    const anonymous = testCtx();
    expect(anonymous.actor).toEqual({ type: "anonymous" });
    expect(anonymous.requestId).toMatch(/^test-/);
    expect(anonymous.now).toBeInstanceOf(Date);

    const pinned = new Date("2027-01-01T09:00:00Z");
    const ctx = testCtx({ type: "system", job: "retention.sweep" }, { now: pinned, ip: undefined });
    expect(ctx.actor).toEqual({ type: "system", job: "retention.sweep" });
    expect(ctx.now).toBe(pinned);
    expect(ctx.ip).toBeUndefined();
    // It is a working database handle.
    const rows = await ctx.db.execute<{ one: number }>(sql`select 1 as one`);
    expect(rows[0]?.one).toBe(1);
  });
});
