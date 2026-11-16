/**
 * The course store (docs/ARCHITECTURE.md, "Courses and versions").
 *
 * - `course` is the stable identity. `course_version.snapshot` is the canonical content.
 * - A revision is never changed after it is written. Every save inserts `revision + 1`.
 * - Editing a published course starts a new draft revision. The published version stays live, and
 *   keeps driving the catalogue, until the new revision is approved and published.
 * - Nothing here publishes. That is `publish.ts`, which requires a recorded human approval.
 *
 * This module does not import `server-only`, so that the import scripts can run it with tsx.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { flattenSteps, requiredToolSlugs } from "@/content/course-utils";
import { REQUIRED_SETUP_GUIDE_KINDS, courseSchema, type Course } from "@/content/schema";
import { setupGuideWaiverKey, summariseIssues, validateCourse, type ValidationContext, type ValidationIssue } from "@/content/validate";
import { audit } from "@/server/audit";
import { assertCan, can } from "@/server/authz";
import type { Ctx } from "@/server/context";
import {
  course,
  courseIdea,
  courseModule,
  courseTool,
  courseVersion,
  editRequest,
  lesson,
  publishSchedule,
  quiz,
  quizQuestion,
  reviewDecision,
  reviewTask,
  rubricCriterion,
  step,
  toolGuide,
  toolGuideStep,
  type Db,
} from "@/server/db";
import { AppError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { getAssetsByKeys } from "./assets";
import { isAiOrigin } from "./publish-rules";
import { getToolsBySlugs } from "./tools";

export type CourseRow = typeof course.$inferSelect;
export type CourseVersionRow = typeof courseVersion.$inferSelect;
export type CourseOrigin = CourseRow["origin"];
export type CourseStatus = CourseRow["status"];

/** What is stored in `course_version.validation`. */
export interface StoredValidation {
  /** True when there are no errors. Warnings do not block. */
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  /** The reviewed waivers that were applied, for example `setup_guide:replit`. */
  waivers: string[];
  checkedAt: string;
}

export interface CourseAndVersion {
  course: CourseRow;
  version: CourseVersionRow;
}

export interface CourseWithContent extends CourseAndVersion {
  /**
   * The full snapshot, INCLUDING internal fields, quiz answers and `coachContext`. Pass it through
   * `toLearnerCourse` from `@/content/schema` before any of it reaches a learner's browser.
   */
  content: Course;
}

/**
 * Course statuses that describe what learners see rather than where a draft is in review. While a
 * course has one of these, saving or reviewing a new draft revision does not change it.
 */
export const CATALOGUE_STATUSES: readonly CourseStatus[] = ["published", "needs_review", "taken_down", "retired"];

/** A version that was live and has been replaced by a newer one. Learners enrolled on it keep it. */
export const SUPERSEDED_VERSION_STATUS = "retired" satisfies CourseStatus;

// ───────────────────────────── Small helpers ─────────────────────────────

function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new AppError("internal", "Something went wrong saving that. Please try again.", { detail: { what } });
  return row;
}

const staffUserId = (ctx: Ctx): string | null => (ctx.actor.type === "staff" ? ctx.actor.userId : null);

/** JSON with object keys sorted, so two snapshots can be compared whatever order their keys are in. */
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, sort(entry)]),
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

/** True when two snapshots hold the same content. The database-assigned `id` is ignored. */
export function sameContent(a: unknown, b: unknown): boolean {
  const strip = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const { id: _id, ...rest } = value as Record<string, unknown>;
    return rest;
  };
  return canonicalJson(strip(a)) === canonicalJson(strip(b));
}

/** Parses a snapshot with the Zod `Course` schema. A snapshot that does not fit is never stored. */
export function parseSnapshot(input: unknown): Course {
  const parsed = courseSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const zodIssue of parsed.error.issues.slice(0, 50)) {
    const path = zodIssue.path.map(String).join(".") || "course";
    fieldErrors[path] = [...(fieldErrors[path] ?? []), zodIssue.message];
  }
  throw new AppError("validation_failed", "This course does not fit the course format, so it was not saved. Fix the fields listed and try again.", {
    fieldErrors,
  });
}

/** The parsed content of a stored version. */
export function contentOfVersion(version: Pick<CourseVersionRow, "id" | "snapshot">): Course {
  const parsed = courseSchema.safeParse(version.snapshot);
  if (!parsed.success) {
    throw new AppError("internal", "This course version could not be read. Please tell the team.", {
      detail: { versionId: version.id, issues: parsed.error.issues.slice(0, 10) },
    });
  }
  return parsed.data;
}

const toDate = (value: string | undefined): Date | null => {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Locks the course row for the rest of the transaction, so revisions and publishing happen one at a time. */
export async function lockCourse(tx: Db, courseId: string): Promise<CourseRow> {
  const [row] = await tx.select().from(course).where(eq(course.id, courseId)).limit(1).for("update");
  if (!row) throw new AppError("not_found", "That course could not be found.");
  return row;
}

async function requireVersion(db: Db, versionId: string): Promise<CourseVersionRow> {
  const [row] = await db.select().from(courseVersion).where(eq(courseVersion.id, versionId)).limit(1);
  if (!row) throw new AppError("not_found", "That course version could not be found.");
  return row;
}

// ───────────────────────────── Validation ─────────────────────────────

function referencedToolSlugs(snapshot: Course): string[] {
  const slugs = new Set<string>();
  for (const requirement of snapshot.toolRequirements) {
    slugs.add(requirement.toolSlug);
    if (requirement.fallbackToolSlug !== undefined) slugs.add(requirement.fallbackToolSlug);
  }
  for (const guide of snapshot.setupGuides) slugs.add(guide.toolSlug);
  for (const { step: item } of flattenSteps(snapshot)) {
    const slug = item.config?.toolSlug;
    if (typeof slug === "string") slugs.add(slug);
  }
  return [...slugs];
}

function referencedAssetIds(snapshot: Course): string[] {
  const ids = new Set<string>([snapshot.trailer.assetId, snapshot.trailer.posterAssetId, snapshot.trailer.captionsAssetId]);
  for (const { step: item } of flattenSteps(snapshot)) for (const id of item.assetIds ?? []) ids.add(id);
  for (const guide of snapshot.setupGuides) {
    for (const guideStep of guide.steps) for (const id of guideStep.screenshotAssetIds ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * The validator's view of the live database: tools from the Tool Register (policy and status),
 * assets from `asset`, and whether people screening is enabled. Nothing is downgraded here: a tool
 * that is unknown, unverified, unapproved or blocked is an error, exactly as at publish time.
 */
export async function buildDbValidationContext(
  ctx: Pick<Ctx, "db">,
  snapshot: Course,
  options: { waivers?: readonly string[] } = {},
): Promise<ValidationContext> {
  const [tools, assets, peopleScreeningEnabled] = await Promise.all([
    getToolsBySlugs(ctx, referencedToolSlugs(snapshot)),
    getAssetsByKeys(ctx, referencedAssetIds(snapshot)),
    getSetting(ctx, "uploads.people_screening_enabled"),
  ]);
  return {
    tools: Object.fromEntries([...tools].map(([slug, row]) => [slug, { under18Policy: row.under18Policy, status: row.status }])),
    assets: Object.fromEntries(
      [...assets].map(([key, row]) => [key, row.altText === null ? { kind: row.kind } : { kind: row.kind, altText: row.altText }]),
    ),
    peopleScreeningEnabled,
    waivers: [...(options.waivers ?? [])],
  };
}

/** Runs `validateCourse` against the live database. Shared with `publish.ts`. */
export async function validateAgainstDb(
  ctx: Pick<Ctx, "db" | "now">,
  snapshot: Course,
  waivers: readonly string[] = [],
): Promise<StoredValidation> {
  const context = await buildDbValidationContext(ctx, snapshot, { waivers });
  const issues = validateCourse(snapshot, context);
  const summary = summariseIssues(issues);
  return {
    ok: summary.publishable,
    errors: summary.errors,
    warnings: summary.warnings,
    issues,
    waivers: [...waivers],
    checkedAt: ctx.now.toISOString(),
  };
}

export interface RecordedWaiver {
  /** The waiver key, for example `setup_guide:replit`. */
  check: string;
  reason: string;
  reviewerId: string;
  at: Date;
}

/**
 * Waivers a reviewer has recorded for this version. Only a waiver on an approval that is still the
 * reviewer's latest decision counts: asking for edits or declining afterwards withdraws it.
 */
export async function loadRecordedWaivers(db: Db, versionId: string): Promise<RecordedWaiver[]> {
  const rows = await db
    .select({
      reviewerId: reviewDecision.reviewerId,
      decision: reviewDecision.decision,
      waivers: reviewDecision.waivers,
      createdAt: reviewDecision.createdAt,
    })
    .from(reviewDecision)
    .where(eq(reviewDecision.courseVersionId, versionId))
    .orderBy(asc(reviewDecision.createdAt), asc(reviewDecision.id));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.reviewerId, row);
  const found: RecordedWaiver[] = [];
  for (const row of latest.values()) {
    if (row.decision !== "approve") continue;
    for (const entry of row.waivers) {
      if (entry === null || typeof entry !== "object") continue;
      const { check, reason } = entry as { check?: unknown; reason?: unknown };
      if (typeof check !== "string" || typeof reason !== "string") continue;
      found.push({ check, reason, reviewerId: row.reviewerId, at: row.createdAt });
    }
  }
  return found;
}

/**
 * Validates a stored version again against the live database and saves the result in
 * `course_version.validation`. Recorded waivers are applied unless `waivers` is given.
 */
export async function revalidateVersion(
  ctx: Ctx,
  versionId: string,
  options: { waivers?: readonly string[] } = {},
): Promise<StoredValidation> {
  assertCan(ctx.actor, "course.read_draft");
  const version = await requireVersion(ctx.db, versionId);
  const waivers = options.waivers ?? [...new Set((await loadRecordedWaivers(ctx.db, versionId)).map((waiver) => waiver.check))];
  const validation = await validateAgainstDb(ctx, contentOfVersion(version), waivers);
  await ctx.db
    .update(courseVersion)
    .set({ validation: validation as unknown as Record<string, unknown> })
    .where(eq(courseVersion.id, versionId));
  return validation;
}

// ───────────────────────────── Catalogue fields ─────────────────────────────

/**
 * Copies the denormalised catalogue columns on `course` from a snapshot: title, tagline, what you
 * make, category, difficulty, pathways, minimum age, free or paid, minutes, interests, careers,
 * required tool slugs, the safeguarding flag and the verified dates. `course.search` is a generated
 * column over title, tagline and what-you-make, so it follows.
 *
 * Only the PUBLISHED snapshot may drive what learners see. The publish service calls this without
 * options. Everything else must pass `{ draft: true }`, which does nothing at all once the course
 * has ever been published. Returns whether anything was written.
 */
export async function syncCatalogueFields(
  tx: Db,
  courseId: string,
  snapshot: Course,
  options: { draft?: boolean } = {},
): Promise<boolean> {
  const where: SQL[] = [eq(course.id, courseId)];
  if (options.draft) where.push(isNull(course.publishedAt));
  const updated = await tx
    .update(course)
    .set({
      title: snapshot.title,
      tagline: snapshot.tagline,
      whatYouMake: snapshot.whatYouMake,
      category: snapshot.category,
      difficulty: snapshot.difficulty,
      pathways: snapshot.pathways,
      minAge: snapshot.minAge,
      isFree: snapshot.isFree,
      estimatedMinutes: snapshot.estimatedMinutes,
      interests: snapshot.interests,
      careers: snapshot.careers,
      toolSlugs: requiredToolSlugs(snapshot),
      safeguardingSensitive: snapshot.safeguardingSensitive,
      lastVerifiedAt: toDate(snapshot.lastVerifiedAt),
      guidesLastVerifiedAt: toDate(snapshot.guidesLastVerifiedAt),
    })
    .where(and(...where))
    .returning({ id: course.id });
  return updated.length > 0;
}

// ───────────────────────────── Creating and saving ─────────────────────────────

export interface CreateCourseOptions {
  origin: CourseOrigin;
  /** `radar_candidate.id` */
  sourceCandidateId?: string;
  /** `course_idea.id` */
  ideaId?: string;
  /** `generation_job.id` */
  generationJobId?: string;
  note?: string;
  /** Model, prompt version, cost and retries for an AI-written draft. */
  generationMeta?: Record<string, unknown>;
}

/**
 * Creates a course with revision 1. An AI origin gives status `ai_draft`; a hand-made course gives
 * `draft`. Needs `course.generate` for an AI origin and `course.edit` otherwise. Nothing is
 * published, and a draft with validation errors still saves: the issues are stored on the revision.
 */
export async function createCourse(ctx: Ctx, snapshot: Course, options: CreateCourseOptions): Promise<CourseAndVersion> {
  const ai = isAiOrigin(options.origin);
  assertCan(ctx.actor, ai ? "course.generate" : "course.edit");
  const content = parseSnapshot(snapshot);
  const status: CourseStatus = ai ? "ai_draft" : "draft";
  const userId = staffUserId(ctx);

  return ctx.db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: course.id }).from(course).where(eq(course.slug, content.slug)).limit(1);
    if (taken) {
      throw new AppError("conflict", `A course with the slug "${content.slug}" already exists. Choose another slug, or edit that course.`);
    }
    const created = one(
      await tx
        .insert(course)
        .values({
          slug: content.slug,
          title: content.title,
          origin: options.origin,
          status,
          sourceCandidateId: options.sourceCandidateId ?? null,
          sourceIdeaId: options.ideaId ?? null,
          generationJobId: options.generationJobId ?? null,
          createdBy: userId,
          createdAt: ctx.now,
        })
        .returning(),
      "course",
    );
    const stored: Course = { ...content, id: created.id };
    const validation = await validateAgainstDb({ db: tx, now: ctx.now }, stored);
    const version = one(
      await tx
        .insert(courseVersion)
        .values({
          courseId: created.id,
          revision: 1,
          semver: content.version,
          status,
          snapshot: stored as unknown as Record<string, unknown>,
          validation: validation as unknown as Record<string, unknown>,
          editorNotes: content.editorNotes ?? null,
          verifyFlags: content.verifyFlags ?? [],
          origin: options.origin,
          generationJobId: options.generationJobId ?? null,
          sourceCandidateId: options.sourceCandidateId ?? null,
          sourceIdeaId: options.ideaId ?? null,
          generationMeta: options.generationMeta ?? null,
          changeSummary: options.note ?? null,
          createdBy: userId,
          // Null for an untouched AI draft: nobody has edited it yet.
          lastEditedBy: ai ? null : userId,
          createdAt: ctx.now,
        })
        .returning(),
      "course_version",
    );
    await tx.update(course).set({ workingVersionId: version.id }).where(eq(course.id, created.id));
    await syncCatalogueFields(tx, created.id, stored, { draft: true });
    if (options.ideaId !== undefined) {
      await tx
        .update(courseIdea)
        .set({ courseId: created.id, status: "drafted" })
        .where(and(eq(courseIdea.id, options.ideaId), inArray(courseIdea.status, ["idea", "drafting"])));
    }
    await audit(
      ctx,
      {
        action: "course.create",
        targetType: "course",
        targetId: created.id,
        meta: { slug: content.slug, origin: options.origin, versionId: version.id, revision: 1, validationErrors: validation.errors },
      },
      tx,
    );
    const [fresh] = await tx.select().from(course).where(eq(course.id, created.id)).limit(1);
    return { course: fresh ?? created, version };
  });
}

export interface SaveRevisionOptions {
  /** A short note on what changed, shown in the version history. */
  note?: string;
  /** The `edit_request` this revision answers. Its `result_version_id` is set. */
  editRequestId?: string;
  /** The revision this one was made from. Defaults to the current working revision. */
  fromRevision?: number;
  /** Refuse to save unless this is still the newest revision (two people editing at once). */
  expectedRevision?: number;
}

async function insertRevision(
  ctx: Ctx,
  courseId: string,
  content: Course,
  options: SaveRevisionOptions & { auditAction: string; auditMeta?: Record<string, unknown> },
): Promise<CourseAndVersion> {
  const userId = staffUserId(ctx);
  return ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    const [newest] = await tx
      .select({ id: courseVersion.id, revision: courseVersion.revision })
      .from(courseVersion)
      .where(eq(courseVersion.courseId, courseId))
      .orderBy(desc(courseVersion.revision))
      .limit(1);
    const newestRevision = newest?.revision ?? 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== newestRevision) {
      throw new AppError(
        "conflict",
        `Someone else saved revision ${newestRevision} while you were editing. Reload the course and make your change again.`,
        { detail: { expectedRevision: options.expectedRevision, newestRevision } },
      );
    }

    let parent: Pick<CourseVersionRow, "id" | "revision" | "lastEditedBy"> | undefined;
    if (options.fromRevision !== undefined) {
      [parent] = await tx
        .select({ id: courseVersion.id, revision: courseVersion.revision, lastEditedBy: courseVersion.lastEditedBy })
        .from(courseVersion)
        .where(and(eq(courseVersion.courseId, courseId), eq(courseVersion.revision, options.fromRevision)))
        .limit(1);
      if (!parent) throw new AppError("not_found", `Revision ${options.fromRevision} of this course could not be found.`);
    } else if (current.workingVersionId !== null) {
      [parent] = await tx
        .select({ id: courseVersion.id, revision: courseVersion.revision, lastEditedBy: courseVersion.lastEditedBy })
        .from(courseVersion)
        .where(eq(courseVersion.id, current.workingVersionId))
        .limit(1);
    }

    if (content.slug !== current.slug) {
      if (current.publishedAt !== null) {
        throw new AppError("invalid_input", "The web address (slug) of a course cannot change once it has been published.", {
          fieldErrors: { slug: ["This cannot change once the course has been published."] },
        });
      }
      const [taken] = await tx.select({ id: course.id }).from(course).where(eq(course.slug, content.slug)).limit(1);
      if (taken) throw new AppError("conflict", `A course with the slug "${content.slug}" already exists. Choose another slug.`);
      await tx.update(course).set({ slug: content.slug }).where(eq(course.id, courseId));
    }

    // A person's edit makes a `draft`. A revision written by a job for an AI course stays an `ai_draft`.
    const status: CourseStatus = ctx.actor.type === "system" && isAiOrigin(current.origin) ? "ai_draft" : "draft";
    const stored: Course = { ...content, id: courseId };
    const validation = await validateAgainstDb({ db: tx, now: ctx.now }, stored);
    const version = one(
      await tx
        .insert(courseVersion)
        .values({
          courseId,
          revision: newestRevision + 1,
          semver: content.version,
          status,
          snapshot: stored as unknown as Record<string, unknown>,
          validation: validation as unknown as Record<string, unknown>,
          editorNotes: content.editorNotes ?? null,
          verifyFlags: content.verifyFlags ?? [],
          origin: current.origin,
          generationJobId: current.generationJobId,
          sourceCandidateId: current.sourceCandidateId,
          sourceIdeaId: current.sourceIdeaId,
          parentVersionId: parent?.id ?? null,
          changeSummary: options.note ?? null,
          createdBy: userId,
          // A job's revision keeps the name of the last person who edited the content.
          lastEditedBy: userId ?? parent?.lastEditedBy ?? null,
          createdAt: ctx.now,
        })
        .returning(),
      "course_version",
    );

    // Approvals and schedules belong to one version. A new revision starts again.
    await tx
      .update(publishSchedule)
      .set({ status: "cancelled", cancelledAt: ctx.now, error: `Superseded by revision ${version.revision}.` })
      .where(and(eq(publishSchedule.courseId, courseId), eq(publishSchedule.status, "scheduled")));
    await tx
      .update(reviewTask)
      .set({ status: "cancelled", completedAt: ctx.now })
      .where(
        and(eq(reviewTask.courseId, courseId), eq(reviewTask.kind, "course_review"), inArray(reviewTask.status, ["open", "in_progress"])),
      );
    if (options.editRequestId !== undefined) {
      await tx
        .update(editRequest)
        .set({ resultVersionId: version.id })
        .where(and(eq(editRequest.id, options.editRequestId), eq(editRequest.courseId, courseId)));
    }

    const keepStatus = CATALOGUE_STATUSES.includes(current.status);
    const updated = one(
      await tx
        .update(course)
        .set({ workingVersionId: version.id, status: keepStatus ? current.status : status })
        .where(eq(course.id, courseId))
        .returning(),
      "course",
    );
    // A no-op once the course has ever been published: a draft never changes what learners see.
    const synced = await syncCatalogueFields(tx, courseId, stored, { draft: true });
    await audit(
      ctx,
      {
        action: options.auditAction,
        targetType: "course",
        targetId: courseId,
        meta: {
          versionId: version.id,
          revision: version.revision,
          parentRevision: parent?.revision ?? null,
          editRequestId: options.editRequestId ?? null,
          validationErrors: validation.errors,
          ...options.auditMeta,
        },
      },
      tx,
    );
    if (!synced) return { course: updated, version };
    const [fresh] = await tx.select().from(course).where(eq(course.id, courseId)).limit(1);
    return { course: fresh ?? updated, version };
  });
}

/**
 * Saves a course as a NEW revision (`revision + 1`). No earlier revision is ever changed, and a
 * published version is never touched: editing a published course starts a new draft revision while
 * the published one stays live. The snapshot is validated against the live database and the issues
 * are stored; a draft with validation errors still saves. Any approval or schedule for an earlier
 * revision no longer applies: the new revision must be submitted and approved itself.
 */
export async function saveRevision(
  ctx: Ctx,
  courseId: string,
  snapshot: Course,
  options: SaveRevisionOptions = {},
): Promise<CourseAndVersion> {
  assertCan(ctx.actor, "course.edit");
  return insertRevision(ctx, courseId, parseSnapshot(snapshot), { ...options, auditAction: "course.revision.save" });
}

/** Makes a new revision that copies the snapshot of an earlier one. The earlier revision is untouched. */
export async function restoreRevision(ctx: Ctx, courseId: string, revision: number): Promise<CourseAndVersion> {
  assertCan(ctx.actor, "course.edit");
  const [source] = await ctx.db
    .select()
    .from(courseVersion)
    .where(and(eq(courseVersion.courseId, courseId), eq(courseVersion.revision, revision)))
    .limit(1);
  if (!source) throw new AppError("not_found", `Revision ${revision} of this course could not be found.`);
  return insertRevision(ctx, courseId, contentOfVersion(source), {
    note: `Restored from revision ${revision}`,
    fromRevision: revision,
    auditAction: "course.revision.restore",
    auditMeta: { restoredRevision: revision },
  });
}

/** Records which backlog idea a course came from, when it was not known at creation (`course.edit`). */
export async function linkCourseToIdea(ctx: Ctx, courseId: string, ideaId: string): Promise<void> {
  assertCan(ctx.actor, "course.edit");
  await ctx.db.transaction(async (tx) => {
    const current = await lockCourse(tx, courseId);
    if (current.sourceIdeaId === ideaId) return;
    const [idea] = await tx.select().from(courseIdea).where(eq(courseIdea.id, ideaId)).limit(1);
    if (!idea) throw new AppError("not_found", "That course idea could not be found.");
    await tx.update(course).set({ sourceIdeaId: ideaId }).where(eq(course.id, courseId));
    const live = current.status === "published" && current.publishedVersionId !== null;
    const status = live ? "published" : idea.status === "idea" || idea.status === "drafting" ? "drafted" : idea.status;
    await tx.update(courseIdea).set({ courseId, status }).where(eq(courseIdea.id, ideaId));
    await audit(ctx, { action: "course.idea.link", targetType: "course", targetId: courseId, meta: { ideaId, ideaKey: idea.ideaKey } }, tx);
  });
}

// ───────────────────────────── Reading ─────────────────────────────

export type RevisionSummary = Omit<CourseVersionRow, "snapshot" | "validation" | "generationMeta"> & {
  validationErrors: number | null;
  validationWarnings: number | null;
};

const countOf = (validation: Record<string, unknown> | null, key: "errors" | "warnings"): number | null => {
  const value = validation?.[key];
  return typeof value === "number" ? value : null;
};

/** Every revision of a course, newest first, without the snapshots (`course.read_draft`). */
export async function listRevisions(ctx: Ctx, courseId: string): Promise<RevisionSummary[]> {
  assertCan(ctx.actor, "course.read_draft");
  const rows = await ctx.db
    .select()
    .from(courseVersion)
    .where(eq(courseVersion.courseId, courseId))
    .orderBy(desc(courseVersion.revision));
  return rows.map(({ snapshot: _snapshot, validation, generationMeta: _meta, ...rest }) => ({
    ...rest,
    validationErrors: countOf(validation, "errors"),
    validationWarnings: countOf(validation, "warnings"),
  }));
}

/** One revision with its content (`course.read_draft`). */
export async function getRevision(
  ctx: Ctx,
  courseId: string,
  revision: number,
): Promise<{ version: CourseVersionRow; content: Course }> {
  assertCan(ctx.actor, "course.read_draft");
  const [version] = await ctx.db
    .select()
    .from(courseVersion)
    .where(and(eq(courseVersion.courseId, courseId), eq(courseVersion.revision, revision)))
    .limit(1);
  if (!version) throw new AppError("not_found", `Revision ${revision} of this course could not be found.`);
  return { version, content: contentOfVersion(version) };
}

/** The newest revision being edited or reviewed (`course.read_draft`). */
export async function getWorkingVersion(ctx: Ctx, courseId: string): Promise<CourseWithContent> {
  assertCan(ctx.actor, "course.read_draft");
  const [current] = await ctx.db.select().from(course).where(eq(course.id, courseId)).limit(1);
  if (!current || current.workingVersionId === null) throw new AppError("not_found", "That course could not be found.");
  const version = await requireVersion(ctx.db, current.workingVersionId);
  return { course: current, version, content: contentOfVersion(version) };
}

/**
 * The live course for a slug, or null. A course is returned only when its status is `published`, it
 * has not been taken down, and its published version really carries a publish time. Drafts, courses
 * in review, courses flagged `needs_review`, taken-down and retired courses all return null, so a
 * guessed slug behaves exactly like a course that does not exist.
 *
 * No authorisation check: the catalogue is public. The caller applies the age gate, and must pass
 * `content` through `toLearnerCourse` before sending any of it to a browser.
 */
export async function getPublishedCourseBySlug(ctx: Pick<Ctx, "db">, slug: string): Promise<CourseWithContent | null> {
  const [row] = await ctx.db
    .select({ course, version: courseVersion })
    .from(course)
    .innerJoin(courseVersion, eq(courseVersion.id, course.publishedVersionId))
    .where(
      and(
        eq(course.slug, slug),
        eq(course.status, "published"),
        isNull(course.takenDownAt),
        isNotNull(courseVersion.publishedAt),
        eq(courseVersion.courseId, course.id),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { course: row.course, version: row.version, content: contentOfVersion(row.version) };
}

/**
 * The content of one version, for the player (a learner is pinned to the version they started) and
 * for staff. A version that has never been published is a draft: it is returned only to someone
 * who may read drafts, and to everyone else it does not exist. The result includes internal
 * fields; use `toLearnerCourse` before it reaches a browser.
 */
export async function loadVersionContent(ctx: Ctx, versionId: string): Promise<Course> {
  const [version] = await ctx.db.select().from(courseVersion).where(eq(courseVersion.id, versionId)).limit(1);
  if (!version || (version.publishedAt === null && !can(ctx.actor, "course.read_draft"))) {
    throw new AppError("not_found", "That course could not be found.");
  }
  return contentOfVersion(version);
}

// ───────────────────────────── Materialising ─────────────────────────────

const excluded = (column: AnyColumn): SQL => sql.raw(`excluded."${column.name}"`);

function assertUniqueKeys(keys: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new AppError("validation_failed", `Two ${kind} entries share the id "${key}". Give each its own id before publishing.`);
    }
    seen.add(key);
  }
}

const percent = (fraction: number | undefined): number | null => (fraction === undefined ? null : Math.round(fraction * 100));

/**
 * Writes the rows the player and progress tracking use (`module`, `lesson`, `step`, `quiz`,
 * `quiz_question`, `rubric_criterion`, `course_tool`, `tool_guide`, `tool_guide_step`) from a
 * version's snapshot. Call it inside the publish transaction.
 *
 * Idempotent: rows are matched on their JSON id (`key`), so running it again keeps every row id,
 * creates no duplicates, and leaves `step.disabled` and a guide's `stale` flag exactly as they
 * are. Positions follow the order items are listed in the snapshot. Thresholds and pass marks are
 * stored as whole percentages. Returns a map from the JSON step id to `step.id`.
 */
export async function materialiseVersion(tx: Db, versionId: string): Promise<Map<string, string>> {
  const version = await requireVersion(tx, versionId);
  const content = contentOfVersion(version);
  const flat = flattenSteps(content);

  assertUniqueKeys(content.modules.map((item) => item.id), "module");
  assertUniqueKeys(content.modules.flatMap((item) => item.lessons.map((entry) => entry.id)), "lesson");
  assertUniqueKeys(flat.map((entry) => entry.step.id), "step");
  assertUniqueKeys(content.quizzes.map((item) => item.id), "quiz");
  assertUniqueKeys(content.rubric.criteria.map((item) => item.id), "rubric criterion");
  assertUniqueKeys(content.setupGuides.map((item) => item.id), "setup guide");
  assertUniqueKeys(content.toolRequirements.map((item) => item.toolSlug), "tool requirement");

  // Modules
  const moduleRows = await tx
    .insert(courseModule)
    .values(content.modules.map((item, position) => ({ courseVersionId: versionId, key: item.id, title: item.title, summary: item.summary, position })))
    .onConflictDoUpdate({
      target: [courseModule.courseVersionId, courseModule.key],
      set: { title: excluded(courseModule.title), summary: excluded(courseModule.summary), position: excluded(courseModule.position) },
    })
    .returning({ id: courseModule.id, key: courseModule.key });
  const moduleIds = new Map(moduleRows.map((row) => [row.key, row.id]));

  // Lessons
  const lessonValues = content.modules.flatMap((item) =>
    item.lessons.map((entry, position) => ({
      courseVersionId: versionId,
      moduleId: moduleIds.get(item.id) ?? "",
      key: entry.id,
      title: entry.title,
      position,
      estimatedMinutes: entry.estimatedMinutes,
    })),
  );
  const lessonRows = await tx
    .insert(lesson)
    .values(lessonValues)
    .onConflictDoUpdate({
      target: [lesson.courseVersionId, lesson.key],
      set: {
        moduleId: excluded(lesson.moduleId),
        title: excluded(lesson.title),
        position: excluded(lesson.position),
        estimatedMinutes: excluded(lesson.estimatedMinutes),
      },
    })
    .returning({ id: lesson.id, key: lesson.key });
  const lessonIds = new Map(lessonRows.map((row) => [row.key, row.id]));

  // Steps. `disabled*` is deliberately absent from the update: an urgent step take-down survives.
  const stepValues = flat.map((entry) => {
    const toolSlug = entry.step.config?.toolSlug;
    return {
      courseVersionId: versionId,
      lessonId: lessonIds.get(entry.lesson.id) ?? "",
      key: entry.step.id,
      type: entry.step.type,
      title: entry.step.title,
      position: entry.stepIndex,
      estimatedMinutes: entry.step.estimatedMinutes,
      body: entry.step.body ?? null,
      assetKeys: entry.step.assetIds ?? [],
      config: entry.step.config ?? {},
      completionRule: entry.step.completion.rule,
      completionThreshold: percent(entry.step.completion.threshold),
      coachContext: entry.step.coachContext ?? null,
      hints: entry.step.hints,
      toolSlug: typeof toolSlug === "string" ? toolSlug : null,
    };
  });
  const stepRows = await tx
    .insert(step)
    .values(stepValues)
    .onConflictDoUpdate({
      target: [step.courseVersionId, step.key],
      set: {
        lessonId: excluded(step.lessonId),
        type: excluded(step.type),
        title: excluded(step.title),
        position: excluded(step.position),
        estimatedMinutes: excluded(step.estimatedMinutes),
        body: excluded(step.body),
        assetKeys: excluded(step.assetKeys),
        config: excluded(step.config),
        completionRule: excluded(step.completionRule),
        completionThreshold: excluded(step.completionThreshold),
        coachContext: excluded(step.coachContext),
        hints: excluded(step.hints),
        toolSlug: excluded(step.toolSlug),
      },
    })
    .returning({ id: step.id, key: step.key });
  const stepIds = new Map(stepRows.map((row) => [row.key, row.id]));

  // Quizzes and questions
  const quizIds = new Map<string, string>();
  if (content.quizzes.length > 0) {
    const quizRows = await tx
      .insert(quiz)
      .values(content.quizzes.map((item) => ({ courseVersionId: versionId, key: item.id, title: item.title, passMark: Math.round(item.passMark * 100) })))
      .onConflictDoUpdate({
        target: [quiz.courseVersionId, quiz.key],
        set: { title: excluded(quiz.title), passMark: excluded(quiz.passMark) },
      })
      .returning({ id: quiz.id, key: quiz.key });
    for (const row of quizRows) quizIds.set(row.key, row.id);
    for (const item of content.quizzes) {
      const quizId = quizIds.get(item.id);
      if (quizId === undefined) continue;
      assertUniqueKeys(item.questions.map((question) => question.id), `question in quiz "${item.id}"`);
      await tx
        .insert(quizQuestion)
        .values(
          item.questions.map((question, position) => ({
            quizId,
            key: question.id,
            kind: question.kind,
            prompt: question.prompt,
            options: question.options as unknown[],
            position,
          })),
        )
        .onConflictDoUpdate({
          target: [quizQuestion.quizId, quizQuestion.key],
          set: {
            kind: excluded(quizQuestion.kind),
            prompt: excluded(quizQuestion.prompt),
            options: excluded(quizQuestion.options),
            position: excluded(quizQuestion.position),
          },
        });
      await tx.delete(quizQuestion).where(
        and(eq(quizQuestion.quizId, quizId), notInArray(quizQuestion.key, item.questions.map((question) => question.id))),
      );
    }
  }

  // Rubric
  await tx
    .insert(rubricCriterion)
    .values(
      content.rubric.criteria.map((item, position) => ({
        courseVersionId: versionId,
        key: item.id,
        name: item.name,
        description: item.description,
        levels: item.levels as unknown[],
        position,
      })),
    )
    .onConflictDoUpdate({
      target: [rubricCriterion.courseVersionId, rubricCriterion.key],
      set: {
        name: excluded(rubricCriterion.name),
        description: excluded(rubricCriterion.description),
        levels: excluded(rubricCriterion.levels),
        position: excluded(rubricCriterion.position),
      },
    });

  // Tools and guides. Only the tool's id is stored: its facts are read from the Register at request time.
  const tools = await getToolsBySlugs({ db: tx }, [
    ...content.toolRequirements.flatMap((item) => [item.toolSlug, ...(item.fallbackToolSlug === undefined ? [] : [item.fallbackToolSlug])]),
    ...content.setupGuides.map((item) => item.toolSlug),
  ]);
  const toolValues: Array<typeof courseTool.$inferInsert> = [];
  content.toolRequirements.forEach((item, position) => {
    const row = tools.get(item.toolSlug);
    if (!row) {
      if (!item.required) return; // an optional tool that is not in the Register is simply not offered
      throw new AppError("validation_failed", `The required tool "${item.toolSlug}" is not in the Tool Register.`);
    }
    toolValues.push({
      courseVersionId: versionId,
      courseId: version.courseId,
      toolId: row.id,
      purpose: item.purpose,
      required: item.required,
      fallbackToolId: item.fallbackToolSlug === undefined ? null : (tools.get(item.fallbackToolSlug)?.id ?? null),
      position,
    });
  });
  if (toolValues.length > 0) {
    await tx
      .insert(courseTool)
      .values(toolValues)
      .onConflictDoUpdate({
        target: [courseTool.courseVersionId, courseTool.toolId],
        set: {
          purpose: excluded(courseTool.purpose),
          required: excluded(courseTool.required),
          fallbackToolId: excluded(courseTool.fallbackToolId),
          position: excluded(courseTool.position),
        },
      });
  }

  const waivers = new Map((await loadRecordedWaivers(tx, versionId)).map((waiver) => [waiver.check, waiver]));
  const guideKeys: string[] = [];
  for (const guide of content.setupGuides) {
    const row = tools.get(guide.toolSlug);
    if (!row) continue; // a guide for a tool that is not in the Register (the validator warns about it)
    guideKeys.push(guide.id);
    const waiver = waivers.get(setupGuideWaiverKey(guide.toolSlug));
    const kinds = new Set(guide.steps.map((item) => item.kind));
    const waiverValue = waiver
      ? {
          check: waiver.check,
          sections: REQUIRED_SETUP_GUIDE_KINDS.filter((kind) => !kinds.has(kind)),
          reason: waiver.reason,
          reviewerId: waiver.reviewerId,
          at: waiver.at.toISOString(),
        }
      : null;
    const [guideRow] = await tx
      .insert(toolGuide)
      .values({
        courseVersionId: versionId,
        toolId: row.id,
        key: guide.id,
        title: guide.title,
        lastVerifiedAt: toDate(guide.lastVerifiedAt),
        waiver: waiverValue,
      })
      .onConflictDoUpdate({
        target: [toolGuide.courseVersionId, toolGuide.key],
        set: {
          toolId: excluded(toolGuide.toolId),
          title: excluded(toolGuide.title),
          lastVerifiedAt: excluded(toolGuide.lastVerifiedAt),
          waiver: excluded(toolGuide.waiver),
        },
      })
      .returning({ id: toolGuide.id });
    if (!guideRow) continue;
    assertUniqueKeys(guide.steps.map((item) => item.id), `step in guide "${guide.id}"`);
    await tx
      .insert(toolGuideStep)
      .values(
        guide.steps.map((item, position) => ({
          toolGuideId: guideRow.id,
          key: item.id,
          title: item.title,
          position,
          kind: item.kind,
          body: item.body,
          screenshotAssetKeys: item.screenshotAssetIds ?? [],
        })),
      )
      .onConflictDoUpdate({
        target: [toolGuideStep.toolGuideId, toolGuideStep.key],
        set: {
          title: excluded(toolGuideStep.title),
          position: excluded(toolGuideStep.position),
          kind: excluded(toolGuideStep.kind),
          body: excluded(toolGuideStep.body),
          screenshotAssetKeys: excluded(toolGuideStep.screenshotAssetKeys),
        },
      });
    await tx.delete(toolGuideStep).where(
      and(eq(toolGuideStep.toolGuideId, guideRow.id), notInArray(toolGuideStep.key, guide.steps.map((item) => item.id))),
    );
  }

  // Remove rows for ids that are no longer in the snapshot. For a published version there are none,
  // because its snapshot is frozen; a row that progress points at refuses to go (RESTRICT).
  const stale = (keyColumn: AnyColumn, versionColumn: AnyColumn, keys: readonly string[]): SQL | undefined =>
    keys.length === 0 ? eq(versionColumn, versionId) : and(eq(versionColumn, versionId), notInArray(keyColumn, [...keys]));
  await tx.delete(step).where(stale(step.key, step.courseVersionId, [...stepIds.keys()]));
  await tx.delete(lesson).where(stale(lesson.key, lesson.courseVersionId, [...lessonIds.keys()]));
  await tx.delete(courseModule).where(stale(courseModule.key, courseModule.courseVersionId, [...moduleIds.keys()]));
  await tx.delete(quiz).where(stale(quiz.key, quiz.courseVersionId, [...quizIds.keys()]));
  await tx.delete(rubricCriterion).where(
    stale(rubricCriterion.key, rubricCriterion.courseVersionId, content.rubric.criteria.map((item) => item.id)),
  );
  await tx.delete(toolGuide).where(stale(toolGuide.key, toolGuide.courseVersionId, guideKeys));
  await tx.delete(courseTool).where(
    toolValues.length === 0
      ? eq(courseTool.courseVersionId, versionId)
      : and(eq(courseTool.courseVersionId, versionId), notInArray(courseTool.toolId, toolValues.map((item) => item.toolId))),
  );

  await tx.update(courseVersion).set({ materialisedAt: sql`now()` }).where(eq(courseVersion.id, versionId));
  return stepIds;
}
