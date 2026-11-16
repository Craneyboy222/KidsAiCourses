import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flattenSteps } from "@/content/course-utils";
import type { Course } from "@/content/schema";
import { aiRequest, auditLog, certificate, course, enrolment, metricCounter, notification, project, quizAttempt, reflection, stepProgress, usageDay } from "@/server/db";
import { getEnrolmentById, listEnrolments, recordEvidenceOutcome, startCourse } from "@/server/services/enrolment";
import { getLearnerHome } from "@/server/services/learner-home";
import { resolvePreview } from "@/server/services/preview";
import { loadPlayer, saveStep } from "@/server/services/progress";
import { getProgressSummary } from "@/server/services/progress-summary";
import { disableStep } from "@/server/services/publish";
import { gradePreviewQuiz, submitQuizAttempt } from "@/server/services/quiz";
import { checkLearningAllowed, getUsageByDay, recordHeartbeat } from "@/server/services/usage";
import { db, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createUsageDay } from "../../helpers/factories";
import { appError, ctxFor, staff } from "../content/helpers";
import { AFTERNOON, FREE_SLUG, OTHER_FREE_SLUG, PAID_SLUG, courseBySlug, learner, publishNewVersion, publishedContent, seedPublishedCourses, setControls, stepRow, useLearningMocks } from "./helpers";

vi.mock("@/server/services/start-gate", () => ({ checkStart: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/preview", () => ({ resolvePreview: vi.fn() }));

beforeAll(seedPublishedCourses);
beforeEach(useLearningMocks);

/** Right answers for a quiz, read from the full content (which a learner never receives). */
function rightAnswers(content: Course, quizId: string): Record<string, string[]> {
  const quiz = content.quizzes.find((entry) => entry.id === quizId);
  if (!quiz) throw new Error(`no quiz ${quizId}`);
  return Object.fromEntries(quiz.questions.map((question) => [question.id, question.kind === "order" ? question.options.map((option) => option.id) : question.options.filter((option) => option.correct).map((option) => option.id)]));
}

describe("starting and version pinning", () => {
  it("pins the enrolment to the live version and stays there after a new publish", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const before = await courseBySlug(PAID_SLUG);
    const started = await startCourse(child.ctx, { learnerId: id, courseSlug: PAID_SLUG });
    expect(started.created).toBe(true);
    expect(started.enrolment.courseVersionId).toBe(before.publishedVersionId);
    expect(started.enrolment.currentStepKey).toBe("s1");
    expect((await courseBySlug(PAID_SLUG)).enrolmentCount).toBe(before.enrolmentCount + 1);

    // Starting again is the same enrolment, counted once.
    const again = await startCourse(child.ctx, { learnerId: id, courseSlug: PAID_SLUG });
    expect(again.created).toBe(false);
    expect(again.enrolment.id).toBe(started.enrolment.id);
    expect((await courseBySlug(PAID_SLUG)).enrolmentCount).toBe(before.enrolmentCount + 1);

    const { versionId } = await publishNewVersion(PAID_SLUG, (content) => {
      content.version = "1.1.0";
      const first = content.modules[0]?.lessons[0]?.steps[0];
      if (first) first.title = "A brand new opening";
    });
    expect((await courseBySlug(PAID_SLUG)).publishedVersionId).toBe(versionId);

    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: PAID_SLUG, stepKey: "s1" });
    if (player.kind !== "ok") throw new Error(`expected the player, got ${player.kind}`);
    expect(player.enrolment.courseVersionId).toBe(before.publishedVersionId);
    expect(player.course.modules[0]?.lessons[0]?.steps[0]?.title).toBe("The finished app in 90 seconds");
    // Progress is still written against the pinned version's steps.
    const saved = await saveStep(child.ctx, { enrolmentId: started.enrolment.id, stepKey: "s13", intent: "complete" });
    expect(saved.status).toBe("completed");

    // Someone who starts now gets the new version.
    const newcomer = await learner();
    const fresh = await startCourse(newcomer.ctx, { learnerId: newcomer.actor.userId, courseSlug: PAID_SLUG });
    expect(fresh.enrolment.courseVersionId).toBe(versionId);
    const theirs = await loadPlayer(newcomer.ctx, { learnerId: newcomer.actor.userId, courseSlug: PAID_SLUG, stepKey: "s1" });
    if (theirs.kind !== "ok") throw new Error("expected the player");
    expect(theirs.course.modules[0]?.lessons[0]?.steps[0]?.title).toBe("A brand new opening");
  });
});

describe("autosave and resume", () => {
  it("saves notes and ticks, resumes at the exact step, and never lets the browser decide completion", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });

    // Opening a step in the player is what moves the resume point; loading it does not.
    await loadPlayer(child.ctx, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s3" });
    expect((await getEnrolmentById(child.ctx, mine.id))?.currentStepKey).toBe("s1");
    await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s3", intent: "open" });
    expect((await getEnrolmentById(child.ctx, mine.id))?.currentStepKey).toBe("s3");
    const reopened = await loadPlayer(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    expect(reopened.kind === "ok" && reopened.resumeKey).toBe("s3");

    // A tool task is not complete until it is ticked.
    const early = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s3", intent: "complete", notes: "Try the photosynthesis topic" });
    expect(early.status).toBe("in_progress");
    expect(early.completion).toMatchObject({ complete: false, code: "tick_needed" });

    // The browser cannot mark evidence itself, or tick guide steps that are not part of this step.
    await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s2", intent: "save", data: { guideTicks: ["g1", "nope"], evidence: "accepted", hintLevel: 99 } });
    const guide = await loadPlayer(child.ctx, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s2" });
    if (guide.kind !== "ok") throw new Error("expected the player");
    expect(guide.current?.data).toEqual({ guideTicks: ["g1"], hintLevel: 3 });
    const notYet = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s2", intent: "complete", data: { ticked: true } });
    expect(notYet.completion).toMatchObject({ complete: false, code: "guide_steps_left" });
    const setUp = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s2", intent: "complete", data: { guideTicks: ["g1", "g2", "g3", "g4"], ticked: true } });
    expect(setUp.status).toBe("completed");
    expect(setUp.nextStepKey).toBe("s3");

    // "Another device": a brand new request context for the same learner.
    const elsewhere = testCtx(child.actor, { now: new Date(AFTERNOON.getTime() + 3600_000) });
    const resumed = await loadPlayer(elsewhere, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s3" });
    if (resumed.kind !== "ok") throw new Error("expected the player");
    // The last step touched (s2) is finished, so "Continue" goes to the first one that is not.
    expect(resumed.resumeKey).toBe("s1");
    expect(resumed.current?.notes).toBe("Try the photosynthesis topic");
    expect(resumed.steps.find((entry) => entry.key === "s2")?.status).toBe("completed");
    expect(resumed.steps.find((entry) => entry.key === "s3")?.status).toBe("in_progress");
    expect((await listEnrolments(elsewhere, id))[0]).toMatchObject({ id: mine.id, completedSteps: 1, currentStepKey: "s2" });

    // Skipping is allowed, marked, and does not count as done. The final step cannot be skipped.
    const skipped = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s4", intent: "skip" });
    expect(skipped.status).toBe("skipped");
    expect(skipped.progress.completed).toBe(1);
    expect((await appError(() => saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s26", intent: "skip" }))).code).toBe("invalid_input");
    // Nor can it be completed from the browser: only the submissions service can.
    const submit = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s26", intent: "complete", data: { ticked: true } });
    expect(submit.status).toBe("in_progress");
    expect(submit.completion).toMatchObject({ complete: false, code: "evidence_needed" });
  });

  it("keeps a reflection private to the learner, and another learner cannot touch the enrolment", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    const empty = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s24", intent: "complete", data: { ticked: true } });
    expect(empty.completion).toMatchObject({ complete: false, code: "response_needed" });
    const done = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s24", intent: "complete", response: "  I'd tell a friend the bot explains, it doesn't write.  ", data: { ticked: true } });
    expect(done.status).toBe("completed");
    const [stored] = await db.select().from(reflection).where(eq(reflection.enrolmentId, mine.id));
    expect(stored?.body).toBe("I'd tell a friend the bot explains, it doesn't write.");

    // A parent's view carries titles, percentages and minutes: never the words.
    const { parentActor } = await createFamily();
    const stranger = await appError(() => getProgressSummary(testCtx(parentActor), id));
    expect(stranger.code).toBe("forbidden");
    const summary = await getProgressSummary(testCtx({ type: "parent", userId: parentActor.userId, familyId: child.familyId, status: "active" }, { now: AFTERNOON }), id);
    expect(summary.inProgress).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain("tell a friend");

    const other = await learner();
    expect((await appError(() => saveStep(other.ctx, { enrolmentId: mine.id, stepKey: "s24", intent: "save", response: "overwritten" }))).code).toBe("not_found");
    expect(await getEnrolmentById(other.ctx, mine.id)).toBeNull();
    expect((await appError(() => loadPlayer(other.ctx, { learnerId: id, courseSlug: FREE_SLUG }))).code).toBe("forbidden");
    expect((await appError(() => submitQuizAttempt(other.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: {} }))).code).toBe("not_found");
    expect((await db.select().from(reflection).where(eq(reflection.enrolmentId, mine.id)))[0]?.body).toContain("tell a friend");
  });
});

describe("quizzes", () => {
  it("never puts answers or feedback in anything a learner is sent before an attempt", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    const full = await publishedContent(FREE_SLUG);
    const feedback = full.quizzes.flatMap((quiz) => quiz.questions.flatMap((question) => question.options.map((option) => option.feedback))).filter((text) => text.length > 0);
    expect(feedback.length).toBeGreaterThan(10);

    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s12" });
    const home = await getLearnerHome(child.ctx, id);
    const saved = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s12", intent: "open" });
    const payload = JSON.stringify({ player, home, saved, enrolments: await listEnrolments(child.ctx, id) });
    expect(payload).not.toMatch(/"correct"|"feedback"|"coachContext"|"referenceSolution"|"editorNotes"|"verifyFlags"/);
    for (const text of feedback) expect(payload).not.toContain(text);
    for (const flat of flattenSteps(full)) if (flat.step.coachContext) expect(payload).not.toContain(flat.step.coachContext);

    // The `order` question does not arrive in the authored (correct) order.
    if (player.kind !== "ok") throw new Error("expected the player");
    const authored = full.quizzes[0]?.questions.find((question) => question.kind === "order")?.options.map((option) => option.id);
    const sent = player.course.quizzes[0]?.questions.find((question) => question.kind === "order")?.options.map((option) => option.id);
    expect(sent).toHaveLength(authored?.length ?? 0);
    expect(sent).not.toEqual(authored);
  });

  it("grades on the server, gives feedback for the chosen options only, allows retries and completes on a pass", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    const full = await publishedContent(FREE_SLUG);
    const quiz = full.quizzes[0];
    if (!quiz) throw new Error("no quiz");
    const wrongOption = quiz.questions[0]?.options.find((option) => !option.correct);
    const rightOption = quiz.questions[0]?.options.find((option) => option.correct);
    if (!wrongOption || !rightOption) throw new Error("fixture");

    const failed = await submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: { [quiz.questions[0]?.id ?? ""]: [wrongOption.id] } });
    expect(failed).toMatchObject({ passed: false, score: 0, attemptNumber: 1, stepStatus: "in_progress" });
    expect(failed.questions[0]?.options).toEqual([{ optionId: wrongOption.id, correct: false, feedback: wrongOption.feedback }]);
    // The right answer's feedback is not handed over with a wrong attempt.
    expect(JSON.stringify(failed)).not.toContain(rightOption.feedback);

    const passed = await submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: rightAnswers(full, quiz.id) });
    expect(passed).toMatchObject({ passed: true, score: 100, attemptNumber: 2, stepStatus: "completed" });
    const attempts = await db.select().from(quizAttempt).where(eq(quizAttempt.enrolmentId, mine.id));
    expect(attempts.map((attempt) => [attempt.attemptNumber, attempt.passed]).sort()).toEqual([[1, false], [2, true]]);

    // A later failed retry never un-completes the step.
    const retry = await submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: {} });
    expect(retry).toMatchObject({ passed: false, attemptNumber: 3, stepStatus: "completed" });
    // Not a quiz step.
    expect((await appError(() => submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s3", answers: {} }))).code).toBe("not_found");
  });
});

describe("daily cap and quiet hours", () => {
  it("saves the learner's work first, then stops at the cap", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: FREE_SLUG });
    setControls({ dailyMinutesCap: 30 });
    await createUsageDay({ learnerId: id, day: "2026-11-18", seconds: 29 * 60 + 30 });
    expect(await checkLearningAllowed(child.ctx, id)).toEqual({ allowed: true, minutesLeftToday: 0 });

    // The heartbeat that reaches the cap: only the remaining 30 seconds are counted.
    const beat = await recordHeartbeat(child.ctx, id, 60);
    expect(beat).toMatchObject({ allowed: false, reason: "time_cap" });
    const [today] = await db.select().from(usageDay).where(and(eq(usageDay.learnerId, id), eq(usageDay.day, "2026-11-18")));
    expect(today?.seconds).toBe(30 * 60);

    // The autosave that arrives after the cap: the words are kept, the step is not completed.
    const result = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s24", intent: "complete", response: "Half a sentence I was typing when", notes: "note to self", data: { ticked: true } });
    expect(result.saved).toBe(true);
    expect(result.stopped).toMatchObject({ reason: "time_cap" });
    expect(result.status).toBe("in_progress");
    expect((await db.select().from(reflection).where(eq(reflection.enrolmentId, mine.id)))[0]?.body).toBe("Half a sentence I was typing when");
    expect((await db.select().from(stepProgress).where(eq(stepProgress.enrolmentId, mine.id)))[0]?.notes).toBe("note to self");

    // Everything else is a hard stop: no quiz, no new course, and the player shows the reason.
    expect((await appError(() => submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: {} }))).code).toBe("time_cap_reached");
    expect((await appError(() => startCourse(child.ctx, { learnerId: id, courseSlug: OTHER_FREE_SLUG }))).code).toBe("time_cap_reached");
    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s24" });
    expect(player.kind).toBe("blocked");
    expect(JSON.stringify(player)).not.toContain('"modules"');
    // More heartbeats add nothing.
    await recordHeartbeat(child.at(new Date(AFTERNOON.getTime() + 60_000)), id, 60);
    expect((await db.select().from(usageDay).where(and(eq(usageDay.learnerId, id), eq(usageDay.day, "2026-11-18"))))[0]?.seconds).toBe(30 * 60);

    // Tomorrow it is all still there, and learning is allowed again.
    const tomorrow = child.at(new Date("2026-11-19T15:00:00Z"));
    expect(await checkLearningAllowed(tomorrow, id)).toEqual({ allowed: true, minutesLeftToday: 30 });
    const back = await loadPlayer(tomorrow, { learnerId: id, courseSlug: FREE_SLUG, stepKey: "s24" });
    if (back.kind !== "ok") throw new Error("expected the player");
    expect(back.current?.response).toBe("Half a sentence I was typing when");
    const finished = await saveStep(tomorrow, { enrolmentId: mine.id, stepKey: "s24", intent: "complete", data: { ticked: true } });
    expect(finished.status).toBe("completed");
  });

  it("blocks learning in quiet hours, counts no time, and bounds what a heartbeat can claim", async () => {
    const child = await learner();
    const id = child.actor.userId;
    setControls({ quietStartMin: 21 * 60, quietEndMin: 7 * 60 });
    const late = child.at(new Date("2026-11-18T22:30:00Z"));
    const answer = await checkLearningAllowed(late, id);
    expect(answer).toMatchObject({ allowed: false, reason: "quiet_hours" });
    expect(answer.allowed ? "" : answer.message).toContain("07:00");
    expect(await recordHeartbeat(late, id, 30)).toMatchObject({ allowed: false, reason: "quiet_hours" });
    expect(await db.select().from(usageDay).where(eq(usageDay.learnerId, id))).toHaveLength(0);
    expect((await appError(() => startCourse(late, { learnerId: id, courseSlug: FREE_SLUG }))).code).toBe("quiet_hours");

    // Daytime: a first beat counts at most 90 seconds; a beat 10 seconds later counts at most 10.
    expect(await recordHeartbeat(child.ctx, id, 3600)).toEqual({ allowed: true, minutesLeftToday: null });
    await recordHeartbeat(child.at(new Date(AFTERNOON.getTime() + 10_000)), id, 60);
    const usage = await getUsageByDay(child.at(new Date(AFTERNOON.getTime() + 20_000)), id, 3);
    expect(usage).toEqual([{ date: "2026-11-16", seconds: 0 }, { date: "2026-11-17", seconds: 0 }, { date: "2026-11-18", seconds: 100 }]);

    const summary = await getProgressSummary(child.ctx, id);
    expect(summary).toMatchObject({ minutesToday: 1, minutesThisWeek: 1 });
  });

  it("reports a paused account, a missing consent and somebody else's learner", async () => {
    const child = await learner();
    setControls({ paused: true, pausedReason: "Homework first" });
    expect(await checkLearningAllowed(child.ctx, child.actor.userId)).toMatchObject({ allowed: false, reason: "paused" });

    const noConsent = await createLearner({ age: 15 });
    expect(await checkLearningAllowed(testCtx(noConsent.actor, { now: AFTERNOON }), noConsent.user.id)).toMatchObject({ allowed: false, reason: "consent" });

    const other = await learner();
    expect((await appError(() => checkLearningAllowed(other.ctx, child.actor.userId))).code).toBe("forbidden");
    expect((await appError(() => recordHeartbeat(other.ctx, child.actor.userId, 30))).code).toBe("forbidden");
    expect((await appError(() => getUsageByDay(other.ctx, child.actor.userId, 7))).code).toBe("forbidden");
    expect((await appError(() => checkLearningAllowed(testCtx(), child.actor.userId))).code).toBe("unauthenticated");
  });
});

describe("disabled step", () => {
  it("is shown as switched off, can be passed, and does not hold the course open", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: OTHER_FREE_SLUG });
    const before = (await getEnrolmentById(child.ctx, mine.id))?.totalSteps ?? 0;
    const target = await stepRow(mine.courseVersionId, "s12");
    await disableStep(ctxFor(await staff("moderator")), target.id, "A question was wrong");

    const player = await loadPlayer(child.ctx, { learnerId: id, courseSlug: OTHER_FREE_SLUG, stepKey: "s12" });
    if (player.kind !== "ok") throw new Error("expected the player");
    expect(player.current?.disabled).toBe(true);
    expect(player.progress.total).toBe(before - 1);
    expect((await getEnrolmentById(child.ctx, mine.id))?.totalSteps).toBe(before - 1);

    expect((await appError(() => submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: "s12", answers: {} }))).code).toBe("conflict");
    const skipped = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: "s12", intent: "skip" });
    expect(skipped.nextStepKey).toBe("s13");
    expect(skipped.progress.total).toBe(before - 1);
  });
});

describe("finishing a course", () => {
  it("completes only when every step is done, through the submissions service for the last one", async () => {
    const child = await learner();
    const id = child.actor.userId;
    const { enrolment: mine } = await startCourse(child.ctx, { learnerId: id, courseSlug: PAID_SLUG });
    const pinned = (await db.select({ snapshot: sql<Course>`snapshot` }).from(sql`course_version`).where(sql`id = ${mine.courseVersionId}`))[0]?.snapshot;
    if (!pinned) throw new Error("no snapshot");

    for (const flat of flattenSteps(pinned)) {
      const key = flat.step.id;
      if (flat.step.type === "submit") continue;
      if (flat.step.type === "quiz") {
        await submitQuizAttempt(child.ctx, { enrolmentId: mine.id, stepKey: key, answers: rightAnswers(pinned, String(flat.step.config?.quizId)) });
        continue;
      }
      const guideTicks = flat.step.type === "setup_guide" ? (flat.step.config?.throughStepIds as string[]) : undefined;
      // The seed video files are placeholders that are not in storage, so the server lets the step through.
      const result = await saveStep(child.ctx, { enrolmentId: mine.id, stepKey: key, intent: "complete", response: "My own words.", data: { ticked: true, guideTicks } });
      expect([key, result.status]).toEqual([key, "completed"]);
    }
    const nearly = await getEnrolmentById(child.ctx, mine.id);
    expect(nearly).toMatchObject({ status: "active", completedSteps: (nearly?.totalSteps ?? 0) - 1 });

    const submitStep = await stepRow(mine.courseVersionId, "s12");
    // A learner may say "submitted", never "accepted".
    expect((await appError(() => recordEvidenceOutcome(child.ctx, { enrolmentId: mine.id, stepId: submitStep.id, outcome: "accepted" }))).code).toBe("forbidden");
    const other = await learner();
    expect((await appError(() => recordEvidenceOutcome(other.ctx, { enrolmentId: mine.id, stepId: submitStep.id, outcome: "submitted" }))).code).toBe("forbidden");

    const done = await recordEvidenceOutcome(child.ctx, { enrolmentId: mine.id, stepId: submitStep.id, outcome: "submitted" });
    expect(done.status).toBe("completed");
    expect(done.completedAt).toEqual(AFTERNOON);

    // A reviewer rejecting the work reopens the step and the course; accepting closes it again.
    const moderator = ctxFor(await staff("moderator"));
    expect((await recordEvidenceOutcome(moderator, { enrolmentId: mine.id, stepId: submitStep.id, outcome: "rejected" })).status).toBe("active");
    expect((await recordEvidenceOutcome(moderator, { enrolmentId: mine.id, stepId: submitStep.id, outcome: "accepted" })).status).toBe("completed");
    const summary = await getProgressSummary(child.ctx, id);
    expect(summary.completed.map((item) => item.courseSlug)).toEqual([PAID_SLUG]);
    expect(summary.inProgress).toEqual([]);

    // A step that is not an evidence step cannot be completed this way.
    const readStep = await stepRow(mine.courseVersionId, "s16");
    expect((await appError(() => recordEvidenceOutcome(moderator, { enrolmentId: mine.id, stepId: readStep.id, outcome: "accepted" }))).code).toBe("not_found");
  });
});

describe("staff preview", () => {
  const counts = async () => {
    const tables = { enrolment, stepProgress, quizAttempt, reflection, usageDay, project, certificate, aiRequest, metricCounter, notification, auditLog };
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(tables)) out[name] = (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? 0;
    out.enrolmentCountTotal = (await db.select({ n: sql<number>`coalesce(sum(${course.enrolmentCount}), 0)::int` }).from(course))[0]?.n ?? 0;
    return out;
  };

  it("grades a quiz in a draft and writes nothing at all", async () => {
    const editor = await staff("editor");
    const content = await publishedContent(FREE_SLUG);
    const target = await courseBySlug(FREE_SLUG);
    vi.mocked(resolvePreview).mockImplementation(async (ctx, input) =>
      ctx.actor.type === "staff" && input.versionId === target.workingVersionId ? { versionId: input.versionId ?? "", courseId: target.id, revision: 1, content, asBand: "teen_13_15", canEdit: true } : null,
    );
    const before = await counts();

    const passed = await gradePreviewQuiz(ctxFor(editor), { versionId: target.workingVersionId ?? "", stepKey: "s12", answers: rightAnswers(content, "q-honest-helper-1") });
    expect(passed).toMatchObject({ passed: true, score: 100, attemptNumber: 0, progress: null });
    const failed = await gradePreviewQuiz(ctxFor(editor), { versionId: target.workingVersionId ?? "", stepKey: "s12", answers: {} });
    expect(failed.passed).toBe(false);

    expect(await counts()).toEqual(before);
  });

  it("does not exist for a learner, a parent or a signed-out visitor", async () => {
    const target = await courseBySlug(FREE_SLUG);
    vi.mocked(resolvePreview).mockResolvedValue(null);
    const child = await learner();
    const { parentActor } = await createFamily();
    for (const ctx of [child.ctx, testCtx(parentActor), testCtx()]) {
      const refused = await appError(() => gradePreviewQuiz(ctx, { versionId: target.workingVersionId ?? "", stepKey: "s12", answers: {} }));
      expect(refused.code).toBe("not_found");
    }
  });
});
