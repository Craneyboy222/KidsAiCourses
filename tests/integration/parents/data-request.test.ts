import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/server/crypto";
import {
  aiMessage,
  aiRequest,
  artefact,
  auditLog,
  certificate,
  consentRecord,
  creditLedger,
  dataRequest,
  enrolment,
  family,
  familyMember,
  learnerProfile,
  notification,
  parentControl,
  project,
  projectVersion,
  quiz,
  quizAttempt,
  reflection,
  safeguardingCase,
  step,
  stepProgress,
  subscription,
  plan,
  tutorConversation,
  usageDay,
  user,
} from "@/server/db";
import { clearSentEmails, getSentEmails } from "@/server/email";
import { enqueue, flushJobs, getJob, runJob } from "@/server/jobs";
import { DATA_EXPORT_EVENT, dataDeleteDue, dataExport } from "@/server/jobs/data";
import { DELETION_UNDO_DAYS } from "@/server/services/children";
import {
  EXPORT_EVENT,
  EXPORT_LINK_DAYS,
  cancelDeletion,
  completeDueDeletions,
  getExportDownload,
  getRetentionSummary,
  listDataRequests,
  purgeExpiredExports,
  requestChildDeletion,
  requestExport,
  requestFamilyDeletion,
  requestSelfDeletion,
  runExport,
} from "@/server/services/data-request";
import { getStorage } from "@/server/storage";
import { closeDb, db, testCtx } from "../../helpers/db";
import { HOMEWORK, courseBySlug, enrol, seedCourses, tearDownStorage } from "../tools/helpers";
import { DAY_MS, appError, at, giveSession, makeFamily, readZip, secondParent, sessionCount, system, userRow, type TestFamily } from "./helpers";

// Only so that nothing here can ever reach a real safeguarding alert; the data-request code does not call it.
vi.mock("@/server/services/safeguarding", () => ({ countSafetyNoticesForLearner: vi.fn(async () => 0), openSafeguardingCase: vi.fn() }));

beforeAll(seedCourses);
afterAll(async () => {
  tearDownStorage();
  await closeDb();
});
beforeEach(() => clearSentEmails());

const NOW = new Date("2027-01-12T10:00:00Z");
const later = (days: number, extraMs = 0) => new Date(NOW.getTime() + days * DAY_MS + extraMs);

type Filled = { enrolmentId: string; projectId: string; acceptedKey: string; pendingKey: string; heldKey: string | null; conversationId: string; flaggedConversationId: string | null };

/**
 * Gives a learner one of everything, each piece marked with `tag` so that a leak between
 * children or families shows up as a string in the wrong place.
 */
async function fill(learnerId: string, tag: string, options: { safeguarding?: boolean } = {}): Promise<Filled> {
  const where = await enrol(learnerId, HOMEWORK, "completed");
  const steps = await db.select({ id: step.id, type: step.type }).from(step).where(eq(step.courseVersionId, where.versionId));
  const first = steps[0]!;
  await db.insert(stepProgress).values({ enrolmentId: where.enrolmentId, learnerId, stepId: first.id, status: "completed", notes: `${tag}-PRIVATE-NOTE`, data: { answer: `${tag}-ETHICS-ANSWER` }, completedAt: NOW });
  const reflective = steps.find((entry) => entry.type === "reflection") ?? steps[1]!;
  await db.insert(reflection).values({ learnerId, enrolmentId: where.enrolmentId, stepId: reflective.id, body: `${tag}-REFLECTION-TEXT` });
  const [anyQuiz] = await db.select({ id: quiz.id }).from(quiz).where(eq(quiz.courseVersionId, where.versionId)).limit(1);
  if (anyQuiz) await db.insert(quizAttempt).values({ learnerId, enrolmentId: where.enrolmentId, quizId: anyQuiz.id, attemptNumber: 1, answers: { q1: `${tag}-QUIZ-ANSWER` }, score: 80, passed: true });
  await db.insert(usageDay).values({ learnerId, day: "2027-01-11", seconds: 1500 }).onConflictDoNothing();

  const [made] = await db.insert(project).values({ learnerId, enrolmentId: where.enrolmentId, courseId: where.courseId, title: `${tag} project`, status: "accepted", acceptedAt: NOW }).returning();
  const [version] = await db.insert(projectVersion).values({ projectId: made!.id, learnerId, version: 1, note: `${tag}-SUBMISSION-NOTE`, moderationState: "approved", submittedAt: NOW, decidedAt: NOW }).returning();
  await db.update(project).set({ currentVersionId: version!.id }).where(eq(project.id, made!.id));
  const storage = getStorage("private");
  const acceptedKey = `evidence/${learnerId}/accepted.png`;
  const pendingKey = `evidence/${learnerId}/pending.png`;
  await storage.put(acceptedKey, Buffer.from(`${tag}-ACCEPTED-FILE-BYTES`), { contentType: "image/png" });
  await storage.put(pendingKey, Buffer.from(`${tag}-PENDING-FILE-BYTES`), { contentType: "image/png" });
  const base = { learnerId, enrolmentId: where.enrolmentId, projectId: made!.id, projectVersionId: version!.id };
  await db.insert(artefact).values([
    { ...base, kind: "link", url: `https://example.test/${tag.toLowerCase()}-project`, moderationState: "approved" },
    { ...base, kind: "screenshot", storageKey: acceptedKey, sha256: "a".repeat(64), sizeBytes: 24, mime: "image/png", moderationState: "approved" },
    { ...base, kind: "screenshot", storageKey: pendingKey, sha256: "b".repeat(64), sizeBytes: 23, mime: "image/png", moderationState: "pending" },
  ]);
  let heldKey: string | null = null;
  if (options.safeguarding) {
    heldKey = `quarantine/${crypto.randomUUID()}`;
    await storage.put(heldKey, Buffer.from(`${tag}-HELD-FILE-BYTES`), { contentType: "image/png" });
    await db.insert(artefact).values({ ...base, kind: "screenshot", storageKey: heldKey, sha256: "c".repeat(64), sizeBytes: 21, mime: "image/png", moderationState: "blocked", quarantined: true });
  }
  await db.insert(certificate).values({ learnerId, enrolmentId: where.enrolmentId, courseId: where.courseId, courseVersionId: where.versionId, projectId: made!.id, verifyCode: `V${crypto.randomUUID().slice(0, 10).toUpperCase()}`, displayName: tag, courseTitle: "Homework Helper", issuedAt: NOW });

  const [conversation] = await db.insert(tutorConversation).values({ learnerId, enrolmentId: where.enrolmentId, courseId: where.courseId, messageCount: 2, topics: [`${tag} topic`], lastMessageAt: NOW }).returning();
  await db.insert(aiRequest).values({ userId: learnerId, feature: "tutor", conversationId: conversation!.id, outcome: "ok", creditsCharged: 1, inputTokens: 10, outputTokens: 20, costMillipence: 5 });
  await db.insert(aiMessage).values([
    { conversationId: conversation!.id, learnerId, role: "user", contentEncrypted: encrypt(`${tag}-COACH-QUESTION`, "content"), keyVersion: 1, expiresAt: later(30) },
    { conversationId: conversation!.id, learnerId, role: "assistant", contentEncrypted: encrypt(`${tag}-COACH-ANSWER`, "content"), keyVersion: 1, expiresAt: later(30) },
  ]);
  let flaggedConversationId: string | null = null;
  if (options.safeguarding) {
    const [flagged] = await db.insert(tutorConversation).values({ learnerId, messageCount: 1, topics: [], flagged: true, lastMessageAt: NOW }).returning();
    flaggedConversationId = flagged!.id;
    await db.insert(aiMessage).values({ conversationId: flagged!.id, learnerId, role: "user", contentEncrypted: encrypt(`${tag}-DISCLOSURE`, "content"), keyVersion: 1, flagged: true, expiresAt: later(365) });
    await db.insert(safeguardingCase).values({ learnerId, severity: "high", trigger: "crisis_classifier" });
  }
  await db.insert(creditLedger).values({ learnerId, entryType: "grant", amount: 50, periodKey: "2027-01", idempotencyKey: `grant:${learnerId}:${crypto.randomUUID()}` });
  return { enrolmentId: where.enrolmentId, projectId: made!.id, acceptedKey, pendingKey, heldKey, conversationId: conversation!.id, flaggedConversationId };
}

async function exportZip(requestId: string): Promise<{ files: Map<string, Buffer>; text: string }> {
  const [row] = await db.select().from(dataRequest).where(eq(dataRequest.id, requestId));
  const stored = await getStorage("private").get(row!.exportStorageKey ?? "missing/key");
  if (!stored) throw new Error("no export file");
  const files = readZip(stored.body);
  return { files, text: [...files.values()].map((body) => body.toString("utf8")).join("\n") };
}

const requestRow = async (id: string) => (await db.select().from(dataRequest).where(eq(dataRequest.id, id)))[0]!;
const count = async (table: typeof enrolment | typeof artefact | typeof stepProgress | typeof tutorConversation | typeof certificate | typeof usageDay, learnerId: string) =>
  (await db.select({ id: table.id }).from(table).where(eq(table.learnerId, learnerId))).length;

describe("jobs", () => {
  it("are registered under the names the brief gives, and the export event matches the service", () => {
    expect(getJob("data.export")).toBeDefined();
    expect(getJob("data.delete_due")?.schedule).toBeDefined();
    expect(DATA_EXPORT_EVENT).toBe(EXPORT_EVENT);
    expect(dataExport.event).toBe(EXPORT_EVENT);
  });
});

describe("what we hold and why", () => {
  it("lists every kind of record in plain English with how long it is kept", async () => {
    const lines = await getRetentionSummary({ db });
    expect(lines.map((line) => line.key)).toEqual(expect.arrayContaining(["account_inactive", "tutor_conversation_default", "safeguarding_case", "consent_record", "billing_records", "audit_log"]));
    expect(lines.find((line) => line.key === "tutor_conversation_default")?.keptFor).toContain("30 days");
    expect(lines.find((line) => line.key === "billing_records")?.keptFor).toContain("6 years");
    expect(lines.find((line) => line.key === "account_inactive")?.keptFor).toContain("24 months");
  });
});

describe("downloading a child's data", () => {
  it("builds a ZIP with the expected files, and nothing from a sibling or another family", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const [maya, leo] = mine.children as [TestFamily["children"][number], TestFamily["children"][number]];
    const filled = await fill(maya.id, "MAYA", { safeguarding: true });
    await fill(leo.id, "LEO");
    await fill(theirs.children[0]!.id, "ZED");

    const view = await requestExport(mine.parent, { learnerId: maya.id });
    expect(view).toMatchObject({ kind: "export", status: "requested", learnerId: maya.id, learnerNickname: "Maya", downloadReady: false });
    // Asking again while it is being made is the same request, not a second one.
    expect((await requestExport(mine.parent, { learnerId: maya.id })).id).toBe(view.id);
    expect(await db.select().from(dataRequest).where(eq(dataRequest.learnerId, maya.id))).toHaveLength(1);

    const result = await runJob(dataExport, { requestId: view.id }, { now: NOW });
    expect(result.status).toBe("succeeded");
    const row = await requestRow(view.id);
    expect(row).toMatchObject({ status: "ready", familyId: mine.familyId, requestedBy: mine.parentId });
    expect(row.exportStorageKey).toMatch(/^exports\//);
    expect(row.exportExpiresAt?.getTime()).toBe(NOW.getTime() + EXPORT_LINK_DAYS * DAY_MS);

    const { files, text } = await exportZip(view.id);
    expect([...files.keys()].filter((name) => !name.startsWith("files/")).sort()).toEqual(["README.txt", "certificates.json", "coach.json", "consent-history.json", "profile.json", "progress.json", "requests.json", "submissions.json"]);

    // Every JSON file parses.
    for (const [name, body] of files) if (name.endsWith(".json")) expect(() => JSON.parse(body.toString("utf8"))).not.toThrow();
    const profile = JSON.parse(files.get("profile.json")!.toString("utf8"));
    expect(profile).toMatchObject({ nickname: "Maya", ageGroup: "teen_13_15" });
    const progress = JSON.parse(files.get("progress.json")!.toString("utf8"));
    expect(progress.courses).toHaveLength(1);
    expect(progress.courses[0].steps[0]).toMatchObject({ status: "completed", hasNotes: true });
    expect(progress.timeByDay).toEqual([{ date: "2027-01-11", minutes: 25 }]);
    const consent = JSON.parse(files.get("consent-history.json")!.toString("utf8"));
    expect(consent.map((entry: { permission: string }) => entry.permission).sort()).toEqual(["account_learning_data", "ai_processing", "third_party_tools"]);
    expect(JSON.parse(files.get("certificates.json")!.toString("utf8"))).toHaveLength(1);
    const coach = JSON.parse(files.get("coach.json")!.toString("utf8"));
    expect(coach.conversations).toHaveLength(2);
    expect(coach.conversations[0]).toMatchObject({ messageCount: 2, topics: ["MAYA topic"] });
    expect(coach.use).toHaveLength(1);

    // The accepted file is in, byte for byte; the link is listed.
    const stored = [...files.keys()].filter((name) => name.startsWith("files/"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain(filled.projectId);
    expect(files.get(stored[0]!)?.toString("utf8")).toBe("MAYA-ACCEPTED-FILE-BYTES");
    expect(text).toContain("https://example.test/maya-project");

    // Nothing of the sibling's or the other family's.
    expect(text).not.toMatch(/LEO|ZED|Leo|Zed/);

    // The child's private writing is not handed to a parent, and neither is work that is not accepted.
    for (const marker of ["MAYA-PRIVATE-NOTE", "MAYA-ETHICS-ANSWER", "MAYA-REFLECTION-TEXT", "MAYA-QUIZ-ANSWER", "MAYA-SUBMISSION-NOTE", "MAYA-COACH-QUESTION", "MAYA-COACH-ANSWER", "MAYA-PENDING-FILE-BYTES"]) expect(text).not.toContain(marker);
    // Anything held for safeguarding stays out, and nothing in the download hints that it exists.
    expect(text).not.toContain("MAYA-DISCLOSURE");
    expect(text).not.toContain("MAYA-HELD-FILE-BYTES");
    expect(files.get("coach.json")!.toString("utf8")).not.toMatch(/flag|crisis|safeguard/i);
    expect(files.get("README.txt")!.toString("utf8")).toContain("safeguarding policy");

    // The email carries a link to our own page, never the file or a key to it.
    const emails = getSentEmails().filter((email) => email.template === "data_export_ready");
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe(mine.parentEmail);
    expect(emails[0]?.text).toContain("/parent/privacy");
    expect(emails[0]?.text).not.toContain(row.exportStorageKey ?? "x");
    expect(emails[0]?.text).not.toContain("/api/files");
    expect(await db.select().from(notification).where(and(eq(notification.userId, mine.parentId), eq(notification.type, "data.export_ready"), eq(notification.channel, "in_app")))).toHaveLength(1);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "data.export.ready"))).length).toBeGreaterThan(0);

    // Running the job again is harmless.
    expect(await runExport(system("data.export", NOW), view.id)).toMatchObject({ status: "skipped" });
  });

  it("hands the file only to a signed-in parent of the same family, and only for seven days", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const carer = at(await secondParent(mine.familyId), NOW);
    const maya = mine.children[0]!;
    await fill(maya.id, "MAYA");
    const view = await requestExport(mine.parent, { learnerId: maya.id });

    expect((await appError(() => getExportDownload(mine.parent, view.id))).code).toBe("not_ready");
    await runExport(system("data.export", NOW), view.id);

    const link = await getExportDownload(mine.parent, view.id);
    expect(link.url).toContain("your-data.zip");
    expect(link.expiresInSec).toBeLessThanOrEqual(300);
    expect((await getExportDownload(carer, view.id)).url).toEqual(expect.any(String));
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, "data.export.download"), eq(auditLog.targetId, view.id)))).length).toBe(2);

    expect((await appError(() => getExportDownload(theirs.parent, view.id))).code).toBe("not_found");
    expect((await appError(() => getExportDownload(maya.ctx, view.id))).code).toBe("forbidden");
    expect((await appError(() => getExportDownload(theirs.children[0]!.ctx, view.id))).code).toBe("forbidden");
    expect((await appError(() => getExportDownload(testCtx(), view.id))).code).toBe("unauthenticated");
    expect((await appError(() => getExportDownload(mine.parent, crypto.randomUUID()))).code).toBe("not_found");

    // One second before the seven days are up it still works; at seven days it does not.
    expect((await getExportDownload(at(mine.parent, later(EXPORT_LINK_DAYS, -1000)), view.id)).url).toEqual(expect.any(String));
    expect((await appError(() => getExportDownload(at(mine.parent, later(EXPORT_LINK_DAYS)), view.id))).code).toBe("not_found");

    const key = (await requestRow(view.id)).exportStorageKey!;
    expect(await purgeExpiredExports({ db, now: later(EXPORT_LINK_DAYS, -1000) })).toEqual({ exportsRemoved: 0 });
    expect(await getStorage("private").exists(key)).toBe(true);
    expect((await purgeExpiredExports({ db, now: later(EXPORT_LINK_DAYS, 1000) })).exportsRemoved).toBeGreaterThanOrEqual(1);
    expect(await getStorage("private").exists(key)).toBe(false);
    expect(await requestRow(view.id)).toMatchObject({ status: "completed", exportStorageKey: null });
  });

  it("is refused for another family's child, for an under-18 asking for themselves, and for visitors", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed", age: 17 }], { now: NOW });
    const zed = theirs.children[0]!;
    expect((await appError(() => requestExport(mine.parent, { learnerId: zed.id }))).code).toBe("not_found");
    expect((await appError(() => requestExport(mine.parent, { learnerId: crypto.randomUUID() }))).code).toBe("not_found");
    expect((await appError(() => requestExport(mine.parent, {}))).code).toBe("not_found");
    expect((await appError(() => requestExport(zed.ctx, {}))).code).toBe("forbidden");
    expect((await appError(() => requestExport(testCtx(), { learnerId: zed.id }))).code).toBe("unauthenticated");
    expect(await db.select().from(dataRequest).where(inArray(dataRequest.learnerId, [zed.id, mine.children[0]!.id]))).toHaveLength(0);
    expect((await appError(() => listDataRequests(zed.ctx))).code).toBe("forbidden");
  });

  it("is built by the queued job when the request is made", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }]);
    const view = await requestExport(mine.parent, { learnerId: mine.children[0]!.id });
    await flushJobs();
    expect((await requestRow(view.id)).status).toBe("ready");
    // Enqueuing it a second time by hand changes nothing.
    await enqueue(EXPORT_EVENT, { requestId: view.id }, { idempotencyKey: `data-export:${view.id}` });
    await flushJobs();
    expect((await requestRow(view.id)).status).toBe("ready");
  });
});

describe("deleting a child's account", () => {
  it("closes the account, can be undone inside 14 days, and nothing is deleted meanwhile", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const maya = mine.children[0]!;
    const filled = await fill(maya.id, "MAYA");
    await giveSession(maya.id);

    const view = await requestChildDeletion(mine.parent, maya.id);
    expect(view).toMatchObject({ kind: "delete", status: "requested", scope: "learner", learnerId: maya.id, canUndo: true });
    expect(view.undoUntil?.getTime()).toBe(NOW.getTime() + DELETION_UNDO_DAYS * DAY_MS);
    expect(await userRow(maya.id)).toMatchObject({ status: "pending_deletion" });
    expect(await sessionCount(maya.id)).toBe(0);

    const scheduled = getSentEmails().filter((email) => email.template === "data_delete_scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.to).toBe(mine.parentEmail);
    expect(scheduled[0]?.text).toContain("Maya's account");
    expect(scheduled[0]?.text).toMatch(/permissions you gave or withdrew/);
    expect(scheduled[0]?.text).toMatch(/Safeguarding records/);

    // The job runs every hour. One second before the window ends it must do nothing.
    const early = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, -1000)));
    expect(early).toMatchObject({ due: 0, completed: 0 });
    expect(await count(enrolment, maya.id)).toBe(1);
    expect(await getStorage("private").exists(filled.acceptedKey)).toBe(true);

    // Another family cannot undo it; the child cannot; the parent can.
    expect((await appError(() => cancelDeletion(theirs.parent, view.id))).code).toBe("not_found");
    expect((await appError(() => cancelDeletion(maya.ctx, view.id))).code).toBe("forbidden");
    clearSentEmails();
    const undone = await cancelDeletion(at(mine.parent, later(13)), view.id);
    expect(undone).toMatchObject({ status: "cancelled", canUndo: false });
    expect(await userRow(maya.id)).toMatchObject({ status: "active", statusReason: null });
    expect(getSentEmails().filter((email) => email.template === "data_delete_cancelled")).toHaveLength(1);

    // After an undo the job never touches the account, however late it runs.
    const after = await completeDueDeletions(system("data.delete_due", later(40)));
    expect(after.completed).toBe(0);
    expect(await userRow(maya.id)).toMatchObject({ status: "active" });
    expect(await count(enrolment, maya.id)).toBe(1);
    expect(await count(artefact, maya.id)).toBe(3);
    expect(await getStorage("private").exists(filled.acceptedKey)).toBe(true);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "data.delete.cancel"))).length).toBeGreaterThan(0);
  });

  it("puts a child back as paused if a parent had paused them, or held if permissions are missing", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW, consent: false });
    const [maya, leo] = mine.children as [TestFamily["children"][number], TestFamily["children"][number]];
    const first = await requestChildDeletion(mine.parent, maya.id);
    await cancelDeletion(mine.parent, first.id);
    expect(await userRow(maya.id)).toMatchObject({ status: "paused", statusReason: "consent_required" });

    const { grantRequiredConsents } = await import("./helpers");
    await grantRequiredConsents(leo.id, mine.parentId, mine.familyId);
    await db.insert(parentControl).values({ learnerId: leo.id, familyId: mine.familyId, paused: true });
    const second = await requestChildDeletion(mine.parent, leo.id);
    await cancelDeletion(mine.parent, second.id);
    expect(await userRow(leo.id)).toMatchObject({ status: "paused", statusReason: "paused_by_parent" });
  });

  it("when the 14 days end, removes the rows and the files, keeps what must be kept, and leaves everyone else alone", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW });
    const [maya, leo] = mine.children as [TestFamily["children"][number], TestFamily["children"][number]];
    const filled = await fill(maya.id, "MAYA");
    const leoFilled = await fill(leo.id, "LEO");

    // An export made earlier must go too.
    const exported = await requestExport(mine.parent, { learnerId: maya.id });
    await runExport(system("data.export", NOW), exported.id);
    const exportKey = (await requestRow(exported.id)).exportStorageKey!;

    const view = await requestChildDeletion(mine.parent, maya.id);
    clearSentEmails();
    const done = await runJob(dataDeleteDue, undefined, { now: later(DELETION_UNDO_DAYS, 1000) });
    expect(done.status).toBe("succeeded");
    if (done.status === "succeeded") expect(done.summary).toMatchObject({ completed: 1, failed: 0, learnersErased: 1, learnersAnonymised: 0 });

    // The account and everything that hung off it has gone.
    expect(await userRow(maya.id)).toBeNull();
    expect(await db.select().from(learnerProfile).where(eq(learnerProfile.userId, maya.id))).toHaveLength(0);
    for (const table of [enrolment, artefact, stepProgress, tutorConversation, certificate, usageDay] as const) expect(await count(table, maya.id)).toBe(0);
    expect(await db.select().from(reflection).where(eq(reflection.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(project).where(eq(project.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(aiMessage).where(eq(aiMessage.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(aiRequest).where(eq(aiRequest.userId, maya.id))).toHaveLength(0);
    expect(await db.select().from(creditLedger).where(eq(creditLedger.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(familyMember).where(eq(familyMember.userId, maya.id))).toHaveLength(0);
    // The files too: accepted work, work in progress, and the export.
    const storage = getStorage("private");
    expect(await storage.exists(filled.acceptedKey)).toBe(false);
    expect(await storage.exists(filled.pendingKey)).toBe(false);
    expect(await storage.exists(exportKey)).toBe(false);

    // Kept: the consent records (an id, no name) and the audit trail.
    expect((await db.select().from(consentRecord).where(eq(consentRecord.learnerId, maya.id))).length).toBe(3);
    const trail = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.targetId, maya.id))).map((row) => row.action);
    expect(trail).toEqual(expect.arrayContaining(["family.child.remove", "data.delete.complete"]));

    // The request is closed and can no longer be undone.
    expect(await requestRow(view.id)).toMatchObject({ status: "completed", learnerId: null, familyId: mine.familyId });
    expect((await appError(() => cancelDeletion(at(mine.parent, later(15)), view.id))).code).toBe("conflict");
    const completed = getSentEmails().filter((email) => email.template === "data_delete_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.to).toBe(mine.parentEmail);

    // The sibling and the parent are exactly as they were.
    expect(await userRow(leo.id)).toMatchObject({ status: "active" });
    expect(await count(enrolment, leo.id)).toBe(1);
    expect(await count(artefact, leo.id)).toBe(3);
    expect(await storage.exists(leoFilled.acceptedKey)).toBe(true);
    expect(await userRow(mine.parentId)).toMatchObject({ status: "active" });
    expect((await db.select().from(family).where(eq(family.id, mine.familyId))).length).toBe(1);

    // A second run finds nothing to do.
    expect(await completeDueDeletions(system("data.delete_due", later(20)))).toMatchObject({ due: 0, completed: 0 });
  });

  it("keeps safeguarding records under their own schedule, with the account anonymised around them", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const maya = mine.children[0]!;
    const filled = await fill(maya.id, "MAYA", { safeguarding: true });
    await requestChildDeletion(mine.parent, maya.id);
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    expect(summary).toMatchObject({ completed: 1, learnersErased: 0, learnersAnonymised: 1 });

    // A shell with nothing that identifies the child, and no way to sign in.
    const shell = await userRow(maya.id);
    expect(shell).toMatchObject({ status: "deleted", name: "Deleted learner", username: null, emailVerified: false });
    expect(shell?.email).toMatch(/@learner\.invalid$/);
    expect(await db.select().from(learnerProfile).where(eq(learnerProfile.userId, maya.id))).toHaveLength(0);
    expect(await db.select().from(familyMember).where(eq(familyMember.userId, maya.id))).toHaveLength(0);

    // Held: the case, the flagged conversation and its message, the quarantined file and its row.
    expect(await db.select().from(safeguardingCase).where(eq(safeguardingCase.learnerId, maya.id))).toHaveLength(1);
    const chats = await db.select().from(tutorConversation).where(eq(tutorConversation.learnerId, maya.id));
    expect(chats.map((chat) => chat.id)).toEqual([filled.flaggedConversationId]);
    expect(await db.select().from(aiMessage).where(eq(aiMessage.learnerId, maya.id))).toHaveLength(1);
    const kept = await db.select().from(artefact).where(eq(artefact.learnerId, maya.id));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ quarantined: true, storageKey: filled.heldKey });
    expect(await getStorage("private").exists(filled.heldKey!)).toBe(true);

    // Gone: everything ordinary.
    expect(await getStorage("private").exists(filled.acceptedKey)).toBe(false);
    expect(await getStorage("private").exists(filled.pendingKey)).toBe(false);
    for (const table of [stepProgress, certificate, usageDay] as const) expect(await count(table, maya.id)).toBe(0);
    expect(await db.select().from(reflection).where(eq(reflection.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(project).where(eq(project.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(quizAttempt).where(eq(quizAttempt.learnerId, maya.id))).toHaveLength(0);
    expect(await db.select().from(aiRequest).where(eq(aiRequest.userId, maya.id))).toHaveLength(0);
    expect((await db.select().from(consentRecord).where(eq(consentRecord.learnerId, maya.id))).length).toBe(3);
  });

  it("is refused for another family's child and for an 18-year-old who runs their own account", async () => {
    const mine = await makeFamily([{ nickname: "Sam", age: 18 }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const sam = mine.children[0]!;
    await db.update(user).set({ email: `sam-${crypto.randomUUID()}@example.test`, emailVerified: true }).where(eq(user.id, sam.id));
    expect((await appError(() => requestChildDeletion(mine.parent, theirs.children[0]!.id))).code).toBe("not_found");
    expect((await appError(() => requestChildDeletion(mine.parent, sam.id))).code).toBe("forbidden");
    expect((await appError(() => requestExport(mine.parent, { learnerId: sam.id }))).code).toBe("forbidden");
    expect((await appError(() => requestChildDeletion(theirs.children[0]!.ctx, theirs.children[0]!.id))).code).toBe("forbidden");
    expect((await userRow(theirs.children[0]!.id))?.status).toBe("active");
    expect((await userRow(sam.id))?.status).toBe("active");
  });
});

describe("deleting the whole family", () => {
  it("only the owner can ask; children close at once; it can be undone", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Leo" }], { now: NOW });
    const carer = at(await secondParent(mine.familyId), NOW);
    const [maya, leo] = mine.children as [TestFamily["children"][number], TestFamily["children"][number]];
    await giveSession(maya.id);
    expect((await appError(() => requestFamilyDeletion(carer))).code).toBe("forbidden");
    expect((await appError(() => requestFamilyDeletion(maya.ctx))).code).toBe("forbidden");

    const view = await requestFamilyDeletion(mine.parent);
    expect(view).toMatchObject({ kind: "delete", scope: "family", learnerId: null, canUndo: true });
    expect((await requestFamilyDeletion(mine.parent)).id).toBe(view.id);
    expect(await userRow(maya.id)).toMatchObject({ status: "pending_deletion", statusReason: "family_deletion" });
    expect(await userRow(leo.id)).toMatchObject({ status: "pending_deletion" });
    expect(await sessionCount(maya.id)).toBe(0);
    // The adults stay able to sign in: someone has to be able to undo it.
    expect(await userRow(mine.parentId)).toMatchObject({ status: "active" });
    expect(getSentEmails().filter((email) => email.template === "data_delete_scheduled")).toHaveLength(1);

    await cancelDeletion(carer, view.id);
    expect(await userRow(maya.id)).toMatchObject({ status: "active" });
    expect(await userRow(leo.id)).toMatchObject({ status: "active" });
    expect((await completeDueDeletions(system("data.delete_due", later(30)))).completed).toBe(0);
    expect(await userRow(mine.parentId)).toMatchObject({ status: "active" });
  });

  it("when the 14 days end, removes every child, every adult and the family, and tells the owner", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }, { nickname: "Sam", age: 18 }], { now: NOW });
    const theirs = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    const carer = await secondParent(mine.familyId);
    const [maya, sam] = mine.children as [TestFamily["children"][number], TestFamily["children"][number]];
    // Sam is 18 and has taken over their own account, but stayed linked.
    await db.update(user).set({ email: `sam-${crypto.randomUUID()}@example.test`, emailVerified: true }).where(eq(user.id, sam.id));
    const filled = await fill(maya.id, "MAYA");
    const samFilled = await fill(sam.id, "SAM");
    const zedFilled = await fill(theirs.children[0]!.id, "ZED");

    await requestFamilyDeletion(mine.parent);
    expect(await userRow(sam.id)).toMatchObject({ status: "active" });
    clearSentEmails();
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    expect(summary).toMatchObject({ completed: 1, failed: 0, learnersErased: 1, adultsErased: 2 });

    expect(await userRow(maya.id)).toBeNull();
    expect(await userRow(mine.parentId)).toBeNull();
    expect(await userRow(carer.actor.userId)).toBeNull();
    expect(await db.select().from(family).where(eq(family.id, mine.familyId))).toHaveLength(0);
    expect(await getStorage("private").exists(filled.acceptedKey)).toBe(false);
    expect((await db.select().from(consentRecord).where(eq(consentRecord.learnerId, maya.id))).length).toBe(3);

    // The 18-year-old keeps their account and their work, in a family of their own.
    expect(await userRow(sam.id)).toMatchObject({ status: "active" });
    const [membership] = await db.select().from(familyMember).where(eq(familyMember.userId, sam.id));
    expect(membership?.familyId).not.toBe(mine.familyId);
    const [own] = await db.select().from(family).where(eq(family.id, membership!.familyId));
    expect(own).toMatchObject({ ownerUserId: sam.id, plan: "free" });
    expect(await count(enrolment, sam.id)).toBe(1);
    expect(await getStorage("private").exists(samFilled.acceptedKey)).toBe(true);

    // Another family is untouched.
    expect(await userRow(theirs.parentId)).toMatchObject({ status: "active" });
    expect(await count(enrolment, theirs.children[0]!.id)).toBe(1);
    expect(await getStorage("private").exists(zedFilled.acceptedKey)).toBe(true);

    const completed = getSentEmails().filter((email) => email.template === "data_delete_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.to).toBe(mine.parentEmail);
  });

  it("keeps payment records: the family row stays and the owner is anonymised", async () => {
    const mine = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const [paidPlan] = await db.insert(plan).values({ key: `family-${crypto.randomUUID().slice(0, 6)}`, name: "Family", priceMonthlyPence: 1499, priceAnnualPence: 11900, seats: 4, coachCredits: 200 }).returning();
    await db.update(family).set({ stripeCustomerId: `cus_${crypto.randomUUID().slice(0, 8)}` }).where(eq(family.id, mine.familyId));
    // A subscription that has already ended: a payment record, with nothing left to cancel.
    await db.insert(subscription).values({ familyId: mine.familyId, planId: paidPlan!.id, status: "canceled" });

    await requestFamilyDeletion(mine.parent);
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    expect(summary).toMatchObject({ completed: 1, failed: 0, learnersErased: 1 });

    expect(await userRow(mine.children[0]!.id)).toBeNull();
    const owner = await userRow(mine.parentId);
    expect(owner).toMatchObject({ status: "deleted", name: "Deleted account", emailVerified: false });
    expect(owner?.email).not.toBe(mine.parentEmail);
    expect(owner?.email).toMatch(/@deleted\.invalid$/);
    expect(await db.select().from(familyMember).where(eq(familyMember.familyId, mine.familyId))).toHaveLength(0);
    expect(await db.select().from(family).where(eq(family.id, mine.familyId))).toHaveLength(1);
    expect(await db.select().from(subscription).where(eq(subscription.familyId, mine.familyId))).toHaveLength(1);
  });
});

describe("an 18-year-old acting for themselves", () => {
  it("downloads their own data, private writing included, and a parent cannot collect it", async () => {
    const mine = await makeFamily([{ nickname: "Sam", age: 18 }], { now: NOW });
    const sam = mine.children[0]!;
    await fill(sam.id, "SAM", { safeguarding: true });

    const view = await requestExport(sam.ctx);
    expect(view).toMatchObject({ kind: "export", learnerId: sam.id });
    await runExport(system("data.export", NOW), view.id);
    const { files, text } = await exportZip(view.id);
    for (const marker of ["SAM-PRIVATE-NOTE", "SAM-REFLECTION-TEXT", "SAM-SUBMISSION-NOTE", "SAM-COACH-QUESTION", "SAM-COACH-ANSWER", "SAM-ACCEPTED-FILE-BYTES", "SAM-PENDING-FILE-BYTES"]) expect(text).toContain(marker);
    // Still never anything held for safeguarding, even to the learner.
    expect(text).not.toContain("SAM-DISCLOSURE");
    expect(text).not.toContain("SAM-HELD-FILE-BYTES");
    expect([...files.keys()].filter((name) => name.startsWith("files/"))).toHaveLength(2);

    expect((await getExportDownload(sam.ctx, view.id)).url).toEqual(expect.any(String));
    // The parent in the same family is neither shown it nor able to fetch it.
    expect((await appError(() => getExportDownload(mine.parent, view.id))).code).toBe("not_found");
    expect((await listDataRequests(mine.parent)).map((request) => request.id)).not.toContain(view.id);
    expect((await listDataRequests(sam.ctx)).map((request) => request.id)).toContain(view.id);
    // And they can only ever name themselves.
    const other = await makeFamily([{ nickname: "Zed" }], { now: NOW });
    expect((await appError(() => requestExport(sam.ctx, { learnerId: other.children[0]!.id }))).code).toBe("not_found");
  });

  it("deletes their own account with the same 14 days to undo; a parent cannot undo it for them", async () => {
    const mine = await makeFamily([{ nickname: "Sam", age: 18 }], { now: NOW });
    const sam = mine.children[0]!;
    const filled = await fill(sam.id, "SAM");

    const view = await requestSelfDeletion(sam.ctx);
    expect(view).toMatchObject({ kind: "delete", scope: "learner", learnerId: sam.id, canUndo: true });
    expect(await userRow(sam.id)).toMatchObject({ status: "pending_deletion", statusReason: "deleted_by_self" });
    expect((await appError(() => cancelDeletion(mine.parent, view.id))).code).toBe("not_found");

    // Undo, as the learner, from an account that is waiting to be deleted.
    const waiting = { ...sam.ctx, actor: { ...sam.ctx.actor, status: "pending_deletion" as const } };
    await cancelDeletion(waiting, view.id);
    expect(await userRow(sam.id)).toMatchObject({ status: "active" });

    const again = await requestSelfDeletion(sam.ctx);
    expect(again.id).not.toBe(view.id);
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    expect(summary).toMatchObject({ completed: 1, learnersErased: 1 });
    expect(await userRow(sam.id)).toBeNull();
    expect(await getStorage("private").exists(filled.acceptedKey)).toBe(false);
    expect((await db.select().from(consentRecord).where(eq(consentRecord.learnerId, sam.id))).length).toBe(3);
    // The parent's family carries on.
    expect(await userRow(mine.parentId)).toMatchObject({ status: "active" });
    expect(await db.select().from(family).where(eq(family.id, mine.familyId))).toHaveLength(1);
  });

  it("who owns their own family takes the family with them", async () => {
    const { createLearner } = await import("../../helpers/factories");
    const { grantRequiredConsents } = await import("./helpers");
    const adult = await createLearner({ age: 18, nickname: "Rio", now: NOW });
    await db.update(user).set({ email: `rio-${crypto.randomUUID()}@example.test`, emailVerified: true }).where(eq(user.id, adult.user.id));
    const [own] = await db.insert(family).values({ ownerUserId: adult.user.id, plan: "free" }).returning();
    await db.insert(familyMember).values({ familyId: own!.id, userId: adult.user.id, role: "learner" });
    await grantRequiredConsents(adult.user.id, adult.user.id, own!.id);
    const ctx = testCtx({ ...adult.actor, familyId: own!.id }, { now: NOW });
    await fill(adult.user.id, "RIO");

    await requestSelfDeletion(ctx);
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    expect(summary).toMatchObject({ completed: 1, failed: 0, learnersErased: 1 });
    expect(await userRow(adult.user.id)).toBeNull();
    expect(await db.select().from(family).where(eq(family.id, own!.id))).toHaveLength(0);
  });

  it("is not available to a learner under 18", async () => {
    const mine = await makeFamily([{ nickname: "Maya", age: 17 }], { now: NOW });
    const maya = mine.children[0]!;
    expect((await appError(() => requestSelfDeletion(maya.ctx))).code).toBe("forbidden");
    expect((await appError(() => requestExport(maya.ctx))).code).toBe("forbidden");
    expect((await userRow(maya.id))?.status).toBe("active");
    expect((await appError(() => requestSelfDeletion(mine.parent))).code).toBe("forbidden");
  });
});

describe("the hourly job", () => {
  it("refuses to run for anyone but the system", async () => {
    const mine = await makeFamily();
    expect((await appError(() => completeDueDeletions(mine.parent))).code).toBe("forbidden");
  });

  it("records a failure, carries on with the others, and tries the failed one again", async () => {
    const one = await makeFamily([{ nickname: "Maya" }], { now: NOW });
    const two = await makeFamily([{ nickname: "Leo" }], { now: NOW });
    const first = await requestChildDeletion(one.parent, one.children[0]!.id);
    const second = await requestChildDeletion(two.parent, two.children[0]!.id);
    await fill(one.children[0]!.id, "MAYA");

    const storage = getStorage("private");
    const real = storage.delete.bind(storage);
    const spy = vi.spyOn(storage, "delete").mockImplementation(async (key) => {
      if (key.includes(one.children[0]!.id)) throw new Error("storage is down");
      return real(key);
    });
    const summary = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 1000)));
    spy.mockRestore();
    expect(summary).toMatchObject({ completed: 1, failed: 1 });
    expect(await requestRow(first.id)).toMatchObject({ status: "failed" });
    expect(await requestRow(second.id)).toMatchObject({ status: "completed" });
    // Nothing was half-deleted: the rows that say where the files are still exist.
    expect(await userRow(one.children[0]!.id)).toMatchObject({ status: "pending_deletion" });
    expect(await count(artefact, one.children[0]!.id)).toBe(3);

    const retry = await completeDueDeletions(system("data.delete_due", later(DELETION_UNDO_DAYS, 3_600_000)));
    expect(retry).toMatchObject({ completed: 1, failed: 0 });
    expect(await userRow(one.children[0]!.id)).toBeNull();
  });
});
