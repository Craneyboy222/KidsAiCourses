import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import {
  aiMessage,
  aiRequest,
  artefact,
  auditLog,
  consentRecord,
  course,
  creditLedger,
  dataRequest,
  enrolment,
  jobRun,
  moderationItem,
  notification,
  retentionPolicy,
  safeguardingCase,
  stripeEvent,
  tutorConversation,
  user,
} from "@/server/db";
import { runJob } from "@/server/jobs";
import { retentionSweep } from "@/server/jobs/retention";
import { JOBS } from "@/server/jobs/registry";
import { RETENTION_DEFAULTS, ensureRetentionPolicies, listRetentionPolicies, runRetentionSweep, setRetentionDays } from "@/server/services/retention";
import { createLocalStorage, getStorage, setStorage } from "@/server/storage";
import { importContent } from "../../../scripts/import-courses";
import { scriptCtx } from "../../../scripts/import-ideas";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createParentLinkRequest, createStaff } from "../../helpers/factories";

const NOW = new Date("2027-03-10T03:15:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);
const system = (): Ctx => testCtx(systemActor("retention.sweep"), { now: NOW });

let storageDir: string;
beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "retention-test-"));
  setStorage("private", createLocalStorage("private", { rootDir: storageDir }));
});
afterAll(async () => {
  setStorage("private", undefined);
  await rm(storageDir, { recursive: true, force: true });
  await closeDb();
});
beforeEach(resetDb);

const countOf = async (table: string): Promise<number> => (await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"`)))[0]?.n ?? 0;

async function learnerInFamily(options: { lastActiveDaysAgo?: number; createdDaysAgo?: number } = {}) {
  const fam = await createFamily();
  const learner = await createLearner({ age: 14, familyId: fam.family.id, now: NOW });
  const created = daysAgo(options.createdDaysAgo ?? 900);
  await db.update(user).set({ createdAt: created, lastActiveAt: options.lastActiveDaysAgo === undefined ? null : daysAgo(options.lastActiveDaysAgo) }).where(eq(user.id, learner.user.id));
  return { familyId: fam.family.id, parentId: fam.parent.id, learnerId: learner.user.id };
}

async function conversation(learnerId: string, options: { caseId?: string } = {}): Promise<string> {
  const [row] = await db.insert(tutorConversation).values({ learnerId, messageCount: 2, topics: ["prompts"], flagged: options.caseId !== undefined, safeguardingCaseId: options.caseId ?? null }).returning({ id: tutorConversation.id });
  if (!row) throw new Error("no conversation");
  return row.id;
}
const message = (conversationId: string, learnerId: string, expiresAt: Date, flagged = false) => db.insert(aiMessage).values({ conversationId, learnerId, role: "user", contentEncrypted: "v1:ciphertext", expiresAt, flagged }).returning({ id: aiMessage.id });

describe("retention policies", () => {
  it("adds the defaults once, with the scales on periods the law decides, and never overwrites an edited period", async () => {
    const first = await ensureRetentionPolicies(system());
    const withDays = RETENTION_DEFAULTS.filter((policy) => policy.days > 0);
    expect(first.inserted.sort()).toEqual(withDays.map((policy) => policy.key).sort());

    const { actor } = await createStaff({ roles: ["admin"] });
    await setRetentionDays(testCtx(actor, { now: NOW }), "tutor_conversation_default", 45, "Owner asked for longer");
    const second = await ensureRetentionPolicies(system());
    expect(second.inserted).toEqual([]);

    const rows = await db.select().from(retentionPolicy);
    expect(rows).toHaveLength(withDays.length);
    expect(rows.find((row) => row.key === "tutor_conversation_default")?.days).toBe(45);
    expect(rows.find((row) => row.key === "billing_records")?.description.startsWith("⚖️ ")).toBe(true);
    expect(rows.find((row) => row.key === "job_run_log")?.description).not.toContain("⚖️");

    const listed = await listRetentionPolicies(testCtx(actor, { now: NOW }));
    expect(listed.find((policy) => policy.key === "safeguarding_case")).toMatchObject({ days: 0, legal: true });
    expect(listed.find((policy) => policy.key === "tutor_conversation_default")).toMatchObject({ days: 45, isDefault: false });
  });

  it("is for admins and the system only", async () => {
    const { actor: editor } = await createStaff({ roles: ["editor"] });
    const { parentActor } = await createFamily();
    for (const actor of [editor, parentActor]) {
      await expect(runRetentionSweep(testCtx(actor, { now: NOW }), { dryRun: true })).rejects.toMatchObject({ code: "forbidden" });
      await expect(ensureRetentionPolicies(testCtx(actor, { now: NOW }))).rejects.toMatchObject({ code: "forbidden" });
    }
    const { actor: admin } = await createStaff({ roles: ["admin"] });
    await expect(setRetentionDays(testCtx(admin, { now: NOW }), "safeguarding_case", 30)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setRetentionDays(testCtx(admin, { now: NOW }), "ai_metadata", 0)).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("the sweep deletes what is due and nothing else", () => {
  it("deletes Coach messages past their date, keeps the rest, and keeps counts and topics", async () => {
    const { learnerId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const old = await conversation(learnerId);
    const live = await conversation(learnerId);
    await message(old, learnerId, daysAgo(1));
    await message(old, learnerId, daysAgo(2));
    const [kept] = await message(live, learnerId, new Date(NOW.getTime() + 5 * DAY));
    await message(live, learnerId, daysAgo(1));

    const summary = await runRetentionSweep(system());
    expect(summary).toMatchObject({ dryRun: false, coachMessagesDeleted: 3, coachConversationsCleared: 1, failedSteps: [] });
    expect((await db.select({ id: aiMessage.id }).from(aiMessage)).map((row) => row.id)).toEqual([kept?.id]);
    const [cleared] = await db.select().from(tutorConversation).where(eq(tutorConversation.id, old));
    expect(cleared).toMatchObject({ messageCount: 2, topics: ["prompts"] });
    expect(cleared?.contentDeletedAt?.getTime()).toBe(NOW.getTime());
    const [untouched] = await db.select().from(tutorConversation).where(eq(tutorConversation.id, live));
    expect(untouched?.contentDeletedAt).toBeNull();
  });

  it("holds a flagged conversation while its safeguarding case is open, and for the flagged period after it closes", async () => {
    const { learnerId, familyId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const newCase = async (closedAt: Date | null) => {
      const [row] = await db.insert(safeguardingCase).values({ learnerId, familyId, severity: "high", status: closedAt ? "closed" : "open", trigger: "crisis_classifier", closedAt }).returning({ id: safeguardingCase.id });
      if (!row) throw new Error("no case");
      return row.id;
    };
    const open = await conversation(learnerId, { caseId: await newCase(null) });
    const recentlyClosed = await conversation(learnerId, { caseId: await newCase(daysAgo(100)) });
    const longClosed = await conversation(learnerId, { caseId: await newCase(daysAgo(400)) });
    for (const id of [open, recentlyClosed, longClosed]) await message(id, learnerId, daysAgo(10), true);

    const summary = await runRetentionSweep(system());
    expect(summary.coachMessagesDeleted).toBe(1);
    const left = (await db.select({ conversationId: aiMessage.conversationId }).from(aiMessage)).map((row) => row.conversationId).sort();
    expect(left).toEqual([open, recentlyClosed].sort());
    // Safeguarding cases themselves are never deleted by the sweep.
    expect(await countOf("safeguarding_case")).toBe(3);
  });

  it("deletes the stored file of a rejected upload as well as clearing the row, and touches no other file", async () => {
    await importContent(scriptCtx("content.import"), { publishAsSeed: true });
    const { learnerId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const [published] = await db.select({ id: course.id, versionId: course.publishedVersionId }).from(course).limit(1);
    if (!published?.versionId) throw new Error("no published course");
    const [enrolled] = await db.insert(enrolment).values({ learnerId, courseId: published.id, courseVersionId: published.versionId }).returning({ id: enrolment.id });
    if (!enrolled) throw new Error("no enrolment");
    const storage = getStorage("private");
    const add = async (name: string, values: Partial<typeof artefact.$inferInsert>) => {
      const storageKey = `evidence/${learnerId}/${name}.png`;
      await storage.put(storageKey, Buffer.from(`bytes of ${name}`), { contentType: "image/png" });
      const [row] = await db.insert(artefact).values({ learnerId, enrolmentId: enrolled.id, kind: "screenshot", storageKey, sha256: `hash-${name}`, sizeBytes: 9, mime: "image/png", ...values }).returning({ id: artefact.id });
      if (!row) throw new Error("no artefact");
      return { id: row.id, storageKey };
    };
    const rejected = await add("rejected", { moderationState: "blocked" });
    const accepted = await add("accepted", { moderationState: "approved" });
    const waiting = await add("waiting", { moderationState: "pending" });
    const quarantined = await add("quarantined", { moderationState: "blocked", quarantined: true });

    const dry = await runRetentionSweep(system(), { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, rejectedFilesDeleted: 1 });
    expect(await storage.exists(rejected.storageKey)).toBe(true);

    const summary = await runRetentionSweep(system());
    expect(summary.rejectedFilesDeleted).toBe(1);
    expect(await storage.exists(rejected.storageKey)).toBe(false);
    const [row] = await db.select().from(artefact).where(eq(artefact.id, rejected.id));
    expect(row).toMatchObject({ storageKey: null, sha256: "hash-rejected", mime: "image/png" });
    expect(row?.deletedFromStorageAt?.getTime()).toBe(NOW.getTime());
    for (const other of [accepted, waiting, quarantined]) {
      expect(await storage.exists(other.storageKey), other.storageKey).toBe(true);
      expect((await db.select({ key: artefact.storageKey }).from(artefact).where(eq(artefact.id, other.id)))[0]?.key).toBe(other.storageKey);
    }
    expect((await runRetentionSweep(system())).rejectedFilesDeleted).toBe(0);
  });

  it("deletes old request metadata, job runs, payment events and decided moderation items, and keeps recent or open ones", async () => {
    const { learnerId, familyId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const request = async (createdAt: Date) => (await db.insert(aiRequest).values({ userId: learnerId, feature: "tutor", outcome: "ok", createdAt }).returning({ id: aiRequest.id }))[0]?.id ?? "";
    const oldRequest = await request(daysAgo(400));
    const recentRequest = await request(daysAgo(300));
    const caseRequest = await request(daysAgo(500));
    await db.insert(safeguardingCase).values({ learnerId, familyId, severity: "high", trigger: "crisis_classifier", aiRequestId: caseRequest });

    await db.insert(jobRun).values([
      { job: "old.done", status: "succeeded", startedAt: daysAgo(120) },
      { job: "old.running", status: "running", startedAt: daysAgo(120) },
      { job: "new.done", status: "succeeded", startedAt: daysAgo(10) },
    ]);
    await db.insert(stripeEvent).values([
      { eventId: "evt_old", type: "invoice.paid", createdAt: daysAgo(2300) },
      { eventId: "evt_new", type: "invoice.paid", createdAt: daysAgo(30) },
    ]);
    await db.insert(moderationItem).values([
      { source: "sample", subjectType: "project_version", state: "approved", decidedAt: daysAgo(400) },
      { source: "sample", subjectType: "project_version", state: "approved", decidedAt: daysAgo(30) },
      { source: "report", subjectType: "report", state: "pending", createdAt: daysAgo(500) },
      { source: "auto", subjectType: "artefact", state: "escalated", decidedAt: daysAgo(500) },
    ]);

    const summary = await runRetentionSweep(system());
    expect(summary).toMatchObject({ aiRequestsDeleted: 1, jobRunsDeleted: 1, paymentEventsDeleted: 1, moderationItemsDeleted: 1, failedSteps: [], moreToDo: false });
    expect((await db.select({ id: aiRequest.id }).from(aiRequest)).map((row) => row.id).sort()).toEqual([recentRequest, caseRequest].sort());
    expect(oldRequest).not.toBe("");
    expect((await db.select({ job: jobRun.job }).from(jobRun)).map((row) => row.job).sort()).toEqual(["new.done", "old.running"]);
    expect((await db.select({ id: stripeEvent.eventId }).from(stripeEvent)).map((row) => row.id)).toEqual(["evt_new"]);
    expect((await db.select({ state: moderationItem.state }).from(moderationItem)).map((row) => row.state).sort()).toEqual(["approved", "escalated", "pending"]);
  });

  it("works in batches and says when there is more to do", async () => {
    const { learnerId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const chat = await conversation(learnerId);
    for (let i = 0; i < 7; i += 1) await message(chat, learnerId, daysAgo(1));
    const first = await runRetentionSweep(system(), { batchSize: 2, maxBatches: 2 });
    expect(first).toMatchObject({ coachMessagesDeleted: 4, moreToDo: true });
    const second = await runRetentionSweep(system(), { batchSize: 2, maxBatches: 2 });
    expect(second).toMatchObject({ coachMessagesDeleted: 3, moreToDo: false });
    expect(await countOf("ai_message")).toBe(0);
  });

  it("a dry run counts what would go and changes nothing at all", async () => {
    const { learnerId } = await learnerInFamily({ lastActiveDaysAgo: 720 });
    const chat = await conversation(learnerId);
    await message(chat, learnerId, daysAgo(1));
    await db.insert(jobRun).values({ job: "old.done", status: "succeeded", startedAt: daysAgo(120) });
    const pending = await createLearner({ age: 14, status: "pending_parent", now: NOW });
    await createParentLinkRequest({ learnerId: pending.user.id, expiresAt: daysAgo(1) });
    const before = { audit: await countOf("audit_log"), users: await countOf("user"), messages: await countOf("ai_message"), runs: await countOf("job_run"), notifications: await countOf("notification") };

    const { actor: admin } = await createStaff({ roles: ["admin"] });
    const summary = await runRetentionSweep(testCtx(admin, { now: NOW }), { dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, coachMessagesDeleted: 1, jobRunsDeleted: 1, pendingTeensPurged: 1, inactiveWarningsSent: 1, inactiveDeletionsScheduled: 0 });
    expect({ audit: await countOf("audit_log"), users: (await countOf("user")) - 1, messages: await countOf("ai_message"), runs: await countOf("job_run"), notifications: await countOf("notification") }).toEqual(before);
  });
});

describe("accounts", () => {
  it("purges a teen sign-up nobody approved, through the accounts service", async () => {
    const stale = await createLearner({ age: 14, status: "pending_parent", now: NOW });
    await createParentLinkRequest({ learnerId: stale.user.id, expiresAt: daysAgo(1) });
    const fresh = await createLearner({ age: 14, status: "pending_parent", now: NOW });
    await createParentLinkRequest({ learnerId: fresh.user.id, expiresAt: new Date(NOW.getTime() + 3 * DAY) });
    await db.update(user).set({ createdAt: daysAgo(2) }).where(eq(user.id, fresh.user.id));
    await db.update(user).set({ createdAt: daysAgo(8) }).where(eq(user.id, stale.user.id));

    const summary = await runRetentionSweep(system());
    expect(summary.pendingTeensPurged).toBe(1);
    expect((await db.select({ id: user.id }).from(user).where(eq(user.kind, "learner"))).map((row) => row.id)).toEqual([fresh.user.id]);
  });

  it("warns the parent 30 days before an inactive account would be deleted, once, and deletes nothing yet", async () => {
    const quiet = await learnerInFamily({ lastActiveDaysAgo: 705 });
    const active = await learnerInFamily({ lastActiveDaysAgo: 20 });

    const first = await runRetentionSweep(system());
    expect(first).toMatchObject({ inactiveWarningsSent: 1, inactiveDeletionsScheduled: 0 });
    const notices = await db.select().from(notification).where(eq(notification.type, "retention.inactive_warning"));
    expect(notices.map((row) => row.userId)).toEqual([quiet.parentId]);
    const warnings = await db.select().from(auditLog).where(eq(auditLog.action, "retention.inactive_warning"));
    expect(warnings.map((row) => row.targetId)).toEqual([quiet.learnerId]);

    const second = await runRetentionSweep(system());
    expect(second).toMatchObject({ inactiveWarningsSent: 0, inactiveDeletionsScheduled: 0 });
    expect(await countOf("data_request")).toBe(0);
    for (const id of [quiet.learnerId, active.learnerId]) expect((await db.select({ status: user.status }).from(user).where(eq(user.id, id)))[0]?.status).toBe("active");
  });

  it("starts a deletion with the undo window only after the full period AND a warning at least 30 days old", async () => {
    const warnedLongAgo = await learnerInFamily({ lastActiveDaysAgo: 760 });
    const warnedLastWeek = await learnerInFamily({ lastActiveDaysAgo: 760 });
    const neverWarned = await learnerInFamily({ lastActiveDaysAgo: 760 });
    const warn = (learnerId: string, at: Date) => db.insert(auditLog).values({ actorType: "system", actorLabel: "retention.sweep", action: "retention.inactive_warning", targetType: "user", targetId: learnerId, createdAt: at });
    await warn(warnedLongAgo.learnerId, daysAgo(31));
    await warn(warnedLastWeek.learnerId, daysAgo(7));

    const summary = await runRetentionSweep(system());
    expect(summary).toMatchObject({ inactiveWarningsSent: 1, inactiveDeletionsScheduled: 1, failedSteps: [] });

    const statusOf = async (id: string) => (await db.select({ status: user.status, reason: user.statusReason }).from(user).where(eq(user.id, id)))[0];
    expect(await statusOf(warnedLongAgo.learnerId)).toEqual({ status: "pending_deletion", reason: "inactive" });
    expect((await statusOf(warnedLastWeek.learnerId))?.status).toBe("active");
    expect((await statusOf(neverWarned.learnerId))?.status).toBe("active");

    const requests = await db.select().from(dataRequest);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: "delete", status: "requested", learnerId: warnedLongAgo.learnerId, familyId: warnedLongAgo.familyId, requestedBy: null });
    expect(requests[0]?.undoUntil?.getTime()).toBe(NOW.getTime() + 14 * DAY);
    // Nothing is erased by this step: the account still exists until the undo window ends.
    expect(await countOf("learner_profile")).toBe(3);
  });

  it("does not warn again or delete when the learner comes back after a warning", async () => {
    const back = await learnerInFamily({ lastActiveDaysAgo: 2 });
    await db.insert(auditLog).values({ actorType: "system", action: "retention.inactive_warning", targetType: "user", targetId: back.learnerId, createdAt: daysAgo(40) });
    const summary = await runRetentionSweep(system());
    expect(summary).toMatchObject({ inactiveWarningsSent: 0, inactiveDeletionsScheduled: 0 });
  });
});

describe("append-only records", () => {
  async function evidence() {
    const learnerId = randomUUID();
    await db.insert(consentRecord).values({ learnerId, consentKey: "ai_processing", consentVersion: 1, action: "granted", actorUserId: randomUUID(), createdAt: daysAgo(2000) });
    await db.insert(creditLedger).values({ learnerId, entryType: "grant", amount: 50, periodKey: "2021-09", idempotencyKey: `grant:${learnerId}`, createdAt: daysAgo(2000) });
    await db.insert(auditLog).values([
      { actorType: "staff", action: "course.publish", createdAt: daysAgo(900) },
      { actorType: "staff", action: "safeguarding.case.read", createdAt: daysAgo(900) },
      { actorType: "parent", action: "consent.save", createdAt: daysAgo(900) },
      { actorType: "staff", action: "course.publish", createdAt: daysAgo(100) },
    ]);
  }

  it("the nightly sweep never updates or deletes a consent record, a ledger entry or an audit entry", async () => {
    await evidence();
    const before = { consent: await db.select().from(consentRecord), ledger: await db.select().from(creditLedger), audit: await db.select().from(auditLog) };

    const summary = await runRetentionSweep(system());
    expect(summary).toMatchObject({ auditLogDeleted: 0, failedSteps: [] });
    expect(await db.select().from(consentRecord)).toEqual(before.consent);
    expect(await db.select().from(creditLedger)).toEqual(before.ledger);
    const after = await db.select().from(auditLog);
    // The sweep may ADD its own entry (appending is what the table is for); every earlier row is byte for byte as it was.
    expect(after.filter((row) => row.action !== "retention.sweep")).toEqual(before.audit);
  });

  it("the deliberate audit-log purge removes only ordinary entries past the period, and never consent or safeguarding evidence", async () => {
    await evidence();
    const dry = await runRetentionSweep(system(), { includeAuditLog: true, dryRun: true });
    expect(dry.auditLogDeleted).toBe(1);
    expect(await countOf("audit_log")).toBe(4);

    const summary = await runRetentionSweep(system(), { includeAuditLog: true });
    expect(summary).toMatchObject({ auditLogDeleted: 1, failedSteps: [] });
    const left = (await db.select({ action: auditLog.action, createdAt: auditLog.createdAt }).from(auditLog)).filter((row) => row.action !== "retention.sweep");
    expect(left.map((row) => row.action).sort()).toEqual(["consent.save", "course.publish", "safeguarding.case.read"]);
    expect(await countOf("consent_record")).toBe(1);
    expect(await countOf("credit_ledger")).toBe(1);
  });
});

describe("the retention.sweep job", () => {
  it("is registered, runs daily, and writes its counts to job_run", async () => {
    expect(JOBS.some((job) => job.name === "retention.sweep")).toBe(true);
    expect(retentionSweep.schedule).toBe("15 3 * * *");

    const { learnerId } = await learnerInFamily({ lastActiveDaysAgo: 1 });
    const chat = await conversation(learnerId);
    await message(chat, learnerId, daysAgo(1));

    const result = await runJob(retentionSweep, {}, { now: NOW });
    expect(result.status).toBe("succeeded");
    const [run] = await db.select().from(jobRun).where(eq(jobRun.job, "retention.sweep"));
    expect(run?.status).toBe("succeeded");
    expect(run?.summary).toMatchObject({ dryRun: false, coachMessagesDeleted: 1, coachConversationsCleared: 1, auditLogDeleted: 0, failedSteps: [] });
    // Counts only: no ids, names or free text in what Studio shows.
    expect(JSON.stringify(run?.summary)).not.toContain(learnerId);

    const again = await runJob(retentionSweep, { dryRun: true }, { now: NOW });
    expect(again.status).toBe("succeeded");
    expect(await countOf("ai_message")).toBe(0);
  });
});
