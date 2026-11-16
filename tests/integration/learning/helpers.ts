/**
 * Shared set-up for the learning integration tests.
 *
 * Each test file mocks the contracts that other slices have not filled in yet (`checkStart`,
 * `getControls`, `canAccessCourse`, `resolvePreview`) with `vi.mock`, then calls `useLearningMocks()`
 * to give them sensible answers: the start gate allows, there are no parent controls, and the
 * family's plan covers every course. A test changes one of them to set up its case.
 */
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import type { Course } from "@/content/schema";
import type { LearnerActor, StaffActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, courseVersion, step } from "@/server/db";
import { REQUIRED_CONSENT_KEYS } from "@/server/services/consent";
import { saveRevision } from "@/server/services/course-store";
import { canAccessCourse } from "@/server/services/entitlements";
import { getControls, type ParentControls } from "@/server/services/parent-controls";
import { publishVersion, recordDecision, submitForReview } from "@/server/services/publish";
import { checkStart, type StartBlocker } from "@/server/services/start-gate";
import { importContent } from "../../../scripts/import-courses";
import { db, resetDb, testCtx } from "../../helpers/db";
import { createConsentDefinition, createFamily, createLearner, recordConsent } from "../../helpers/factories";
import { approval, ctxFor, staff } from "../content/helpers";

export const FREE_SLUG = "homework-helper-chatbot-the-honest-kind";
export const PAID_SLUG = "build-your-own-snapchat-style-app";
export const OTHER_FREE_SLUG = "prompt-gym-from-vague-to-laser-sharp";

export const NO_CONTROLS: ParentControls = {
  dailyMinutesCap: null,
  quietStartMin: 0,
  quietEndMin: 0,
  blockedCategories: [],
  blockedCourseIds: [],
  requireApprovalForPro: false,
  paused: false,
  pausedReason: null,
};

/** A weekday afternoon in UK time: outside any quiet hours a test is likely to set. */
export const AFTERNOON = new Date("2026-11-18T15:00:00Z");

let controls: ParentControls = NO_CONTROLS;
let startBlockers: StartBlocker[] = [];
let planCoversEverything = true;

/** Call in `beforeEach`. Resets the mocked contracts to "nothing in the way". */
export function useLearningMocks(): void {
  controls = NO_CONTROLS;
  startBlockers = [];
  planCoversEverything = true;
  vi.mocked(getControls).mockImplementation(async () => controls);
  vi.mocked(checkStart).mockImplementation(async () => ({ allowed: startBlockers.length === 0, blockers: startBlockers }));
  vi.mocked(canAccessCourse).mockImplementation(async (_ctx, _learnerId, target) => target.isFree || planCoversEverything);
}

export const setControls = (patch: Partial<ParentControls>): void => {
  controls = { ...NO_CONTROLS, ...patch };
};
export const setStartBlockers = (blockers: StartBlocker[]): void => {
  startBlockers = blockers;
};
/** `false` puts the family on the Free plan: paid courses are locked. */
export const setPlanCoversEverything = (value: boolean): void => {
  planCoversEverything = value;
};

/** Empties the database and publishes the five seed courses through the ordinary publish path. */
export async function seedPublishedCourses(): Promise<void> {
  await resetDb();
  const result = await importContent(testCtx(), { publishAsSeed: true });
  if (result.problems.length > 0) throw new Error(`Seed import failed: ${result.problems.join("; ")}`);
  for (const key of REQUIRED_CONSENT_KEYS) await createConsentDefinition({ key, required: true });
}

/** A learner in a family, with the required consents granted, and a context to act as them. */
export async function learner(options: { age?: number; interests?: string[]; now?: Date } = {}): Promise<{ actor: LearnerActor; ctx: Ctx<LearnerActor>; familyId: string; at: (now: Date) => Ctx<LearnerActor> }> {
  const { family, parent } = await createFamily();
  const created = await createLearner({ age: options.age ?? 14, familyId: family.id, interests: options.interests, now: options.now });
  for (const consentKey of REQUIRED_CONSENT_KEYS) {
    await recordConsent({ learnerId: created.user.id, familyId: family.id, consentKey, actorUserId: parent.id });
  }
  const now = options.now ?? AFTERNOON;
  return { actor: created.actor, ctx: testCtx(created.actor, { now }), familyId: family.id, at: (when: Date) => testCtx(created.actor, { now: when }) };
}

export async function courseBySlug(slug: string) {
  const [row] = await db.select().from(course).where(eq(course.slug, slug));
  if (!row) throw new Error(`No course ${slug}`);
  return row;
}

export async function publishedContent(slug: string): Promise<Course> {
  const row = await courseBySlug(slug);
  const [version] = await db.select().from(courseVersion).where(eq(courseVersion.id, row.publishedVersionId ?? ""));
  if (!version) throw new Error(`No published version for ${slug}`);
  return version.snapshot as Course;
}

export async function stepRow(versionId: string, key: string) {
  const rows = await db.select().from(step).where(eq(step.courseVersionId, versionId));
  const row = rows.find((entry) => entry.key === key);
  if (!row) throw new Error(`No step ${key}`);
  return row;
}

/** Publishes a changed copy of a live course as its next version, through review and publish. */
export async function publishNewVersion(slug: string, change: (content: Course) => void): Promise<{ versionId: string; owner: StaffActor }> {
  const owner = await staff("super_admin");
  const row = await courseBySlug(slug);
  const content = structuredClone(await publishedContent(slug));
  change(content);
  await saveRevision(ctxFor(owner), row.id, content);
  const submitted = await submitForReview(ctxFor(owner), row.id);
  await recordDecision(ctxFor(owner), submitted.version.id, approval({ reason: "Test revision" }));
  await publishVersion(ctxFor(owner), submitted.version.id);
  return { versionId: submitted.version.id, owner };
}
