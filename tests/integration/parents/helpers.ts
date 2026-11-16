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
import type { LearnerActor, ParentActor } from "@/server/authz";
import { systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { consentDefinition, session, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { db, testCtx } from "../../helpers/db";
import { REQUIRED_CONSENT_KEYS } from "@/server/services/consent";
import { createConsentDefinition, createFamily, createLearner, createParent, recordConsent } from "../../helpers/factories";

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
