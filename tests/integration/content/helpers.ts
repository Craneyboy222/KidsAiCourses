/**
 * Shared set-up for the content integration tests. Tool policies here are TEST FIXTURES, not facts
 * about the real vendors: the real seed files stay unverified until a person reads the terms.
 */
import { eq } from "drizzle-orm";
import type { Course } from "@/content/schema";
import { QA_CHECKLIST } from "@/content/validate";
import { systemActor, type Actor, type StaffActor, type StaffRole } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { auditLog, course, courseVersion } from "@/server/db";
import { AppError } from "@/server/errors";
import { upsertAssetsFromManifest } from "@/server/services/assets";
import { createCourse, type CourseAndVersion } from "@/server/services/course-store";
import {
  recordDecision,
  submitForReview,
  type ChecklistAnswer,
  type RecordDecisionInput,
} from "@/server/services/publish";
import { approveTool, upsertToolFromSeed } from "@/server/services/tools";
import { loadContent } from "../../../scripts/check-content";
import { snapchatCourse } from "../../unit/content/helpers";
import { db, testCtx } from "../../helpers/db";
import { createStaff } from "../../helpers/factories";

let tick = 0;
const START = Date.now();

/** A context whose clock moves forward one second per call, so records made in a test are in a known order. */
export function ctxFor<A extends Actor>(actor: A, overrides: Partial<Ctx> = {}): Ctx<A> {
  tick += 1;
  return testCtx(actor, { now: new Date(START + tick * 1000), ...overrides });
}

export const systemCtx = (job = "test.job"): Ctx => ctxFor(systemActor(job));

export async function staff(...roles: StaffRole[]): Promise<StaffActor> {
  return (await createStaff({ roles })).actor;
}

/** Imports the real seed tools and assets, then approves Replit and Base44 with fixture policies. */
export async function setUpRegister(
  options: { approve?: string[] } = {},
): Promise<{ toolReviewer: StaffActor }> {
  const content = loadContent();
  const toolReviewer = await staff("reviewer");
  for (const { tool } of content.tools) await upsertToolFromSeed(systemCtx(), tool);
  for (const slug of options.approve ?? ["replit", "base44"]) {
    await approveTool(ctxFor(toolReviewer), slug, {
      under18Policy: "allowed",
      minAge: 13,
      evidenceChecked: true,
    });
  }
  await upsertAssetsFromManifest(
    systemCtx(),
    content.assets.map(({ asset }) => asset),
  );
  return { toolReviewer };
}

export const fullChecklist = (): Record<string, ChecklistAnswer> =>
  Object.fromEntries(QA_CHECKLIST.items.map((item) => [item.key, "pass"]));

export const approval = (overrides: Partial<RecordDecisionInput> = {}): RecordDecisionInput => ({
  kind: "approve",
  checklist: fullChecklist(),
  toolClaimsChecked: true,
  ...overrides,
});

/** The Snapchat course with any changes applied. Parsed fresh each time, so safe to mutate. */
export function fixtureCourse(change?: (course: Course) => void): Course {
  const snapshot = snapchatCourse();
  change?.(snapshot);
  return snapshot;
}

/** A hand-made course created by `editor` and submitted for review. */
export async function draftInReview(
  editor: StaffActor,
  change?: (course: Course) => void,
): Promise<CourseAndVersion> {
  const created = await createCourse(ctxFor(editor), fixtureCourse(change), { origin: "hand_made" });
  const submitted = await submitForReview(ctxFor(editor), created.course.id);
  return { course: submitted.course, version: submitted.version };
}

/** A course in review with one approval from `reviewer`. */
export async function approvedCourse(
  editor: StaffActor,
  reviewer: StaffActor,
  change?: (course: Course) => void,
): Promise<CourseAndVersion> {
  const draft = await draftInReview(editor, change);
  await recordDecision(ctxFor(reviewer), draft.version.id, approval());
  return readCourse(draft.course.id);
}

export async function readCourse(courseId: string): Promise<CourseAndVersion> {
  const [current] = await db.select().from(course).where(eq(course.id, courseId));
  if (!current || current.workingVersionId === null) throw new Error("course not found");
  const [version] = await db
    .select()
    .from(courseVersion)
    .where(eq(courseVersion.id, current.workingVersionId));
  if (!version) throw new Error("working version not found");
  return { course: current, version };
}

export async function readVersion(versionId: string) {
  const [version] = await db.select().from(courseVersion).where(eq(courseVersion.id, versionId));
  if (!version) throw new Error("version not found");
  return version;
}

export async function auditActions(): Promise<string[]> {
  const rows = await db.select({ action: auditLog.action }).from(auditLog);
  return rows.map((row) => row.action);
}

/** Runs `work` and returns the AppError it throws. Fails the test if it does not throw one. */
export async function appError(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected an AppError, but nothing was thrown");
}
