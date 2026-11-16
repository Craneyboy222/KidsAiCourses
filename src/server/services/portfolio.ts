// CONTRACT — owner: tools and submissions slice. See _contract.ts.
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { ProjectBrief } from "@/content/schema";
import { audit } from "@/server/audit";
import { can, hasRole } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { artefact, certificate, course, courseVersion, enrolment, project, projectVersion, rubricCriterion } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStorage, isInlineSafeType } from "@/server/storage";
import { contentOfVersion } from "./course-store";
import { getFamilyIdForLearner } from "./family";
import { evidenceItemsFor, type EvidenceItem } from "./submission";

export type ProjectView = {
  id: string;
  learnerId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  title: string;
  status: "awaiting_review" | "accepted" | "needs_changes";
  submittedAt: Date;
  acceptedAt: Date | null;
  artefactCount: number;
};

/** How long a link to a stored file works for. Long enough to open it, too short to pass around. */
export const ARTEFACT_LINK_SECONDS = 120;

type Viewer = "owner" | "parent" | "staff";
type PortfolioAction = "learner.portfolio.read" | "learner.artefact.download";

/**
 * Who is looking at a learner's work, or null for anyone who may not: the learner themselves, a
 * parent or carer in the same family, or staff who moderate. Nobody else, and there is no public
 * or shared view at launch.
 */
async function viewerOf(ctx: Ctx, learnerId: string, action: PortfolioAction): Promise<Viewer | null> {
  const { actor } = ctx;
  if (actor.type === "learner") return can(actor, action, { learnerId }) ? "owner" : null;
  if (actor.type === "parent") return can(actor, action, { familyId: await getFamilyIdForLearner(ctx, learnerId) }) ? "parent" : null;
  if (actor.type === "staff") return can(actor, action) ? "staff" : null;
  return null;
}

const toStatus = (status: "in_progress" | "awaiting_review" | "accepted" | "blocked"): ProjectView["status"] | null =>
  status === "accepted" ? "accepted" : status === "awaiting_review" ? "awaiting_review" : status === "blocked" ? "needs_changes" : null;

const projectColumns = {
  id: project.id,
  learnerId: project.learnerId,
  courseId: project.courseId,
  courseSlug: course.slug,
  courseTitle: course.title,
  title: project.title,
  status: project.status,
  acceptedAt: project.acceptedAt,
  currentVersionId: project.currentVersionId,
  enrolmentId: project.enrolmentId,
  submittedAt: projectVersion.submittedAt,
  updatedAt: project.updatedAt,
};

/** Accepted projects for the learner and their linked parents. Pending items are included only when the viewer is the submitter. */
export async function listProjects(ctx: Ctx, learnerId: string): Promise<ProjectView[]> {
  const viewer = await viewerOf(ctx, learnerId, "learner.portfolio.read");
  if (!viewer) {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("forbidden", "You don't have permission to do that.");
  }
  const rows = await ctx.db
    .select(projectColumns)
    .from(project)
    .innerJoin(course, eq(course.id, project.courseId))
    .leftJoin(projectVersion, eq(projectVersion.id, project.currentVersionId))
    .where(and(eq(project.learnerId, learnerId), viewer === "owner" ? ne(project.status, "in_progress") : eq(project.status, "accepted")))
    .orderBy(desc(project.updatedAt));

  const versionIds = rows.flatMap((row) => (row.currentVersionId ? [row.currentVersionId] : []));
  const counts = new Map<string, number>();
  if (versionIds.length > 0) {
    const counted = await ctx.db
      .select({ versionId: artefact.projectVersionId, total: count() })
      .from(artefact)
      .where(and(inArray(artefact.projectVersionId, versionIds), eq(artefact.quarantined, false), viewer === "owner" ? ne(artefact.moderationState, "blocked") : eq(artefact.moderationState, "approved")))
      .groupBy(artefact.projectVersionId);
    for (const entry of counted) if (entry.versionId) counts.set(entry.versionId, entry.total);
  }

  const views: ProjectView[] = [];
  for (const row of rows) {
    const status = toStatus(row.status);
    if (!status) continue;
    views.push({ id: row.id, learnerId: row.learnerId, courseId: row.courseId, courseSlug: row.courseSlug, courseTitle: row.courseTitle, title: row.title, status, submittedAt: row.submittedAt ?? row.updatedAt, acceptedAt: row.acceptedAt, artefactCount: row.currentVersionId ? (counts.get(row.currentVersionId) ?? 0) : 0 });
  }
  return views;
}

export type ProjectDetail = ProjectView & {
  /** True when the viewer is the learner who made it. */
  mine: boolean;
  /** The step to go back to when changes are needed. */
  stepKeyToResume: string | null;
  brief: ProjectBrief | null;
  rubric: { key: string; name: string; description: string; answer: string | null }[];
  evidence: EvidenceItem[];
  /** The learner's own note. Shown to the learner only. */
  note: string | null;
  /** The reviewer's message when changes are needed. Shown to the learner only. */
  message: string | null;
  /** Earlier submissions, newest first. Shown to the learner only. */
  versions: { version: number; submittedAt: Date; state: "awaiting_review" | "accepted" | "needs_changes" }[];
  certificateId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One project with its brief, evidence, rubric self-check and status. Returns null for a project
 * that does not exist AND for one the viewer may not see, so the two cannot be told apart: another
 * family's project, or (for anyone but the learner) one that has not been accepted.
 */
export async function getProject(ctx: Ctx, projectId: string): Promise<ProjectDetail | null> {
  if (!UUID.test(projectId)) return null;
  const [row] = await ctx.db
    .select({ ...projectColumns, courseVersionId: enrolment.courseVersionId })
    .from(project)
    .innerJoin(course, eq(course.id, project.courseId))
    .innerJoin(enrolment, eq(enrolment.id, project.enrolmentId))
    .leftJoin(projectVersion, eq(projectVersion.id, project.currentVersionId))
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row) return null;
  const viewer = await viewerOf(ctx, row.learnerId, "learner.portfolio.read");
  const status = toStatus(row.status);
  if (!viewer || !status) return null;
  const mine = viewer === "owner";
  if (!mine && status !== "accepted") return null;

  const [current] = row.currentVersionId ? await ctx.db.select().from(projectVersion).where(eq(projectVersion.id, row.currentVersionId)).limit(1) : [];
  const artefactRows = current
    ? await ctx.db
        .select()
        .from(artefact)
        .where(and(eq(artefact.projectVersionId, current.id), eq(artefact.quarantined, false), mine ? undefined : eq(artefact.moderationState, "approved")))
        .orderBy(asc(artefact.createdAt))
    : [];
  const evidence = await evidenceItemsFor(ctx, artefactRows, row.courseVersionId, true);

  const [version] = await ctx.db.select({ id: courseVersion.id, snapshot: courseVersion.snapshot }).from(courseVersion).where(eq(courseVersion.id, row.courseVersionId)).limit(1);
  let brief: ProjectBrief | null = null;
  let stepKeyToResume: string | null = null;
  if (version) {
    try {
      const content = contentOfVersion(version);
      brief = content.projectBrief;
      stepKeyToResume = content.modules.flatMap((entry) => entry.lessons.flatMap((lesson) => lesson.steps)).find((entry) => entry.type === "submit")?.id ?? null;
    } catch {
      brief = null;
    }
  }
  const criteria = await ctx.db.select({ key: rubricCriterion.key, name: rubricCriterion.name, description: rubricCriterion.description }).from(rubricCriterion).where(eq(rubricCriterion.courseVersionId, row.courseVersionId)).orderBy(asc(rubricCriterion.position));
  const answers = current?.selfCheck ?? {};

  const history = mine ? await ctx.db.select({ version: projectVersion.version, submittedAt: projectVersion.submittedAt, state: projectVersion.moderationState }).from(projectVersion).where(eq(projectVersion.projectId, row.id)).orderBy(desc(projectVersion.version)) : [];
  const [issued] = await ctx.db.select({ id: certificate.id }).from(certificate).where(eq(certificate.projectId, row.id)).limit(1);

  return {
    id: row.id,
    learnerId: row.learnerId,
    courseId: row.courseId,
    courseSlug: row.courseSlug,
    courseTitle: row.courseTitle,
    title: row.title,
    status,
    submittedAt: row.submittedAt ?? row.updatedAt,
    acceptedAt: row.acceptedAt,
    artefactCount: evidence.filter((item) => item.state !== "rejected").length,
    mine,
    stepKeyToResume,
    brief,
    rubric: criteria.map((criterion) => ({ ...criterion, answer: answers[criterion.key] ?? null })),
    evidence,
    note: mine ? (current?.note ?? null) : null,
    message: mine && status === "needs_changes" ? (current?.decisionReason ?? null) : null,
    versions: history.map((entry) => ({ version: entry.version, submittedAt: entry.submittedAt, state: entry.state === "approved" ? "accepted" : entry.state === "blocked" ? "needs_changes" : "awaiting_review" })),
    certificateId: issued?.id ?? null,
  };
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const NO_FILE = "That file could not be found. It may have been removed.";

/**
 * A short-lived signed link to one stored file. Files are private: this is the only way to open
 * one, and only for the learner who uploaded it, a parent or carer in their family (accepted work
 * only) and staff who moderate (logged). Anything else, a link, a deleted or rejected file and
 * somebody else's file all answer "not found". The name the browser saves under is ours, never the
 * learner's original file name.
 */
export async function getArtefactDownload(ctx: Ctx, artefactId: string, options: { inline?: boolean } = {}): Promise<{ url: string; expiresInSec: number }> {
  if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  const [row] = UUID.test(artefactId) ? await ctx.db.select().from(artefact).where(eq(artefact.id, artefactId)).limit(1) : [];
  if (!row || row.kind === "link" || row.storageKey === null || row.deletedFromStorageAt !== null || row.sha256 === null) throw new AppError("not_found", NO_FILE);
  const viewer = await viewerOf(ctx, row.learnerId, "learner.artefact.download");
  if (!viewer) throw new AppError("not_found", NO_FILE);

  if (row.quarantined) {
    // Held material is out of reach of the learner, the family and ordinary moderators. A file a
    // detector flagged as possibly illegal is never served by the app at all.
    // TODO(legal): how the DSL handles such a file is for the safeguarding policy and a lawyer (decision D3).
    const dslLooking = viewer === "staff" && hasRole(ctx.actor, "dsl") && !row.storageKey.startsWith("quarantine/");
    if (!dslLooking) throw new AppError("not_found", NO_FILE);
  }
  // Parents see accepted work only. Work that is waiting, or was sent back, is the learner's alone.
  if (viewer === "parent" && row.moderationState !== "approved") throw new AppError("not_found", NO_FILE);
  if (viewer === "owner" && row.moderationState === "blocked") throw new AppError("not_found", NO_FILE);

  const inline = options.inline === true && isInlineSafeType(row.mime);
  const downloadName = `evidence-${row.id.slice(0, 8)}.${EXTENSIONS[row.mime ?? ""] ?? "bin"}`;
  const url = await getStorage("private").signedDownloadUrl(row.storageKey, { expiresInSec: ARTEFACT_LINK_SECONDS, now: ctx.now, ...(inline ? {} : { downloadName }) });
  if (viewer === "staff") await audit(ctx, { action: "artefact.download", targetType: "artefact", targetId: row.id, meta: { learnerId: row.learnerId, state: row.moderationState } });
  return { url, expiresInSec: ARTEFACT_LINK_SECONDS };
}
