/**
 * Shared set-up for the parents integration tests.
 *
 * MOCKED CONTRACT: `countSafetyNoticesForLearner` (Studio safety slice; its body still throws).
 * Each file that needs it mocks `@/server/services/safeguarding` itself. Everything else is real:
 * controls, approvals, tool approvals, unlock requests, consent, family, learning, storage, email
 * and jobs, against the `platform_test_parents` database.
 *
 * Tool policies set in these tests are TEST FIXTURES, not facts about the real vendors.
 */
import { inflateRawSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { encrypt } from "@/server/crypto";
import type { LearnerActor, ParentActor } from "@/server/authz";
import { systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { aiMessage, aiRequest, artefact, certificate, consentDefinition, creditLedger, project, projectVersion, quiz, quizAttempt, reflection, safeguardingCase, session, step, stepProgress, tutorConversation, usageDay, user } from "@/server/db";
import { getStorage } from "@/server/storage";
import { AppError } from "@/server/errors";
import { db, testCtx } from "../../helpers/db";
import { REQUIRED_CONSENT_KEYS } from "@/server/services/consent";
import { createConsentDefinition, createFamily, createLearner, createParent, recordConsent } from "../../helpers/factories";
import { HOMEWORK, enrol } from "../tools/helpers";

export type TestFamily = {
  familyId: string;
  parentId: string;
  parentEmail: string;
  parent: Ctx<ParentActor>;
  children: { id: string; nickname: string; ctx: Ctx<LearnerActor> }[];
};

/** The three launch consents exist as wording, so that "required consents are given" can be true. */
export async function ensureConsentDefinitions(): Promise<void> {
  const existing = new Set((await db.select({ key: consentDefinition.key }).from(consentDefinition)).map((row) => row.key));
  for (const key of REQUIRED_CONSENT_KEYS) if (!existing.has(key)) await createConsentDefinition({ key, required: true });
}

export async function grantRequiredConsents(learnerId: string, parentId: string, familyId: string | null): Promise<void> {
  await ensureConsentDefinitions();
  for (const consentKey of REQUIRED_CONSENT_KEYS) await recordConsent({ learnerId, actorUserId: parentId, familyId, consentKey });
}

/**
 * A family with one parent and the named children (default: one 14-year-old called Maya), each
 * with the required consents given unless `consent: false`.
 */
export async function makeFamily(children: { nickname: string; age?: number }[] = [{ nickname: "Maya" }], options: { now?: Date; plan?: string; consent?: boolean } = {}): Promise<TestFamily> {
  const created = await createFamily({ plan: options.plan });
  await ensureConsentDefinitions();
  const kids: TestFamily["children"] = [];
  for (const child of children) {
    const learner = await createLearner({ age: child.age ?? 14, familyId: created.family.id, nickname: child.nickname, now: options.now });
    if (options.consent !== false) await grantRequiredConsents(learner.user.id, created.parent.id, created.family.id);
    kids.push({ id: learner.user.id, nickname: child.nickname, ctx: testCtx(learner.actor, options.now ? { now: options.now } : {}) });
  }
  return { familyId: created.family.id, parentId: created.parent.id, parentEmail: created.parent.email, parent: testCtx(created.parentActor, options.now ? { now: options.now } : {}), children: kids };
}

export async function secondParent(familyId: string): Promise<Ctx<ParentActor>> {
  return testCtx((await createParent({ familyId })).actor);
}

export const system = (job = "data.delete_due", now?: Date): Ctx => testCtx(systemActor(job), now ? { now } : {});

/** The same context at another moment. */
export const at = <C extends Ctx>(ctx: C, now: Date): C => ({ ...ctx, now });

export async function appError(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected an AppError, but nothing was thrown");
}

export async function userRow(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row ?? null;
}

/** A session row as Better Auth would have written it, so "signs them out" can be checked. */
export async function giveSession(userId: string): Promise<void> {
  await db.insert(session).values({ userId, token: `tok-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) });
}

export const sessionCount = async (userId: string): Promise<number> => (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length;

/** Reads a ZIP by its central directory, independently of the code that wrote it. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not a ZIP file");
  const count = zip.readUInt16LE(end + 10);
  let position = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(position + 10);
    const size = zip.readUInt32LE(position + 20);
    const nameLength = zip.readUInt16LE(position + 28);
    const local = zip.readUInt32LE(position + 42);
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(dataAt, dataAt + size);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    position += 46 + nameLength + zip.readUInt16LE(position + 30) + zip.readUInt16LE(position + 32);
  }
  return files;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Filled = { enrolmentId: string; projectId: string; acceptedKey: string; pendingKey: string; heldKey: string | null; conversationId: string; flaggedConversationId: string | null };

/**
 * Gives a learner one of everything, each piece marked with `tag` so that a leak between
 * children or families shows up as a string in the wrong place.
 */
export async function fillLearner(learnerId: string, tag: string, options: { safeguarding?: boolean; now?: Date } = {}): Promise<Filled> {
  const NOW = options.now ?? new Date();
  const later = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
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
