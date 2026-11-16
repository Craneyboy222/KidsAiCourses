import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { flattenSteps } from "@/content/course-utils";
import { QA_CHECKLIST } from "@/content/validate";
import { ANONYMOUS, systemActor } from "@/server/authz";
import {
  auditLog,
  course,
  courseIdea,
  courseVersion,
  enrolment,
  jobRun,
  publishSchedule,
  reviewComment,
  reviewDecision,
  reviewTask,
  staffRole,
  step,
  toolGuide,
} from "@/server/db";
import {
  createCourse,
  getPublishedCourseBySlug,
  saveRevision,
  type StoredValidation,
} from "@/server/services/course-store";
import {
  clearNeedsReview,
  disableStep,
  enableStep,
  getApprovalState,
  markNeedsReview,
  publishDueSchedulesJob,
  publishJobs,
  publishVersion,
  recordDecision,
  SAFETY_CHECKLIST_KEYS,
  restoreCourse,
  retireCourse,
  runDuePublishSchedules,
  scheduleVersion,
  submitForReview,
  takeDownCourse,
  unpublishCourse,
} from "@/server/services/publish";
import { runJob } from "@/server/jobs/define";
import { setSetting } from "@/server/settings";
import { approveTool, blockTool, updateToolFields } from "@/server/services/tools";
import { closeDb, db, resetDb } from "../../helpers/db";
import { createFamily, createLearner } from "../../helpers/factories";
import {
  appError,
  approval,
  approvedCourse,
  auditActions,
  ctxFor,
  draftInReview,
  fixtureCourse,
  fullChecklist,
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

const SLUG = "build-your-own-snapchat-style-app";
const STEP_COUNT = flattenSteps(fixtureCourse()).length;
const isLive = async (): Promise<boolean> => (await getPublishedCourseBySlug({ db }, SLUG)) !== null;

async function requireSecondReviewer(scope: "ai_drafts" | "all_courses"): Promise<void> {
  const admin = await staff("admin");
  await setSetting(ctxFor(admin), "review.require_second_reviewer_for_ai_drafts", true);
  await setSetting(ctxFor(admin), "review.second_reviewer_scope", scope);
}

/** Removes the privacy step from the Replit guide: the one error the validator lets a reviewer waive. */
const incompleteGuide = (c: ReturnType<typeof fixtureCourse>): void => {
  const guide = c.setupGuides.find((item) => item.toolSlug === "replit");
  if (!guide) throw new Error("no replit guide");
  guide.steps = guide.steps.filter((item) => item.kind !== "privacy_settings");
  for (const mod of c.modules) {
    for (const item of mod.lessons) {
      for (const entry of item.steps) {
        const through = entry.config?.throughStepIds;
        if (Array.isArray(through))
          entry.config = {
            ...entry.config,
            throughStepIds: through.filter((id) => guide.steps.some((s) => s.id === id)),
          };
      }
    }
  }
};

describe("submitForReview", () => {
  it("creates a review task and moves the draft to in_review", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { course: created } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    const submitted = await submitForReview(ctxFor(editor), created.id);

    expect(submitted.version.status).toBe("in_review");
    expect(submitted.course.status).toBe("in_review");
    expect(submitted.task).toMatchObject({
      kind: "course_review",
      status: "open",
      courseId: created.id,
      courseVersionId: submitted.version.id,
      createdBy: editor.userId,
    });
    expect(await isLive()).toBe(false);

    // Submitting again returns the same task.
    const again = await submitForReview(ctxFor(editor), created.id);
    expect(again.task.id).toBe(submitted.task.id);
    expect(await db.select().from(reviewTask)).toHaveLength(1);
  });

  it("is refused for a reviewer-only account and for a learner", async () => {
    await setUpRegister();
    const { course: created } = await createCourse(ctxFor(await staff("editor")), fixtureCourse(), {
      origin: "hand_made",
    });
    const learner = await createLearner();
    for (const actor of [await staff("reviewer"), learner.actor, ANONYMOUS]) {
      const error = await appError(() => submitForReview(ctxFor(actor), created.id));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
  });
});

describe("recordDecision", () => {
  it("records who decided, with their roles, the checklist version and the last-editor flag", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const draft = await draftInReview(owner);
    const result = await recordDecision(
      ctxFor(owner),
      draft.version.id,
      approval({ comment: "Looks right against the live tool." }),
    );

    expect(result.decision).toMatchObject({
      decision: "approve",
      reviewerId: owner.userId,
      courseVersionId: draft.version.id,
      reviewerRoles: ["super_admin"],
      reviewerWasLastEditor: true,
      toolClaimsChecked: true,
      checklistVersion: "1",
      checklist: fullChecklist(),
    });
    expect(result.evaluation.approved).toBe(true);
    expect(result.evaluation.warnings.join(" ")).toMatch(/also the last person who edited/);
    expect(result.version.status).toBe("approved");
    expect((await db.select().from(reviewComment))[0]).toMatchObject({
      body: "Looks right against the live tool.",
      authorId: owner.userId,
    });
    expect((await db.select().from(reviewTask))[0]?.status).toBe("done");
    expect(await auditActions()).toContain("course.review.approve");
    // Approved is not published.
    expect(await isLive()).toBe(false);
  });

  it("refuses the system actor, a learner, an editor and a signed-out visitor", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const draft = await draftInReview(editor);
    const learner = await createLearner();
    for (const actor of [systemActor("publish.schedule"), learner.actor, editor, ANONYMOUS]) {
      const error = await appError(() => recordDecision(ctxFor(actor), draft.version.id, approval()));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await db.select().from(reviewDecision)).toHaveLength(0);
  });

  it("refuses staff who have not passed the second factor", async () => {
    await setUpRegister();
    const draft = await draftInReview(await staff("editor"));
    const reviewer = { ...(await staff("reviewer")), twoFactorVerified: false };
    expect((await appError(() => recordDecision(ctxFor(reviewer), draft.version.id, approval()))).code).toBe(
      "two_factor_required",
    );
  });

  it("an approval must answer every checklist item, with no failures and no unknown items", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));

    const { accuracy_live_tool: _dropped, ...incomplete } = fullChecklist();
    const missing = await appError(() =>
      recordDecision(ctxFor(reviewer), draft.version.id, approval({ checklist: incomplete })),
    );
    expect(missing.code).toBe("invalid_input");
    expect(missing.fieldErrors).toHaveProperty("accuracy_live_tool");

    const failed = await appError(() =>
      recordDecision(
        ctxFor(reviewer),
        draft.version.id,
        approval({ checklist: { ...fullChecklist(), licensed_assets: "fail" } }),
      ),
    );
    expect(failed.fieldErrors).toHaveProperty("licensed_assets");

    const unknown = await appError(() =>
      recordDecision(
        ctxFor(reviewer),
        draft.version.id,
        approval({ checklist: { ...fullChecklist(), made_up_item: "pass" } }),
      ),
    );
    expect(unknown.fieldErrors).toHaveProperty("made_up_item");
    expect(await db.select().from(reviewDecision)).toHaveLength(0);
  });

  it("the safety items need an explicit pass on an approval: not applicable is refused", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));

    // The constant names real checklist items, and exactly the safety ones.
    const keys = QA_CHECKLIST.items.map((item) => item.key);
    expect([...SAFETY_CHECKLIST_KEYS].sort()).toEqual(keys.filter((key) => key.startsWith("safety_")).sort());
    expect(SAFETY_CHECKLIST_KEYS).toHaveLength(3);

    for (const key of SAFETY_CHECKLIST_KEYS) {
      const error = await appError(() =>
        recordDecision(
          ctxFor(reviewer),
          draft.version.id,
          approval({ checklist: { ...fullChecklist(), [key]: "not_applicable" } }),
        ),
      );
      expect(error.code).toBe("invalid_input");
      expect(Object.keys(error.fieldErrors ?? {})).toEqual([key]);
      expect(error.fieldErrors?.[key]?.[0]).toMatch(/safety check/);
    }
    expect(await db.select().from(reviewDecision)).toHaveLength(0);

    // Any other item may be not applicable, and an approval with every safety item passed is recorded.
    const others = Object.fromEntries(
      keys.map((key) => [
        key,
        (SAFETY_CHECKLIST_KEYS as readonly string[]).includes(key) ? "pass" : "not_applicable",
      ]),
    );
    const recorded = await recordDecision(
      ctxFor(reviewer),
      draft.version.id,
      approval({ checklist: others as ReturnType<typeof fullChecklist> }),
    );
    expect(recorded.evaluation.approved).toBe(true);

    // Asking for edits may record a safety item as it was found.
    const second = await draftInReview(await staff("editor"), (c) => (c.slug = "another-course"));
    const asked = await recordDecision(ctxFor(reviewer), second.version.id, {
      kind: "request_edits",
      checklist: { safety_ethics_checkpoint: "not_applicable" },
      toolClaimsChecked: false,
      reason: "The ethics checkpoint is a tick box. Make it a real question.",
    });
    expect(asked.decision.checklist).toEqual({ safety_ethics_checkpoint: "not_applicable" });
  });

  it("an approval of a course that uses an external tool must confirm tool claims were checked", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));
    const error = await appError(() =>
      recordDecision(ctxFor(reviewer), draft.version.id, approval({ toolClaimsChecked: false })),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.fieldErrors).toHaveProperty("toolClaimsChecked");
  });

  it("a version with validation errors cannot be approved", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"), (c) => {
      for (const mod of c.modules)
        for (const item of mod.lessons)
          item.steps = item.steps.filter((entry) => entry.type !== "ethics_checkpoint");
    });
    const error = await appError(() => recordDecision(ctxFor(reviewer), draft.version.id, approval()));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/ethics checkpoint/i);
    expect(await db.select().from(reviewDecision)).toHaveLength(0);
  });

  it("a hand-made draft must be submitted before it can be decided on", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const { version } = await createCourse(ctxFor(editor), fixtureCourse(), { origin: "hand_made" });
    const reviewer = await staff("reviewer");
    expect((await appError(() => recordDecision(ctxFor(reviewer), version.id, approval()))).code).toBe(
      "conflict",
    );
  });

  it("declining and asking for edits need a reason, and block the version", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));
    expect(
      (
        await appError(() =>
          recordDecision(ctxFor(reviewer), draft.version.id, {
            kind: "decline",
            checklist: {},
            toolClaimsChecked: false,
          }),
        )
      ).code,
    ).toBe("invalid_input");

    const asked = await recordDecision(ctxFor(reviewer), draft.version.id, {
      kind: "request_edits",
      checklist: { british_english_teen_voice: "fail" },
      toolClaimsChecked: false,
      reason: "Shorten module 2.",
    });
    expect(asked.version.status).toBe("changes_requested");
    expect(asked.evaluation.approved).toBe(false);
    expect((await readCourse(draft.course.id)).course.status).toBe("changes_requested");

    // The version is finished with: a later approval of the same version is refused.
    const admin = await staff("admin");
    expect((await appError(() => recordDecision(ctxFor(admin), draft.version.id, approval()))).code).toBe(
      "conflict",
    );
    expect((await appError(() => publishVersion(ctxFor(reviewer), draft.version.id))).code).toBe(
      "approval_required",
    );
  });
});

describe("publishVersion", () => {
  it("refuses a version with no approval record, naming what is missing", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const draft = await draftInReview(owner);
    const error = await appError(() => publishVersion(ctxFor(owner), draft.version.id));
    expect(error.code).toBe("approval_required");
    expect(error.message).toMatch(/No human approval is recorded/);
    expect(await isLive()).toBe(false);
    expect((await readVersion(draft.version.id)).publishedAt).toBeNull();
    expect(await db.select().from(step)).toHaveLength(0);
  });

  it("refuses a plain draft that was never submitted", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const { version } = await createCourse(ctxFor(owner), fixtureCourse(), { origin: "hand_made" });
    expect((await appError(() => publishVersion(ctxFor(owner), version.id))).code).toBe("approval_required");
  });

  it("refuses the system actor, even for a fully approved version", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(await staff("editor"), reviewer);
    const error = await appError(() => publishVersion(systemCtx("some.job"), approved.version.id));
    expect(error.code).toBe("forbidden");
    expect(await isLive()).toBe(false);

    const learner = await createLearner();
    for (const actor of [learner.actor, ANONYMOUS, await staff("editor"), await staff("moderator")]) {
      const refused = await appError(() => publishVersion(ctxFor(actor), approved.version.id));
      expect(["forbidden", "unauthenticated"]).toContain(refused.code);
    }
    expect(await isLive()).toBe(false);
  });

  it("refuses when validation has errors, even if an approval row exists", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"), (c) => {
      for (const mod of c.modules)
        for (const item of mod.lessons)
          item.steps = item.steps.filter((entry) => entry.type !== "checkpoint");
    });
    // The service would never record this approval. Insert it directly to prove publish checks for itself.
    await db.insert(reviewDecision).values({
      courseId: draft.course.id,
      courseVersionId: draft.version.id,
      reviewerId: reviewer.userId,
      decision: "approve",
      checklist: fullChecklist(),
      toolClaimsChecked: true,
      reviewerRoles: ["reviewer"],
    });
    const error = await appError(() => publishVersion(ctxFor(reviewer), draft.version.id));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/checkpoint/i);
    expect(await isLive()).toBe(false);
    expect(await db.select().from(step)).toHaveLength(0);
  });

  it("a recorded waiver allows the waivable setup-guide rule, and only that rule", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"), incompleteGuide);
    const stored = (await readVersion(draft.version.id)).validation as unknown as StoredValidation;
    const guideIssue = stored.issues.find((issue) => issue.code === "setup_guide_incomplete");
    expect(guideIssue).toMatchObject({ severity: "error", waivable: true, waiverKey: "setup_guide:replit" });

    // Without a waiver it cannot be approved.
    expect((await appError(() => recordDecision(ctxFor(reviewer), draft.version.id, approval()))).code).toBe(
      "validation_failed",
    );
    // A waiver needs a reason, and only checks the validator marks as waivable are accepted.
    for (const waivers of [
      [{ check: "setup_guide:replit", reason: "  " }],
      [{ check: "ethics_checkpoint_missing", reason: "We'll add it later" }],
      [{ check: "setup_guide:canva", reason: "Not a tool this course has a guide problem with" }],
      [{ check: "tool_blocked", reason: "It's fine" }],
    ]) {
      expect(
        (await appError(() => recordDecision(ctxFor(reviewer), draft.version.id, approval({ waivers }))))
          .code,
      ).toBe("invalid_input");
    }
    // A waiver cannot ride on a decline.
    expect(
      (
        await appError(() =>
          recordDecision(ctxFor(reviewer), draft.version.id, {
            kind: "decline",
            checklist: {},
            toolClaimsChecked: false,
            reason: "No",
            waivers: [{ check: "setup_guide:replit", reason: "x" }],
          }),
        )
      ).code,
    ).toBe("invalid_input");
    expect(await db.select().from(reviewDecision)).toHaveLength(0);

    const waiver = {
      check: "setup_guide:replit",
      reason: "Replit has no separate privacy screen on the free plan; checked today.",
    };
    const approved = await recordDecision(
      ctxFor(reviewer),
      draft.version.id,
      approval({ waivers: [waiver] }),
    );
    expect(approved.decision.waivers).toEqual([waiver]);
    expect(approved.evaluation.approved).toBe(true);
    const waiverAudit = await db.select().from(auditLog).where(eq(auditLog.action, "course.review.waiver"));
    expect(waiverAudit).toHaveLength(1);
    expect(waiverAudit[0]).toMatchObject({
      actorId: reviewer.userId,
      reason: waiver.reason,
      meta: expect.objectContaining({ check: "setup_guide:replit" }),
    });

    const published = await publishVersion(ctxFor(reviewer), draft.version.id);
    expect(published.version.status).toBe("published");
    const validation = published.version.validation as unknown as StoredValidation | null;
    expect((await readVersion(draft.version.id)).validation).toMatchObject({
      ok: true,
      waivers: ["setup_guide:replit"],
    });
    expect(validation).not.toBeNull();
    const [guide] = await db.select().from(toolGuide);
    expect(guide?.waiver).toMatchObject({
      check: "setup_guide:replit",
      sections: ["privacy_settings"],
      reviewerId: reviewer.userId,
      reason: waiver.reason,
    });
  });

  it("a waiver does not cover a second, unwaivable error", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"), (c) => {
      incompleteGuide(c);
      for (const mod of c.modules)
        for (const item of mod.lessons)
          item.steps = item.steps.filter((entry) => entry.type !== "ethics_checkpoint");
    });
    const error = await appError(() =>
      recordDecision(
        ctxFor(reviewer),
        draft.version.id,
        approval({ waivers: [{ check: "setup_guide:replit", reason: "Checked." }] }),
      ),
    );
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/ethics checkpoint/i);
    expect(error.message).not.toMatch(/setup guide for/i);
  });

  it("refuses when a required tool is no longer approved and has no approved fallback", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);

    // After approval, the Register changes: Replit's terms are edited (back to pending) and Base44 is blocked.
    const reset = await updateToolFields(ctxFor(editor), "replit", { minAge: 16 });
    expect(reset.verificationReset).toBe(true);
    await blockTool(ctxFor(editor), "base44", "Vendor now says 18+ only");

    const error = await appError(() => publishVersion(ctxFor(reviewer), approved.version.id));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/replit/);
    expect(await isLive()).toBe(false);

    // Approving the fallback is not enough either: the course would now depend on Base44, which has no setup guide.
    await approveTool(ctxFor(reviewer), "base44", {
      under18Policy: "allowed",
      minAge: 13,
      evidenceChecked: true,
    });
    const fallback = await appError(() => publishVersion(ctxFor(reviewer), approved.version.id));
    expect(fallback.code).toBe("validation_failed");
    expect(fallback.message).toMatch(/"base44" has no setup guide/);
    expect(await isLive()).toBe(false);

    // Once a person approves Replit again, the approval recorded for this version is still good.
    await approveTool(ctxFor(reviewer), "replit", {
      under18Policy: "allowed",
      minAge: 13,
      evidenceChecked: true,
    });
    const published = await publishVersion(ctxFor(reviewer), approved.version.id);
    expect(published.alreadyPublished).toBe(false);
    expect(await isLive()).toBe(true);
  });

  it("refuses when the tool's minimum age is above the course's, unless a parent runs the account", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(await staff("editor"), reviewer);
    // The vendor's terms turn out to be 16+, and the course is open from 13.
    await approveTool(ctxFor(reviewer), "replit", {
      under18Policy: "allowed",
      minAge: 16,
      evidenceChecked: true,
    });
    const error = await appError(() => publishVersion(ctxFor(reviewer), approved.version.id));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/"replit" is for ages 16 and over/);
    expect(await isLive()).toBe(false);

    // A parent-operated account is the parent's, so the learner's age is not the vendor's concern.
    await approveTool(ctxFor(reviewer), "replit", {
      under18Policy: "parent_operated",
      minAge: 18,
      evidenceChecked: true,
      parentOperatedAllowed: true,
    });
    await publishVersion(ctxFor(reviewer), approved.version.id);
    expect(await isLive()).toBe(true);
  });

  it("refuses when the Register has never approved the tool (unverified)", async () => {
    await setUpRegister({ approve: [] });
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));
    expect((await appError(() => recordDecision(ctxFor(reviewer), draft.version.id, approval()))).code).toBe(
      "validation_failed",
    );
    await db.insert(reviewDecision).values({
      courseId: draft.course.id,
      courseVersionId: draft.version.id,
      reviewerId: reviewer.userId,
      decision: "approve",
      toolClaimsChecked: true,
      reviewerRoles: ["reviewer"],
    });
    const error = await appError(() => publishVersion(ctxFor(reviewer), draft.version.id));
    expect(error.code).toBe("validation_failed");
    expect(error.message).toMatch(/no under-18 policy recorded/);
  });

  it("publishes with one human approval when the setting is off, in one go", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const [idea] = await db
      .insert(courseIdea)
      .values({
        ideaKey: "IDEA-001",
        title: "Build Your Own Snapchat-Style App",
        summary: "s",
        category: "apps-websites",
        difficulty: "builder",
      })
      .returning();
    if (!idea) throw new Error("no idea");
    const created = await createCourse(ctxFor(owner), fixtureCourse(), {
      origin: "hand_made",
      ideaId: idea.id,
    });
    expect((await db.select().from(courseIdea))[0]).toMatchObject({
      status: "drafted",
      courseId: created.course.id,
    });
    await submitForReview(ctxFor(owner), created.course.id);
    await recordDecision(ctxFor(owner), created.version.id, approval());

    const publishCtx = ctxFor(owner);
    const result = await publishVersion(publishCtx, created.version.id, { reason: "Launch" });

    expect(result.alreadyPublished).toBe(false);
    expect(result.version).toMatchObject({ status: "published", publishedAt: publishCtx.now });
    expect(result.course).toMatchObject({
      status: "published",
      publishedVersionId: created.version.id,
      workingVersionId: created.version.id,
      publishedAt: publishCtx.now,
      title: "Build Your Own Snapchat-Style App",
      category: "apps-websites",
      difficulty: "builder",
      minAge: 13,
      isFree: false,
      toolSlugs: ["replit"],
      safeguardingSensitive: false,
    });
    expect(result.stepIds.size).toBe(STEP_COUNT);
    expect(await db.select().from(step)).toHaveLength(STEP_COUNT);
    expect((await readVersion(created.version.id)).materialisedAt).not.toBeNull();
    expect((await db.select().from(courseIdea))[0]).toMatchObject({
      status: "published",
      courseId: created.course.id,
    });

    const live = await getPublishedCourseBySlug({ db }, SLUG);
    expect(live?.version.id).toBe(created.version.id);

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "course.publish"));
    expect(entry).toMatchObject({
      actorType: "staff",
      actorId: owner.userId,
      targetId: created.course.id,
      reason: "Launch",
    });
    expect(entry?.meta).toMatchObject({
      versionId: created.version.id,
      via: "manual",
      approverIds: [owner.userId],
    });
  });

  it("publishing twice is a no-op", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(await staff("editor"), reviewer);
    const first = await publishVersion(ctxFor(reviewer), approved.version.id);
    const before = await readCourse(approved.course.id);
    const stepsBefore = await db.select().from(step);

    const second = await publishVersion(ctxFor(reviewer), approved.version.id);
    expect(second.alreadyPublished).toBe(true);
    expect(second.version.publishedAt).toEqual(first.version.publishedAt);
    expect(await readCourse(approved.course.id)).toEqual(before);
    expect(await db.select().from(step)).toEqual(stepsBefore);
    expect((await auditActions()).filter((action) => action === "course.publish")).toHaveLength(1);
  });

  it("enforces two different people when the setting is on", async () => {
    await setUpRegister();
    await requireSecondReviewer("all_courses");
    const owner = await staff("super_admin");
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(owner);

    const first = await recordDecision(ctxFor(owner), draft.version.id, approval());
    expect(first.evaluation.approved).toBe(false);
    expect(first.version.status).toBe("in_review");
    const alone = await appError(() => publishVersion(ctxFor(owner), draft.version.id));
    expect(alone.code).toBe("approval_required");
    expect(alone.message).toMatch(/Two different people must approve/);
    expect(alone.message).toMatch(/last editor cannot be the only approver/);

    // The same person approving again changes nothing.
    await recordDecision(ctxFor(owner), draft.version.id, approval());
    expect((await appError(() => publishVersion(ctxFor(owner), draft.version.id))).code).toBe(
      "approval_required",
    );
    expect(await isLive()).toBe(false);

    const second = await recordDecision(ctxFor(reviewer), draft.version.id, approval());
    expect(second.evaluation.approved).toBe(true);
    expect(second.version.status).toBe("approved");
    await publishVersion(ctxFor(owner), draft.version.id);
    expect(await isLive()).toBe(true);
  });

  it("scope ai_drafts: an AI draft needs two people, a hand-made course does not", async () => {
    await setUpRegister();
    await requireSecondReviewer("ai_drafts");
    const owner = await staff("super_admin");

    const ai = await createCourse(
      systemCtx("draft.generate"),
      fixtureCourse((c) => (c.slug = "ai-drafted-course")),
      { origin: "ai_on_demand" },
    );
    expect(ai.version.status).toBe("ai_draft");
    // An AI draft is reviewable straight away.
    const one = await recordDecision(ctxFor(owner), ai.version.id, approval());
    expect(one.evaluation.approved).toBe(false);
    expect((await appError(() => publishVersion(ctxFor(owner), ai.version.id))).code).toBe(
      "approval_required",
    );

    const handMade = await draftInReview(owner);
    await recordDecision(ctxFor(owner), handMade.version.id, approval());
    expect((await publishVersion(ctxFor(owner), handMade.version.id)).alreadyPublished).toBe(false);
  });

  it("a safeguarding-sensitive course: one person must confirm; with the setting on a safety reviewer is needed", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const sensitive = (c: ReturnType<typeof fixtureCourse>) => {
      c.safeguardingSensitive = true;
    };
    const draft = await draftInReview(owner, sensitive);
    const unconfirmed = await recordDecision(ctxFor(owner), draft.version.id, approval());
    expect(unconfirmed.evaluation.approved).toBe(false);
    expect(unconfirmed.evaluation.missing.join(" ")).toMatch(/must confirm that they are approving it alone/);
    expect((await appError(() => publishVersion(ctxFor(owner), draft.version.id))).code).toBe(
      "approval_required",
    );

    const confirmed = await recordDecision(
      ctxFor(owner),
      draft.version.id,
      approval({ confirmedSafeguardingSoloApproval: true }),
    );
    expect(confirmed.evaluation.approved).toBe(true);
    expect(confirmed.decision.safeguardingSensitiveConfirmed).toBe(true);

    // Turn the setting on before publishing: the rule in force at publish time is the one that counts.
    await requireSecondReviewer("all_courses");
    const blocked = await appError(() => publishVersion(ctxFor(owner), draft.version.id));
    expect(blocked.code).toBe("approval_required");
    await recordDecision(ctxFor(await staff("reviewer")), draft.version.id, approval());
    expect((await appError(() => publishVersion(ctxFor(owner), draft.version.id))).message).toMatch(
      /safety reviewer/,
    );
    await recordDecision(ctxFor(await staff("safety_reviewer")), draft.version.id, approval());
    await publishVersion(ctxFor(owner), draft.version.id);
    expect((await readCourse(draft.course.id)).course).toMatchObject({
      status: "published",
      safeguardingSensitive: true,
    });
  });

  it("a new revision after approval needs approving again", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    expect(approved.version.status).toBe("approved");

    const next = await saveRevision(
      ctxFor(editor),
      approved.course.id,
      fixtureCourse((c) => (c.whatYouMake = `${c.whatYouMake} Now with one more sentence.`)),
    );
    expect(next.version.revision).toBe(2);

    // The new revision has no approval of its own.
    const unapproved = await appError(() => publishVersion(ctxFor(reviewer), next.version.id));
    expect(unapproved.code).toBe("approval_required");
    expect(unapproved.message).toMatch(/No human approval is recorded/);
    // The old approval cannot be used to publish the old revision behind the new one's back.
    expect((await appError(() => publishVersion(ctxFor(reviewer), approved.version.id))).code).toBe(
      "conflict",
    );
    expect(await isLive()).toBe(false);
    expect((await getApprovalState(ctxFor(reviewer), next.version.id)).decisions).toHaveLength(0);

    await submitForReview(ctxFor(editor), approved.course.id);
    await recordDecision(ctxFor(reviewer), next.version.id, approval());
    await publishVersion(ctxFor(reviewer), next.version.id);
    expect((await getPublishedCourseBySlug({ db }, SLUG))?.version.id).toBe(next.version.id);
  });

  it("publishing a second version supersedes the first and keeps enrolled learners pinned to theirs", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    const { family } = await createFamily();
    const learner = await createLearner({ familyId: family.id });
    await db.insert(enrolment).values({
      learnerId: learner.user.id,
      courseId: approved.course.id,
      courseVersionId: approved.version.id,
    });
    const firstSteps = await db.select().from(step).where(eq(step.courseVersionId, approved.version.id));

    const next = await saveRevision(
      ctxFor(editor),
      approved.course.id,
      fixtureCourse((c) => (c.title = "Snapchat-Style App, Second Edition")),
    );
    await submitForReview(ctxFor(editor), approved.course.id);
    // While the new revision is in review the course is still published.
    expect((await readCourse(approved.course.id)).course.status).toBe("published");
    await recordDecision(ctxFor(reviewer), next.version.id, approval());
    const result = await publishVersion(ctxFor(reviewer), next.version.id);

    expect(result.supersededVersionId).toBe(approved.version.id);
    expect((await readVersion(approved.version.id)).status).toBe("retired");
    expect(result.course).toMatchObject({
      publishedVersionId: next.version.id,
      title: "Snapchat-Style App, Second Edition",
    });
    // The learner's enrolment and the steps of their version are untouched.
    expect((await db.select().from(enrolment))[0]?.courseVersionId).toBe(approved.version.id);
    expect(await db.select().from(step).where(eq(step.courseVersionId, approved.version.id))).toEqual(
      firstSteps,
    );
    expect(await db.select().from(step)).toHaveLength(STEP_COUNT * 2);
  });
});

describe("scheduled publishing", () => {
  const HOUR = 60 * 60 * 1000;

  it("needs complete approval to schedule, and only a person may schedule", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const draft = await draftInReview(await staff("editor"));
    const ctx = ctxFor(reviewer);
    const later = new Date(ctx.now.getTime() + HOUR);
    expect((await appError(() => scheduleVersion(ctx, draft.version.id, later))).code).toBe(
      "approval_required",
    );

    await recordDecision(ctxFor(reviewer), draft.version.id, approval());
    expect((await appError(() => scheduleVersion(systemCtx(), draft.version.id, later))).code).toBe(
      "forbidden",
    );
    expect(
      (await appError(() => scheduleVersion(ctxFor(reviewer), draft.version.id, new Date(0)))).code,
    ).toBe("invalid_input");
    expect(await db.select().from(publishSchedule)).toHaveLength(0);
  });

  it("fires when the time comes and the approval is intact", async () => {
    await setUpRegister();
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(await staff("editor"), reviewer);
    const ctx = ctxFor(reviewer);
    const publishAt = new Date(ctx.now.getTime() + HOUR);
    const schedule = await scheduleVersion(ctx, approved.version.id, publishAt);
    expect(schedule).toMatchObject({ status: "scheduled", scheduledBy: reviewer.userId, publishAt });
    expect((await readVersion(approved.version.id)).status).toBe("scheduled");
    expect((await readCourse(approved.course.id)).course.status).toBe("scheduled");

    // Too early: nothing happens.
    const early = await runDuePublishSchedules(systemCtx("publish.schedule"));
    expect(early).toMatchObject({ due: 0, published: 0, failed: 0 });
    expect(await isLive()).toBe(false);

    const job = systemCtx("publish.schedule");
    job.now = new Date(publishAt.getTime() + 1000);
    const ran = await runDuePublishSchedules(job);
    expect(ran).toMatchObject({ due: 1, published: 1, failed: 0 });
    expect(await isLive()).toBe(true);
    expect((await db.select().from(publishSchedule))[0]).toMatchObject({
      status: "published",
      publishedAt: job.now,
    });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "course.publish"));
    expect(entry).toMatchObject({ actorType: "system", actorLabel: "publish.schedule" });
    expect(entry?.meta).toMatchObject({ via: "schedule", approverIds: [reviewer.userId] });

    // Running the job again does nothing.
    const again = systemCtx("publish.schedule");
    again.now = new Date(publishAt.getTime() + 2 * HOUR);
    expect(await runDuePublishSchedules(again)).toMatchObject({ due: 0, published: 0 });
    expect((await auditActions()).filter((action) => action === "course.publish")).toHaveLength(1);
  });

  async function scheduled() {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    const ctx = ctxFor(reviewer);
    const publishAt = new Date(ctx.now.getTime() + HOUR);
    const schedule = await scheduleVersion(ctx, approved.version.id, publishAt);
    const runJob = async () => {
      const job = systemCtx("publish.schedule");
      job.now = new Date(publishAt.getTime() + HOUR);
      return runDuePublishSchedules(job);
    };
    return { editor, reviewer, approved, schedule, runJob };
  }

  it("does not fire when a reviewer declined after it was scheduled", async () => {
    const { approved, runJob } = await scheduled();
    await recordDecision(ctxFor(await staff("safety_reviewer")), approved.version.id, {
      kind: "decline",
      checklist: {},
      toolClaimsChecked: false,
      reason: "Found a problem after sign-off.",
    });
    // Declining cancels the schedule outright.
    expect((await db.select().from(publishSchedule))[0]?.status).toBe("cancelled");
    expect(await runJob()).toMatchObject({ due: 0, published: 0 });
    expect(await isLive()).toBe(false);
  });

  it("does not fire when the approval record changed behind the schedule's back", async () => {
    const { approved, schedule, reviewer, runJob } = await scheduled();
    // A decision written straight to the table after scheduling, bypassing the service.
    await db.insert(reviewDecision).values({
      courseId: approved.course.id,
      courseVersionId: approved.version.id,
      reviewerId: reviewer.userId,
      decision: "approve",
      toolClaimsChecked: true,
      reviewerRoles: ["reviewer"],
      createdAt: new Date(schedule.createdAt.getTime() + 60_000),
    });
    const ran = await runJob();
    expect(ran).toMatchObject({ due: 1, published: 0, failed: 1 });
    expect(ran.results[0]?.error).toMatch(/after this publish was scheduled/);
    expect(await isLive()).toBe(false);
    expect((await db.select().from(publishSchedule))[0]).toMatchObject({ status: "failed" });
    expect((await readVersion(approved.version.id)).status).toBe("in_review");
    expect(await auditActions()).toContain("course.schedule.failed");
  });

  it("does not fire when the approval records are gone", async () => {
    const { approved, runJob } = await scheduled();
    await db.delete(reviewDecision).where(eq(reviewDecision.courseVersionId, approved.version.id));
    const ran = await runJob();
    expect(ran).toMatchObject({ published: 0, failed: 1 });
    expect(ran.results[0]?.error).toMatch(/No human approval is recorded/);
    expect(await isLive()).toBe(false);
    expect(await db.select().from(step)).toHaveLength(0);
  });

  it("does not fire when the second-reviewer setting was turned on after scheduling", async () => {
    const { runJob } = await scheduled();
    await requireSecondReviewer("all_courses");
    const ran = await runJob();
    expect(ran).toMatchObject({ published: 0, failed: 1 });
    expect(ran.results[0]?.error).toMatch(/Two different people must approve/);
    expect(await isLive()).toBe(false);
  });

  it("does not fire when the tool was blocked after scheduling", async () => {
    const { editor, runJob } = await scheduled();
    await blockTool(ctxFor(editor), "replit", "Terms changed");
    await blockTool(ctxFor(editor), "base44", "Terms changed");
    const ran = await runJob();
    expect(ran).toMatchObject({ published: 0, failed: 1 });
    expect(ran.results[0]?.error).toMatch(/blocked for under-18s/);
    expect(await isLive()).toBe(false);
    expect(await db.select().from(step)).toHaveLength(0);
    const tasks = await db.select().from(reviewTask).where(eq(reviewTask.status, "open"));
    expect(tasks.map((task) => task.title).join(" ")).toMatch(/Scheduled publish did not run/);
  });

  it("does not fire when a new revision was saved after scheduling", async () => {
    const { editor, approved, runJob } = await scheduled();
    await saveRevision(
      ctxFor(editor),
      approved.course.id,
      fixtureCourse((c) => (c.title = "Edited after scheduling")),
    );
    expect((await db.select().from(publishSchedule))[0]?.status).toBe("cancelled");
    expect(await runJob()).toMatchObject({ due: 0, published: 0 });
    expect(await isLive()).toBe(false);
  });

  it("does not fire when the person who scheduled it has lost their role", async () => {
    const { reviewer, runJob } = await scheduled();
    await db.delete(staffRole).where(eq(staffRole.userId, reviewer.userId));
    const ran = await runJob();
    expect(ran).toMatchObject({ published: 0, failed: 1 });
    expect(ran.results[0]?.error).toMatch(/no longer has publish rights/);
    expect(await isLive()).toBe(false);
  });

  it("runs as a registered job under the system actor and records the run", async () => {
    const { schedule } = await scheduled();
    expect(publishJobs).toEqual([publishDueSchedulesJob]);
    expect(publishDueSchedulesJob).toMatchObject({
      name: "publish.run_due_schedules",
      schedule: "*/5 * * * *",
    });

    const result = await runJob(publishDueSchedulesJob, undefined, {
      now: new Date(schedule.publishAt.getTime() + 1000),
    });
    expect(result).toMatchObject({ status: "succeeded", summary: { due: 1, published: 1, failed: 0 } });
    expect(await isLive()).toBe(true);
    expect((await db.select().from(jobRun))[0]).toMatchObject({
      job: "publish.run_due_schedules",
      status: "succeeded",
    });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "course.publish"));
    expect(entry).toMatchObject({
      actorType: "system",
      actorLabel: "publish.run_due_schedules",
      actorId: null,
    });
  });

  it("is refused for a learner or a signed-out visitor", async () => {
    const learner = await createLearner();
    for (const actor of [learner.actor, ANONYMOUS]) {
      expect((await appError(() => runDuePublishSchedules(ctxFor(actor)))).code).toBe("forbidden");
    }
  });
});

describe("taking down", () => {
  async function published() {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);
    return { editor, reviewer, courseId: approved.course.id, versionId: approved.version.id };
  }

  it("take-down hides the course immediately and reports the learners affected", async () => {
    const { courseId, versionId } = await published();
    const { family } = await createFamily();
    for (const status of ["active", "active", "completed"] as const) {
      const learner = await createLearner({ familyId: family.id });
      await db
        .insert(enrolment)
        .values({ learnerId: learner.user.id, courseId, courseVersionId: versionId, status });
    }
    expect(await isLive()).toBe(true);

    const moderator = await staff("moderator");
    const ctx = ctxFor(moderator);
    const result = await takeDownCourse(ctx, courseId, "A learner reported an unsafe step.");

    expect(result).toMatchObject({ affectedLearnerCount: 2, versionId, alreadyDown: false });
    expect(result.course).toMatchObject({
      status: "taken_down",
      publishedVersionId: null,
      takenDownAt: ctx.now,
      takenDownReason: "A learner reported an unsafe step.",
    });
    expect(await isLive()).toBe(false);
    expect((await readVersion(versionId)).status).toBe("taken_down");
    // Enrolments are kept, pinned to the same version, so the player can show a notice.
    expect(await db.select().from(enrolment)).toHaveLength(3);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "course.take_down"));
    expect(entry).toMatchObject({ actorId: moderator.userId, reason: "A learner reported an unsafe step." });

    // A second call is harmless.
    expect((await takeDownCourse(ctxFor(moderator), courseId, "Again")).alreadyDown).toBe(true);
  });

  it("take-down needs a reason and the right role", async () => {
    const { courseId } = await published();
    const moderator = await staff("moderator");
    expect((await appError(() => takeDownCourse(ctxFor(moderator), courseId, "  "))).code).toBe(
      "invalid_input",
    );
    const learner = await createLearner();
    for (const actor of [learner.actor, ANONYMOUS, await staff("support")]) {
      const error = await appError(() => takeDownCourse(ctxFor(actor), courseId, "Because"));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await isLive()).toBe(true);
  });

  it("restoring a taken-down course needs a fresh approval recorded after the take-down", async () => {
    const { reviewer, courseId, versionId } = await published();
    await takeDownCourse(ctxFor(await staff("moderator")), courseId, "Checking a report.");

    // The approval from before the take-down does not count.
    const stale = await appError(() => restoreCourse(ctxFor(reviewer), courseId, "False alarm"));
    expect(stale.code).toBe("approval_required");
    expect(stale.message).toMatch(/fresh approval/);
    expect((await appError(() => restoreCourse(systemCtx(), courseId, "Automatic"))).code).toBe("forbidden");
    expect(await isLive()).toBe(false);

    await recordDecision(ctxFor(reviewer), versionId, approval());
    // Recording the approval does not itself restore anything.
    expect(await isLive()).toBe(false);
    const restored = await restoreCourse(ctxFor(reviewer), courseId, "Report checked: the step is fine.");
    expect(restored).toMatchObject({
      status: "published",
      publishedVersionId: versionId,
      takenDownAt: null,
      takenDownReason: null,
    });
    expect(await isLive()).toBe(true);
    expect(await auditActions()).toContain("course.restore");
  });

  it("disableStep hides one step at once; enabling it again needs publish rights", async () => {
    const { reviewer } = await published();
    const [target] = await db.select().from(step).where(eq(step.key, "s7"));
    if (!target) throw new Error("no step");
    const moderator = await staff("moderator");
    const ctx = ctxFor(moderator);
    const disabled = await disableStep(ctx, target.id, "The tool's screen changed");
    expect(disabled).toMatchObject({
      disabled: true,
      disabledReason: "The tool's screen changed",
      disabledBy: moderator.userId,
      disabledAt: ctx.now,
    });

    expect((await appError(() => enableStep(ctxFor(moderator), target.id))).code).toBe("forbidden");
    expect((await appError(() => enableStep(systemCtx(), target.id))).code).toBe("forbidden");
    const enabled = await enableStep(ctxFor(reviewer), target.id, "Guide updated");
    expect(enabled).toMatchObject({
      disabled: false,
      disabledReason: null,
      disabledBy: null,
      disabledAt: null,
    });
    expect(await auditActions()).toEqual(expect.arrayContaining(["step.disable", "step.enable"]));
  });

  it("unpublish and retire remove the course from the catalogue and need a person with publish rights", async () => {
    const { reviewer, editor, courseId, versionId } = await published();
    expect((await appError(() => unpublishCourse(systemCtx(), courseId, "x"))).code).toBe("forbidden");
    expect((await appError(() => unpublishCourse(ctxFor(editor), courseId, "x"))).code).toBe("forbidden");

    const result = await unpublishCourse(ctxFor(reviewer), courseId, "Rewriting for the new Replit layout.");
    expect(result.course).toMatchObject({ status: "draft", publishedVersionId: null, takenDownAt: null });
    expect((await readVersion(versionId)).status).toBe("retired");
    expect(await isLive()).toBe(false);

    // Publishing it again needs a new, approved revision.
    expect((await appError(() => publishVersion(ctxFor(reviewer), versionId))).code).toBe("conflict");
    const next = await saveRevision(
      ctxFor(editor),
      courseId,
      fixtureCourse((c) => (c.title = "Back again")),
    );
    expect((await appError(() => publishVersion(ctxFor(reviewer), next.version.id))).code).toBe(
      "approval_required",
    );
    await submitForReview(ctxFor(editor), courseId);
    await recordDecision(ctxFor(reviewer), next.version.id, approval());
    await publishVersion(ctxFor(reviewer), next.version.id);
    expect(await isLive()).toBe(true);

    const retired = await retireCourse(ctxFor(reviewer), courseId, "Tool has shut down.");
    expect(retired.course).toMatchObject({ status: "retired", publishedVersionId: null });
    expect(await isLive()).toBe(false);
  });

  it("markNeedsReview flags a live course without hiding it, and a person clears the flag", async () => {
    const { reviewer, editor, courseId, versionId } = await published();
    expect(await getPublishedCourseBySlug({ db }, SLUG)).toMatchObject({ needsReview: false });

    const flagged = await markNeedsReview(
      systemCtx("tools.watch"),
      courseId,
      "Replit's pricing page changed.",
    );
    expect(flagged.course.status).toBe("needs_review");
    expect(flagged.task).toMatchObject({
      kind: "course_review",
      status: "open",
      detail: "Replit's pricing page changed.",
    });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "course.needs_review"));
    expect(entry).toMatchObject({
      actorType: "system",
      actorLabel: "tools.watch",
      reason: "Replit's pricing page changed.",
    });

    // A flag for staff, not a take-down: the course is still live and still the same version.
    const live = await getPublishedCourseBySlug({ db }, SLUG);
    expect(live).toMatchObject({ needsReview: true });
    expect(live?.version.id).toBe(versionId);
    expect(live?.course).toMatchObject({
      status: "needs_review",
      publishedVersionId: versionId,
      takenDownAt: null,
    });
    expect((await readVersion(versionId)).status).toBe("published");

    // Flagging again for the same reason does not pile up tasks.
    await markNeedsReview(systemCtx("tools.watch"), courseId, "Replit's pricing page changed.");
    expect(
      await db
        .select()
        .from(reviewTask)
        .where(and(eq(reviewTask.courseId, courseId), eq(reviewTask.status, "open"))),
    ).toHaveLength(1);

    // Only a person with publish rights clears it.
    expect((await appError(() => clearNeedsReview(systemCtx("tools.watch"), courseId, "auto"))).code).toBe(
      "forbidden",
    );
    expect((await appError(() => clearNeedsReview(ctxFor(editor), courseId, "Looks fine"))).code).toBe(
      "forbidden",
    );
    const cleared = await clearNeedsReview(
      ctxFor(reviewer),
      courseId,
      "Checked the pricing page: the free plan is unchanged.",
    );
    expect(cleared.status).toBe("published");
    expect(await getPublishedCourseBySlug({ db }, SLUG)).toMatchObject({ needsReview: false });
    expect(await auditActions()).toContain("course.needs_review.clear");
  });

  it("a flagged course can still be taken down, and then it is hidden", async () => {
    const { courseId } = await published();
    await markNeedsReview(systemCtx("tools.watch"), courseId, "Age rules changed.");
    expect(await isLive()).toBe(true);
    const moderator = await staff("moderator");
    const result = await takeDownCourse(ctxFor(moderator), courseId, "The tool is now 18+ only.");
    expect(result.course.status).toBe("taken_down");
    expect(await isLive()).toBe(false);
  });

  it("the flag cannot be cleared while the course fails validation", async () => {
    const { reviewer, editor, courseId } = await published();
    await markNeedsReview(systemCtx("tools.watch"), courseId, "Terms changed.");
    await blockTool(ctxFor(editor), "replit", "Terms changed");
    await blockTool(ctxFor(editor), "base44", "Terms changed");
    const error = await appError(() => clearNeedsReview(ctxFor(reviewer), courseId, "Looks fine"));
    expect(error.code).toBe("validation_failed");
    expect((await getPublishedCourseBySlug({ db }, SLUG))?.needsReview).toBe(true);
  });

  it("markNeedsReview leaves a draft's status alone", async () => {
    await setUpRegister();
    const { course: created } = await createCourse(ctxFor(await staff("editor")), fixtureCourse(), {
      origin: "hand_made",
    });
    const flagged = await markNeedsReview(systemCtx("tools.watch"), created.id, "Tool changed.");
    expect(flagged.course.status).toBe("draft");
    expect(
      await db
        .select()
        .from(reviewTask)
        .where(and(eq(reviewTask.courseId, created.id), eq(reviewTask.status, "open"))),
    ).toHaveLength(1);
  });
});

describe("nothing is published without a recorded human approval", () => {
  it("every published version has an approve decision by a staff user", async () => {
    await setUpRegister();
    const owner = await staff("super_admin");
    const draft = await draftInReview(owner);
    // Try every route that does not involve a human approval.
    await appError(() => publishVersion(ctxFor(owner), draft.version.id));
    await appError(() => publishVersion(systemCtx(), draft.version.id));
    await appError(() => scheduleVersion(ctxFor(owner), draft.version.id, new Date(Date.now() + 10 ** 9)));
    await runDuePublishSchedules(systemCtx("publish.schedule"));
    expect(await db.select().from(courseVersion).where(eq(courseVersion.status, "published"))).toHaveLength(
      0,
    );
    expect(await db.select().from(course).where(eq(course.status, "published"))).toHaveLength(0);

    await recordDecision(ctxFor(owner), draft.version.id, approval());
    await publishVersion(ctxFor(owner), draft.version.id);
    const publishedVersions = await db
      .select()
      .from(courseVersion)
      .where(eq(courseVersion.status, "published"));
    expect(publishedVersions).toHaveLength(1);
    for (const version of publishedVersions) {
      const approvals = await db
        .select()
        .from(reviewDecision)
        .where(and(eq(reviewDecision.courseVersionId, version.id), eq(reviewDecision.decision, "approve")));
      expect(approvals.length).toBeGreaterThan(0);
    }
  });
});
