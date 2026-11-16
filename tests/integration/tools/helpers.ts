/**
 * Shared set-up for the tools and submissions integration tests.
 *
 * Each test file mocks the contracts owned by other slices with `vi.mock` (`canAccessCourse`,
 * `getControls`, `openSafeguardingCase`, `checkLearningAllowed`, `recordEvidenceOutcome`,
 * `getEnrolmentById`), then calls `useToolMocks()` in `beforeEach` to give them plain answers:
 * learning is allowed, there are no parent controls, the plan covers every course, an enrolment
 * can be read by its learner, their family and staff, and a safeguarding case is a real row.
 *
 * Tool policies set here are TEST FIXTURES, not facts about the real vendors.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import type { LearnerActor, ParentActor, StaffRole } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { artefact, course, enrolment, familyMember, safeguardingCase, step, tool } from "@/server/db";
import { canAccessCourse } from "@/server/services/entitlements";
import { getEnrolmentById, recordEvidenceOutcome, type EnrolmentView } from "@/server/services/enrolment";
import { getControls, type ParentControls } from "@/server/services/parent-controls";
import { setPeopleDetector } from "@/server/services/people-detection";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { requestUpload } from "@/server/services/submission";
import { checkLearningAllowed, type LearningAllowed } from "@/server/services/usage";
import { createLocalStorage, getStorage, setStorage } from "@/server/storage";
import { importContent } from "../../../scripts/import-courses";
import { db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";

export const SNAPCHAT = "build-your-own-snapchat-style-app"; // paid, builder; replit with base44 as fallback; link + screenshot
export const HOMEWORK = "homework-helper-chatbot-the-honest-kind"; // free, starter; chatgpt; link + screenshot + file
export const MUSIC_VIDEO = "make-your-own-ai-music-video"; // paid; canva + capcut; link + video + screenshot

export const NO_CONTROLS: ParentControls = { dailyMinutesCap: null, quietStartMin: 0, quietEndMin: 0, blockedCategories: [], blockedCourseIds: [], requireApprovalForPro: false, paused: false, pausedReason: null };

type CaseCall = Parameters<typeof openSafeguardingCase>[1];
type OutcomeCall = Parameters<typeof recordEvidenceOutcome>[1];

let controls: ParentControls = NO_CONTROLS;
let learning: LearningAllowed = { allowed: true, minutesLeftToday: null };
let planCoversEverything = true;
export const cases: CaseCall[] = [];
export const outcomes: OutcomeCall[] = [];

async function readEnrolment(enrolmentId: string): Promise<EnrolmentView | null> {
  const [row] = await db
    .select({ id: enrolment.id, learnerId: enrolment.learnerId, courseId: enrolment.courseId, courseSlug: course.slug, courseTitle: course.title, courseVersionId: enrolment.courseVersionId, status: enrolment.status, startedAt: enrolment.startedAt, completedAt: enrolment.completedAt })
    .from(enrolment)
    .innerJoin(course, eq(course.id, enrolment.courseId))
    .where(eq(enrolment.id, enrolmentId));
  return row ? { ...row, currentStepKey: null, completedSteps: 0, totalSteps: 0 } : null;
}

/** Call in `beforeEach`. Resets the mocked contracts to "nothing in the way". */
export function useToolMocks(): void {
  controls = NO_CONTROLS;
  learning = { allowed: true, minutesLeftToday: null };
  planCoversEverything = true;
  cases.length = 0;
  outcomes.length = 0;
  setPeopleDetector(undefined);
  vi.mocked(getControls).mockImplementation(async () => controls);
  vi.mocked(checkLearningAllowed).mockImplementation(async () => learning);
  vi.mocked(canAccessCourse).mockImplementation(async (_ctx, _learnerId, target) => target.isFree || planCoversEverything);
  vi.mocked(openSafeguardingCase).mockImplementation(async (ctx, input) => {
    cases.push(input);
    const [row] = await ctx.db.insert(safeguardingCase).values({ learnerId: input.learnerId ?? null, severity: input.severity, trigger: input.trigger === "danger_report" ? "danger_report" : input.trigger === "moderator_escalation" ? "moderator_escalation" : input.trigger === "illegal_content" ? "illegal_media" : "crisis_classifier" }).returning({ id: safeguardingCase.id });
    return { caseId: row?.id ?? "" };
  });
  // Same access rule as the real one: the learner, their own family, staff and jobs; nobody else.
  vi.mocked(getEnrolmentById).mockImplementation(async (ctx, enrolmentId) => {
    const view = await readEnrolment(enrolmentId);
    if (!view) return null;
    const { actor } = ctx;
    if (actor.type === "system" || actor.type === "staff") return view;
    if (actor.type === "learner") return actor.userId === view.learnerId ? view : null;
    if (actor.type === "parent") {
      const [member] = await db.select({ familyId: familyMember.familyId }).from(familyMember).where(eq(familyMember.userId, view.learnerId));
      return member?.familyId === actor.familyId ? view : null;
    }
    return null;
  });
  vi.mocked(recordEvidenceOutcome).mockImplementation(async (_ctx, input) => {
    outcomes.push(input);
    const view = await readEnrolment(input.enrolmentId);
    if (!view) throw new Error("recordEvidenceOutcome: no such enrolment");
    return view;
  });
}

export const setControls = (patch: Partial<ParentControls>): void => {
  controls = { ...NO_CONTROLS, ...patch };
};
export const setLearning = (value: LearningAllowed): void => {
  learning = value;
};
export const setPlanCoversEverything = (value: boolean): void => {
  planCoversEverything = value;
};

let storageRoot: string | null = null;

/** Empties the database, publishes the five seed courses and points private storage at a fresh temporary folder. */
export async function seedCourses(): Promise<void> {
  await resetDb();
  const result = await importContent(testCtx(), { publishAsSeed: true });
  if (result.problems.length > 0) throw new Error(`Seed import failed: ${result.problems.join("; ")}`);
  storageRoot = mkdtempSync(path.join(tmpdir(), "tools-tests-"));
  setStorage("private", createLocalStorage("private", { rootDir: storageRoot, baseUrl: "http://localhost:3000" }));
}

export function tearDownStorage(): void {
  setStorage("private", undefined);
  if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
  storageRoot = null;
}

export async function courseBySlug(slug: string) {
  const [row] = await db.select().from(course).where(eq(course.slug, slug));
  if (!row || !row.publishedVersionId) throw new Error(`No published course ${slug}`);
  return { ...row, publishedVersionId: row.publishedVersionId };
}

export async function toolBySlug(slug: string) {
  const [row] = await db.select().from(tool).where(eq(tool.slug, slug));
  if (!row) throw new Error(`No tool ${slug}`);
  return row;
}

/** Sets Register fields directly. A fixture: the real path is `approveTool` / `blockTool`, tested with the Register. */
export async function setTool(slug: string, patch: Partial<typeof tool.$inferInsert>): Promise<void> {
  const operated = patch.under18Policy === "parent_operated" ? { parentOperatedAllowedRecordedAt: new Date() } : {};
  await db.update(tool).set({ ...operated, ...patch }).where(eq(tool.slug, slug));
}

/** Puts every seed tool back to "approved, allowed, 13+". */
export async function resetTools(): Promise<void> {
  await db.update(tool).set({ status: "approved", under18Policy: "allowed", minAge: 13 });
}

export type TestFamily = {
  familyId: string;
  parent: Ctx<ParentActor>;
  learner: Ctx<LearnerActor>;
  learnerId: string;
};

export async function family(options: { age?: number; nickname?: string } = {}): Promise<TestFamily> {
  const created = await createFamily();
  const child = await createLearner({ age: options.age ?? 14, familyId: created.family.id, nickname: options.nickname });
  return { familyId: created.family.id, parent: testCtx(created.parentActor), learner: testCtx(child.actor), learnerId: child.user.id };
}

export async function staffCtx(...roles: StaffRole[]) {
  return testCtx((await createStaff({ roles })).actor);
}

export type Enrolled = { enrolmentId: string; courseId: string; versionId: string; submitStepId: string };

/** An enrolment row on the live version, with the id of the course's `submit` step. */
export async function enrol(learnerId: string, slug: string, status: "active" | "completed" = "active"): Promise<Enrolled> {
  const target = await courseBySlug(slug);
  const [row] = await db.insert(enrolment).values({ learnerId, courseId: target.id, courseVersionId: target.publishedVersionId, status, completedAt: status === "completed" ? new Date() : null }).returning({ id: enrolment.id });
  const [submit] = await db.select({ id: step.id }).from(step).where(and(eq(step.courseVersionId, target.publishedVersionId), eq(step.type, "submit")));
  if (!row || !submit) throw new Error(`Could not enrol on ${slug}`);
  return { enrolmentId: row.id, courseId: target.id, versionId: target.publishedVersionId, submitStepId: submit.id };
}

export async function setEnrolmentStatus(enrolmentId: string, status: "active" | "completed"): Promise<void> {
  await db.update(enrolment).set({ status, completedAt: status === "completed" ? new Date() : null }).where(eq(enrolment.id, enrolmentId));
}

/** Asks for an upload link, then puts the bytes where the browser would have. Returns the artefact id to complete. */
export async function upload(ctx: Ctx, where: Enrolled, input: { kind: "screenshot" | "file" | "video"; contentType: string; bytes: Buffer; stepId?: string }): Promise<string> {
  const ticket = await requestUpload(ctx, { enrolmentId: where.enrolmentId, stepId: input.stepId ?? where.submitStepId, kind: input.kind, contentType: input.contentType, sizeBytes: input.bytes.length });
  const [row] = await db.select({ storageKey: artefact.storageKey }).from(artefact).where(eq(artefact.id, ticket.artefactId));
  if (!row?.storageKey) throw new Error("No upload ticket");
  await getStorage("private").put(row.storageKey, input.bytes, { contentType: input.contentType });
  return ticket.artefactId;
}

/** A DNS answer for the link check, so no test touches the network. */
export const publicResolver = async (): Promise<string[]> => ["93.184.216.34"];
export const privateResolver = async (): Promise<string[]> => ["10.0.0.7"];

/** Every rubric answer filled in, as the seed courses require before handing in. */
export const SELF_CHECK = { r1: "Nailed it", r2: "Getting there", r3: "Not yet", r4: "Nailed it" };

export async function artefactRow(id: string) {
  const [row] = await db.select().from(artefact).where(eq(artefact.id, id));
  return row ?? null;
}
