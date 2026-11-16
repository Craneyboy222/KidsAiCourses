import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { moderationItem, notification, report, reviewTask, safeguardingCase } from "@/server/db";
import { decideModeration } from "@/server/services/moderation";
import { createReport, listOwnReports, REPORT_STATUS_LABELS } from "@/server/services/reports";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { db, testCtx } from "../../helpers/db";
import { appError } from "../content/helpers";
import { HOMEWORK, SNAPCHAT, cases, courseBySlug, family, seedCourses, staffCtx, tearDownStorage, toolBySlug, useToolMocks } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/safeguarding", () => ({ openSafeguardingCase: vi.fn() }));
vi.mock("@/server/services/usage", () => ({ checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/enrolment", () => ({ recordEvidenceOutcome: vi.fn(), getEnrolmentById: vi.fn() }));

beforeAll(seedCourses);
afterAll(tearDownStorage);
beforeEach(async () => {
  useToolMocks();
  await db.delete(reviewTask);
});

const NOTE = "My friend Sam told me something scary happened at home last night.";
const reportRow = async (id: string) => (await db.select().from(report).where(eq(report.id, id)))[0];
const queueFor = (reportId: string) => db.select().from(moderationItem).where(eq(moderationItem.subjectId, reportId));

describe("someone is in danger", () => {
  it("opens a critical safeguarding case at once and shows the crisis signposting", async () => {
    const who = await family();
    const target = await courseBySlug(SNAPCHAT);
    const result = await createReport(who.learner, { reason: "someone_in_danger", target: { type: "step", id: "s3", courseId: target.id, stepKey: "s3" }, note: NOTE });
    expect(result.showCrisisScript).toBe(true);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ severity: "critical", trigger: "danger_report", learnerId: who.learnerId, sourceType: "report", sourceId: result.reportId, detail: NOTE });
    // The summary line is ours and says nothing about anyone.
    expect(cases[0]?.summary).not.toContain("Sam");
    const [opened] = await db.select().from(safeguardingCase).where(eq(safeguardingCase.learnerId, who.learnerId));
    expect(opened).toMatchObject({ severity: "critical", trigger: "danger_report" });

    const row = await reportRow(result.reportId);
    expect(row).toMatchObject({ reason: "someone_in_danger", reporterId: who.learnerId, safeguardingCaseId: opened?.id, detail: NOTE, targetType: "step" });
    // It goes to the safeguarding lead, not into the ordinary moderation queue.
    expect(await queueFor(result.reportId)).toHaveLength(0);
  });

  it("still answers calmly, and alerts moderators as critical, if the case cannot be opened", async () => {
    vi.mocked(openSafeguardingCase).mockRejectedValueOnce(new Error("safeguarding service is down"));
    const who = await family();
    const moderator = await staffCtx("moderator");
    const result = await createReport(who.learner, { reason: "someone_in_danger", target: { type: "other", id: "general" } });
    expect(result.showCrisisScript).toBe(true);
    const [queued] = await queueFor(result.reportId);
    expect(queued).toMatchObject({ severity: "critical", state: "pending", source: "auto" });
    expect(queued?.summary).toMatch(/safeguarding/i);
    const alerts = await db.select().from(notification).where(and(eq(notification.userId, moderator.actor.userId), eq(notification.type, "moderation.urgent_item")));
    expect(alerts).toHaveLength(1);
    expect((await reportRow(result.reportId))?.status).toBe("open");
  });

  it("works for a parent too, and a signed-out visitor is asked to sign in", async () => {
    const who = await family();
    const result = await createReport(who.parent, { reason: "someone_in_danger", target: { type: "course", id: (await courseBySlug(HOMEWORK)).id } });
    expect(result.showCrisisScript).toBe(true);
    expect(cases[0]).toMatchObject({ learnerId: null, severity: "critical" });
    expect((await appError(() => createReport(testCtx(), { reason: "someone_in_danger", target: { type: "other", id: "x" } }))).code).toBe("unauthenticated");
  });
});

describe("this doesn't match what I see", () => {
  it("creates one guide-review task for editors, linked to the tool, the course and the report", async () => {
    const who = await family();
    const editor = await staffCtx("editor");
    const target = await courseBySlug(SNAPCHAT);
    const replit = await toolBySlug("replit");
    const input = { reason: "guide_mismatch", target: { type: "guide", id: "guide-replit", courseId: target.id, stepKey: "s2", toolSlug: "replit" }, note: "The Create button has moved." } as const;

    const result = await createReport(who.learner, input);
    expect(result.showCrisisScript).toBe(false);
    const tasks = await db.select().from(reviewTask).where(eq(reviewTask.kind, "guide_review"));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "open", courseId: target.id, toolId: replit.id, toolGuideKey: "guide-replit", reportId: result.reportId, courseVersionId: target.publishedVersionId });
    expect(tasks[0]?.title).toContain("Replit");
    // The reporter's words stay on the report.
    expect(`${tasks[0]?.title} ${tasks[0]?.detail}`).not.toContain("Create button");
    expect((await reportRow(result.reportId))).toMatchObject({ reason: "guide_mismatch", targetType: "tool_guide", detail: "The Create button has moved." });
    expect(await queueFor(result.reportId)).toHaveLength(0);
    expect(cases).toHaveLength(0);
    expect(await db.select().from(notification).where(and(eq(notification.userId, editor.actor.userId), eq(notification.type, "review.guide_mismatch")))).toHaveLength(1);

    // A second learner reporting the same guide adds a report, not a second task.
    const second = await createReport((await family()).learner, input);
    expect(second.reportId).not.toBe(result.reportId);
    expect(await db.select().from(reviewTask).where(eq(reviewTask.kind, "guide_review"))).toHaveLength(1);
    // A different tool's guide is its own task.
    await createReport(who.learner, { reason: "guide_mismatch", target: { type: "guide", id: "guide-chatgpt", courseId: (await courseBySlug(HOMEWORK)).id, toolSlug: "chatgpt" } });
    expect(await db.select().from(reviewTask).where(eq(reviewTask.kind, "guide_review"))).toHaveLength(2);
  });
});

describe("everything else", () => {
  it("goes to the moderation queue with a deadline, at a severity that fits the reason", async () => {
    const who = await family();
    const target = await courseBySlug(SNAPCHAT);
    const send = (reason: "inappropriate" | "bullying" | "privacy" | "wrong_or_broken" | "other") => createReport(who.learner, { reason, target: { type: "ai_output", id: "00000000-0000-4000-8000-00000000abcd", courseId: target.id, stepKey: "s5" }, note: NOTE });

    for (const [reason, severity, stored] of [["inappropriate", "high", "unsafe_or_upsetting"], ["bullying", "high", "unsafe_or_upsetting"], ["privacy", "high", "privacy"], ["wrong_or_broken", "normal", "wrong_or_broken"], ["other", "normal", "other"]] as const) {
      const result = await send(reason);
      expect(result.showCrisisScript).toBe(false);
      const [queued] = await queueFor(result.reportId);
      expect(queued).toMatchObject({ source: "report", subjectType: "report", severity, state: "pending", reportId: result.reportId, learnerId: who.learnerId });
      expect(queued?.dueAt).not.toBeNull();
      // Staff words only: the reporter's note is never copied into the queue.
      expect(queued?.summary).not.toContain("Sam");
      expect(await reportRow(result.reportId)).toMatchObject({ reason: stored, targetType: "ai_output", targetId: "00000000-0000-4000-8000-00000000abcd", status: "open" });
    }
    expect(cases).toHaveLength(0);
  });

  it("refuses a reason or target that is not on the list", async () => {
    const who = await family();
    const bad = { reason: "spam", target: { type: "step", id: "s1" } } as unknown as Parameters<typeof createReport>[1];
    expect((await appError(() => createReport(who.learner, bad))).code).toBe("invalid_input");
  });

  it("lets a moderator close the report, and the reporter sees where it has got to", async () => {
    const who = await family();
    const target = await courseBySlug(SNAPCHAT);
    const upheld = await createReport(who.learner, { reason: "wrong_or_broken", target: { type: "step", id: "s3", courseId: target.id, stepKey: "s3" } });
    const fine = await createReport(testCtx(who.learner.actor, { now: new Date(Date.now() + 60_000) }), { reason: "other", target: { type: "course", id: target.id, courseId: target.id } });
    const moderator = await staffCtx("moderator");
    await decideModeration(moderator, (await queueFor(upheld.reportId))[0]?.id ?? "", { verdict: "block", note: "Fixed the broken link in step 3." });
    await decideModeration(moderator, (await queueFor(fine.reportId))[0]?.id ?? "", { verdict: "approve" });

    const mine = await listOwnReports(who.learner, who.learnerId);
    expect(mine.map((entry) => [entry.id, entry.reason, entry.status])).toEqual([[fine.reportId, "other", "dismissed"], [upheld.reportId, "wrong_or_broken", "resolved"]]);
    expect(mine[0]?.targetLabel).toBe(`The course "${target.title}"`);
    expect(mine[1]?.targetLabel).toBe(`A step in "${target.title}"`);
    for (const entry of mine) expect(REPORT_STATUS_LABELS[entry.status]).toBeDefined();
  });
});

describe("a reporter's own reports", () => {
  it("can be read by the reporter and by nobody else", async () => {
    const mine = await family();
    const other = await family();
    await createReport(mine.learner, { reason: "bullying", target: { type: "project", id: "00000000-0000-4000-8000-000000000001" } });
    await createReport(mine.parent, { reason: "other", target: { type: "other", id: "general" } });

    expect((await listOwnReports(mine.learner, mine.learnerId)).map((entry) => entry.reason)).toEqual(["bullying"]);
    expect((await listOwnReports(mine.parent, mine.parent.actor.userId)).map((entry) => [entry.reason, entry.targetLabel])).toEqual([["other", "Something else"]]);
    expect(await listOwnReports(other.learner, other.learnerId)).toEqual([]);
    // Not a child's reports by their parent, not another person's, not signed out.
    expect((await appError(() => listOwnReports(mine.parent, mine.learnerId))).code).toBe("forbidden");
    expect((await appError(() => listOwnReports(other.learner, mine.learnerId))).code).toBe("forbidden");
    expect((await appError(() => listOwnReports(testCtx(), mine.learnerId))).code).toBe("unauthenticated");
  });
});
