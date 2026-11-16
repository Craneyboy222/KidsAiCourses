/**
 * Evidence and submissions (spec 3.4, Section 7; decisions D3 and D4).
 *
 * A learner builds their project in an external tool and shows us evidence of it: a link we never
 * fetch, or a screenshot, file or video held in private storage. This module is the only place
 * that evidence is accepted, checked, held or rejected.
 *
 *   draft ──submit──▶ automated checks ──▶ accepted                     (clean, and not sampled)
 *                                      └─▶ awaiting review ──▶ accepted | needs changes
 *
 * Rules that must hold whatever else changes:
 *  - Nothing is accepted without passing every automated check. Image and video FILES are never
 *    accepted without a person unless an automatic detector cleared them (never, with `manual`).
 *  - Media that appears to show a real person is rejected and deleted from storage at once; the
 *    hash and metadata stay. Possibly illegal media is quarantined, not deleted, and opens a
 *    critical safeguarding case.
 *  - A sampled submission is HELD: not accepted, not in the portfolio, no certificate.
 *  - A link is never fetched and never embedded. A file name from the browser is never used.
 */
import { randomInt, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { stepConfigSchemas, type EvidenceType } from "@/content/schema";
import { classify } from "@/server/ai/moderation";
import { audit } from "@/server/audit";
import { assertCan, systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { sha256 } from "@/server/crypto";
import { artefact, moderationEvent, project, projectVersion, rubricCriterion, step, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { checkPublicUrl, type Resolver } from "@/server/net/safe-fetch";
import { notify } from "@/server/notifications";
import { getSetting } from "@/server/settings";
import { getStorage, verifyUpload, type SignedUpload } from "@/server/storage";
import { issueCertificateIfEligible } from "./certificate";
import { assertStartAllowed, loadCourseTools } from "./course-tools";
import { getEnrolmentById, recordEvidenceOutcome, type EnrolmentView } from "./enrolment";
import {
  ALLOWED_UPLOAD_TYPES,
  checkDeclaredUpload,
  checkEvidenceLinkShape,
  decideSubmission,
  inspectUpload,
  isUploadKind,
  matchLinkToTool,
  type CheckedItem,
  type HoldReason,
  type LinkTool,
  type SubmissionOutcome,
  type UploadKind,
  type UploadLimitsMb,
} from "./evidence-checks";
import { getLearnerSummary } from "./family";
import { enqueueModeration } from "./moderation";
import { getPeopleDetector, type PeopleVerdict } from "./people-detection";
import { raiseSafeguarding } from "./safeguarding-bridge";

type ArtefactRow = typeof artefact.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type VersionRow = typeof projectVersion.$inferSelect;

export const MAX_EVIDENCE_ITEMS = 8;
export const MAX_TITLE_LENGTH = 80;
export const MAX_NOTE_LENGTH = 1000;
/** A signed upload link that was never used is tidied away after this long. */
export const ABANDONED_UPLOAD_HOURS = 24;

const NOT_FOUND = "That step could not be found. It may have been moved or removed.";

export const PEOPLE_REJECTED_MESSAGE =
  "This looks like it shows a real person, so we can't keep it and we've deleted it. Nothing is wrong with your work. Send a screenshot of your project instead, or use the sample image, a cartoon or an object.";
export const QUARANTINE_MESSAGE = "We couldn't accept that file. Someone from our team will take a look. You don't need to do anything else right now.";
const TEXT_BLOCKED_MESSAGE = "Something in your title or note isn't OK to send. Have another go at the wording, and leave out anything personal.";

/** Injected in tests: the DNS lookup behind the link check, and the dice for the review sample. */
export type SubmissionDeps = { resolver?: Resolver; roll?: () => number };

export type EvidenceItem = {
  id: string;
  kind: ArtefactRow["kind"];
  /** For a link: the address, to show as text. We never fetch it or embed it. */
  url: string | null;
  /** Set when the link sits under a Register tool this course uses: only then may it be shown as a link. */
  linkTool: { slug: string; name: string } | null;
  mime: string | null;
  sizeBytes: number | null;
  /** `ready`: in the draft, not yet sent. */
  state: "ready" | "awaiting_review" | "accepted" | "rejected";
  /** A stored file exists and may be opened by signed link. */
  hasFile: boolean;
  /** Why it was rejected, in words for the learner. */
  message: string | null;
  addedAt: Date;
};

export type SubmissionStatus = "draft" | "awaiting_review" | "accepted" | "needs_changes";

export type SubmissionState = {
  enrolmentId: string;
  stepId: string;
  stepType: "upload" | "submit";
  status: SubmissionStatus;
  allowedKinds: EvidenceType[];
  limitsMb: UploadLimitsMb;
  /** Media types the browser may offer for each upload kind. */
  acceptTypes: Record<UploadKind, string[]>;
  projectId: string | null;
  title: string;
  note: string;
  selfCheck: Record<string, string>;
  /** Evidence not yet sent (a `submit` step), or everything added to an `upload` step. */
  items: EvidenceItem[];
  /** The latest submission that was sent, if any. */
  submitted: { version: number; submittedAt: Date; items: EvidenceItem[]; message: string | null } | null;
  requireSelfCheck: boolean;
};

type StepContext = {
  enrolment: EnrolmentView;
  step: { id: string; type: "upload" | "submit"; toolSlug: string | null };
  allowedKinds: EvidenceType[];
  requireSelfCheck: boolean;
};

// ───────────────────────────── Loading and guards ─────────────────────────────

/**
 * The enrolment and step behind a request, or "not found" for anything the caller may not touch.
 * Only the learner who owns the enrolment reaches this point: somebody else's enrolment answers
 * exactly like one that does not exist.
 */
async function loadStepContext(ctx: Ctx, enrolmentId: string, stepId: string): Promise<StepContext> {
  const view = await getEnrolmentById(ctx, enrolmentId);
  if (!view || ctx.actor.type !== "learner" || ctx.actor.userId !== view.learnerId) throw new AppError("not_found", NOT_FOUND);
  if (view.status === "withdrawn") throw new AppError("not_found", NOT_FOUND);

  const [row] = await ctx.db
    .select({ id: step.id, type: step.type, config: step.config, toolSlug: step.toolSlug, disabled: step.disabled })
    .from(step)
    .where(and(eq(step.id, stepId), eq(step.courseVersionId, view.courseVersionId)))
    .limit(1);
  if (!row || (row.type !== "upload" && row.type !== "submit")) throw new AppError("not_found", NOT_FOUND);
  if (row.disabled) throw new AppError("conflict", "This step is switched off at the moment, so there is nothing to send in. You can carry on with the rest of the course.");

  if (row.type === "submit") {
    const parsed = stepConfigSchemas.submit.safeParse(row.config ?? {});
    if (!parsed.success) throw new AppError("internal", "This step isn't set up properly. Please tell us using the Report button.", { detail: { stepId } });
    return { enrolment: view, step: { id: row.id, type: "submit", toolSlug: row.toolSlug }, allowedKinds: parsed.data.evidence, requireSelfCheck: parsed.data.requireRubricSelfCheck };
  }
  const parsed = stepConfigSchemas.upload.safeParse(row.config ?? {});
  if (!parsed.success) throw new AppError("internal", "This step isn't set up properly. Please tell us using the Report button.", { detail: { stepId } });
  return { enrolment: view, step: { id: row.id, type: "upload", toolSlug: row.toolSlug }, allowedKinds: parsed.data.evidence, requireSelfCheck: false };
}

/**
 * The guard on every write. The start gate runs each time, so a revoked tool approval, a pause,
 * the daily cap, quiet hours or a take-down stops new evidence exactly as it stops the player.
 */
async function loadForWrite(ctx: Ctx, enrolmentId: string, stepId: string): Promise<StepContext> {
  const context = await loadStepContext(ctx, enrolmentId, stepId);
  assertCan(ctx.actor, "learner.submission.create", { learnerId: context.enrolment.learnerId });
  await assertStartAllowed(ctx, context.enrolment.learnerId, context.enrolment.courseId);
  return context;
}

const isUploadTicket = (row: ArtefactRow): boolean => row.kind !== "link" && row.sha256 === null && row.deletedFromStorageAt === null;

/** Evidence on a step that is not part of a sent submission, oldest first. Unfinished uploads and quarantined files are left out. */
async function stepArtefacts(db: Db, enrolmentId: string, stepId: string): Promise<ArtefactRow[]> {
  const rows = await db
    .select()
    .from(artefact)
    .where(and(eq(artefact.enrolmentId, enrolmentId), eq(artefact.stepId, stepId), isNull(artefact.projectVersionId), eq(artefact.quarantined, false)))
    .orderBy(asc(artefact.createdAt), asc(artefact.id));
  return rows.filter((row) => !isUploadTicket(row));
}

async function linkToolsFor(ctx: Pick<Ctx, "db">, courseVersionId: string): Promise<LinkTool[]> {
  const entries = await loadCourseTools(ctx, courseVersionId);
  return entries.flatMap((entry) => (entry.fallback ? [entry.tool, entry.fallback] : [entry.tool])).filter((row) => row.status === "approved" && row.under18Policy !== null && row.under18Policy !== "blocked");
}

function toItem(row: ArtefactRow, tools: readonly LinkTool[], sent: boolean): EvidenceItem {
  const matched = row.kind === "link" && row.url ? matchLinkToTool(row.url, tools) : null;
  const state: EvidenceItem["state"] = row.moderationState === "approved" ? "accepted" : row.moderationState === "blocked" ? "rejected" : sent ? "awaiting_review" : "ready";
  return {
    id: row.id,
    kind: row.kind,
    url: row.kind === "link" ? row.url : null,
    linkTool: matched ? { slug: matched.slug, name: matched.name } : null,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    state,
    hasFile: row.kind !== "link" && row.storageKey !== null && row.deletedFromStorageAt === null && !row.quarantined,
    message: row.moderationState === "blocked" ? (row.rejectedReason ?? "This wasn't accepted. Have a look at what the step asks for and send something else.") : null,
    addedAt: row.createdAt,
  };
}

/** Exported for the portfolio: evidence rows as a viewer may see them. */
export async function evidenceItemsFor(ctx: Pick<Ctx, "db">, rows: readonly ArtefactRow[], courseVersionId: string, sent: boolean): Promise<EvidenceItem[]> {
  const tools = await linkToolsFor(ctx, courseVersionId);
  return rows.map((row) => toItem(row, tools, sent));
}

const projectStatus = (row: ProjectRow | undefined): SubmissionStatus => (!row || row.status === "in_progress" ? "draft" : row.status === "blocked" ? "needs_changes" : row.status);

function uploadStepStatus(items: readonly EvidenceItem[]): SubmissionStatus {
  if (items.some((item) => item.state === "accepted")) return "accepted";
  if (items.some((item) => item.state === "awaiting_review")) return "awaiting_review";
  return items.some((item) => item.state === "rejected") ? "needs_changes" : "draft";
}

// ───────────────────────────── Reading ─────────────────────────────

/** Where a learner is with an evidence step. For the learner who owns the enrolment only. */
export async function getSubmissionState(ctx: Ctx, input: { enrolmentId: string; stepId: string }): Promise<SubmissionState> {
  const context = await loadStepContext(ctx, input.enrolmentId, input.stepId);
  const [limitsMb, tools, rows] = await Promise.all([
    getSetting(ctx, "uploads.max_mb"),
    linkToolsFor(ctx, context.enrolment.courseVersionId),
    stepArtefacts(ctx.db, input.enrolmentId, input.stepId),
  ]);
  const acceptTypes = { screenshot: ALLOWED_UPLOAD_TYPES.screenshot.map((rule) => rule.mime), file: ALLOWED_UPLOAD_TYPES.file.map((rule) => rule.mime), video: ALLOWED_UPLOAD_TYPES.video.map((rule) => rule.mime) };
  const base = { enrolmentId: input.enrolmentId, stepId: input.stepId, allowedKinds: context.allowedKinds, limitsMb, acceptTypes, requireSelfCheck: context.requireSelfCheck };

  if (context.step.type === "upload") {
    // On an upload step each piece of evidence is sent as soon as it is added, so anything not yet decided is with a reviewer.
    const items = rows.map((row) => toItem(row, tools, true));
    return { ...base, stepType: "upload", status: uploadStepStatus(items), projectId: null, title: "", note: "", selfCheck: {}, items, submitted: null };
  }

  const [mine] = await ctx.db.select().from(project).where(eq(project.enrolmentId, input.enrolmentId)).limit(1);
  const [current] = mine?.currentVersionId ? await ctx.db.select().from(projectVersion).where(eq(projectVersion.id, mine.currentVersionId)).limit(1) : [];
  const sentRows = current ? await ctx.db.select().from(artefact).where(and(eq(artefact.projectVersionId, current.id), eq(artefact.quarantined, false))).orderBy(asc(artefact.createdAt)) : [];
  return {
    ...base,
    stepType: "submit",
    status: projectStatus(mine),
    projectId: mine?.id ?? null,
    title: mine?.title ?? context.enrolment.courseTitle,
    note: current?.note ?? "",
    selfCheck: current?.selfCheck ?? {},
    items: rows.map((row) => toItem(row, tools, false)),
    submitted: current ? { version: current.version, submittedAt: current.submittedAt, items: sentRows.map((row) => toItem(row, tools, true)), message: current.moderationState === "blocked" ? current.decisionReason : null } : null,
  };
}

// ───────────────────────────── Adding evidence ─────────────────────────────

async function assertRoomForMore(ctx: Ctx, context: StepContext): Promise<void> {
  if (context.step.type === "submit") {
    const [mine] = await ctx.db.select({ status: project.status }).from(project).where(eq(project.enrolmentId, context.enrolment.id)).limit(1);
    if (mine?.status === "awaiting_review") throw new AppError("conflict", "Your project is being checked at the moment, so it can't be changed. We'll tell you as soon as it's done.");
    if (mine?.status === "accepted") throw new AppError("conflict", "Your project has already been accepted. It's in your portfolio.");
  }
  const live = (await stepArtefacts(ctx.db, context.enrolment.id, context.step.id)).filter((row) => row.moderationState !== "blocked");
  if (live.length >= MAX_EVIDENCE_ITEMS) throw new AppError("conflict", `You can add up to ${MAX_EVIDENCE_ITEMS} things here. Remove one first if you want to swap it.`);
}

async function recordCheck(db: Db, input: { subjectType: "artefact" | "project_version"; subjectId: string; learnerId: string; provider: string; verdict: "clean" | "flagged" | "blocked"; categories: Record<string, unknown>; severity?: "critical" | "high" | "normal"; now: Date }): Promise<void> {
  await db.insert(moderationEvent).values({ subjectType: input.subjectType, subjectId: input.subjectId, learnerId: input.learnerId, provider: input.provider, verdict: input.verdict, categories: input.categories, severity: input.severity ?? null, createdAt: input.now });
}

const HOLD_SUMMARY: Record<HoldReason, string> = {
  auto_accept_off: "Automatic acceptance is switched off: every submission is checked by a person.",
  people_check_needed: "An image or video file needs a person to check that it shows no real people.",
  link_off_register: "A link points somewhere that is not one of this course's Register tools.",
  text_flagged: "The title or note raised a safety flag.",
  sampled: "Picked for the random review sample. Held until reviewed.",
};

const holdSummary = (outcome: Extract<SubmissionOutcome, { decision: "hold" }>): string => outcome.reasons.map((reason) => HOLD_SUMMARY[reason]).join(" ");

const asSystem = (ctx: Ctx, job: string): Ctx => ({ ...ctx, actor: systemActor(job) });

const roll = (deps: SubmissionDeps): number => (deps.roll ? deps.roll() : randomInt(0, 1_000_000) / 1_000_000);

/**
 * The outcome of an `upload` step, from everything on it: accepted once one piece of evidence is
 * accepted, waiting while any is with a reviewer, otherwise rejected. `actorCtx` is who is
 * responsible: the automatic checks (system), or the member of staff who decided.
 */
async function syncUploadStep(actorCtx: Ctx, enrolmentId: string, stepId: string): Promise<void> {
  const rows = await stepArtefacts(actorCtx.db, enrolmentId, stepId);
  const outcome = rows.some((row) => row.moderationState === "approved") ? "accepted" : rows.some((row) => row.moderationState === "pending") ? "submitted" : "rejected";
  await recordEvidenceOutcome(actorCtx, { enrolmentId, stepId, outcome });
}

/** An `upload` step has no separate "send" moment: each piece of evidence is checked as soon as it is in. */
async function finaliseUploadStepItem(ctx: Ctx, context: StepContext, row: ArtefactRow, deps: SubmissionDeps): Promise<void> {
  const tools = await linkToolsFor(ctx, context.enrolment.courseVersionId);
  const [autoAccept, sampleRate] = await Promise.all([getSetting(ctx, "moderation.auto_accept_clean_submissions"), getSetting(ctx, "moderation.sample_rate")]);
  const checked: CheckedItem = { kind: row.kind, peopleCheck: row.peopleCheck, onRegister: row.kind === "link" && row.url ? matchLinkToTool(row.url, tools) !== null : undefined };
  const outcome = decideSubmission({ autoAccept, sampleRate, roll: roll(deps), items: [checked], textSeverity: null });
  const system = asSystem(ctx, "submission.auto_checks");
  await ctx.db.transaction(async (tx) => {
    if (outcome.decision === "accept") {
      await tx.update(artefact).set({ moderationState: "approved", updatedAt: ctx.now }).where(eq(artefact.id, row.id));
    } else {
      await enqueueModeration({ ...ctx, db: tx }, { subjectType: "artefact", subjectId: row.id, learnerId: row.learnerId, source: outcome.source, severity: outcome.severity, reason: holdSummary(outcome), flags: { reasons: outcome.reasons, sampled: outcome.sampled } });
    }
    await recordCheck(tx, { subjectType: "artefact", subjectId: row.id, learnerId: row.learnerId, provider: "submission-checks", verdict: outcome.decision === "accept" ? "clean" : "flagged", categories: { reasons: outcome.reasons, sampled: outcome.sampled }, now: ctx.now });
    await syncUploadStep({ ...system, db: tx }, context.enrolment.id, context.step.id);
  });
}

/**
 * Adds a link as evidence. The link must be https, on the public internet, free of sign-in details,
 * and (where the step names a tool) under that tool's allow-list in the Register. The learner must
 * confirm that the linked work shows no real people: we never open the link to look.
 */
export async function addLinkEvidence(ctx: Ctx, input: { enrolmentId: string; stepId: string; url: string; declaredNoPeople: boolean }, deps: SubmissionDeps = {}): Promise<EvidenceItem> {
  const context = await loadForWrite(ctx, input.enrolmentId, input.stepId);
  if (!context.allowedKinds.includes("link")) throw new AppError("invalid_input", "This step doesn't take links. Check what it asks for.");
  if (input.declaredNoPeople !== true) {
    throw new AppError("invalid_input", "Tick the box to confirm your project doesn't show any real people.", { fieldErrors: { declaredNoPeople: ["Tick this box before adding your link. If your project does show a real person, swap them for the sample image, a cartoon or an object first."] } });
  }
  const shape = checkEvidenceLinkShape(input.url);
  if (!shape.ok) throw new AppError("unsafe_url", shape.message, { fieldErrors: { url: [shape.message] } });
  const reachable = await checkPublicUrl(shape.url, deps.resolver);
  if (!reachable.ok) throw new AppError("unsafe_url", reachable.reason, { fieldErrors: { url: [reachable.reason] } });

  const tools = await linkToolsFor(ctx, context.enrolment.courseVersionId);
  if (context.step.toolSlug) {
    // The step names a tool, so the link must be to that tool (or its approved fallback).
    const entries = await loadCourseTools(ctx, context.enrolment.courseVersionId);
    const named = entries.find((entry) => entry.tool.slug === context.step.toolSlug);
    const allowed = tools.filter((tool) => tool.slug === context.step.toolSlug || tool.slug === named?.fallback?.slug);
    if (!matchLinkToTool(shape.url, allowed)) {
      const names = allowed.map((tool) => tool.name).join(" or ") || "the tool for this step";
      const message = `That isn't a ${names} link. Open your project, use its Share button, and paste that link here.`;
      throw new AppError("unsafe_url", message, { fieldErrors: { url: [message] } });
    }
  }

  await assertRoomForMore(ctx, context);
  const existing = (await stepArtefacts(ctx.db, input.enrolmentId, input.stepId)).find((row) => row.kind === "link" && row.url === shape.url && row.moderationState !== "blocked");
  if (existing) return toItem(existing, tools, context.step.type === "upload");

  const [row] = await ctx.db
    .insert(artefact)
    .values({ learnerId: context.enrolment.learnerId, enrolmentId: input.enrolmentId, stepId: input.stepId, kind: "link", url: shape.url, moderationState: "pending", peopleCheck: "declared_no_people", peopleCheckProvider: "declaration", createdAt: ctx.now, updatedAt: ctx.now })
    .returning();
  if (!row) throw new AppError("internal", "We couldn't save that link. Nothing was lost. Try again in a moment.");
  await recordCheck(ctx.db, { subjectType: "artefact", subjectId: row.id, learnerId: row.learnerId, provider: "link-check", verdict: "clean", categories: { https: true, publicAddress: true, onRegister: matchLinkToTool(shape.url, tools) !== null, declaredNoPeople: true }, now: ctx.now });

  if (context.step.type === "upload") {
    await finaliseUploadStepItem(ctx, context, row, deps);
    const [fresh] = await ctx.db.select().from(artefact).where(eq(artefact.id, row.id)).limit(1);
    return toItem(fresh ?? row, tools, true);
  }
  return toItem(row, tools, false);
}

/**
 * Hands out a short-lived signed link for one upload. The type and size the browser reports are
 * checked here, and checked again against the real bytes in `completeUpload`. The file's own name
 * is never asked for: the storage key is ours.
 */
export async function requestUpload(ctx: Ctx, input: { enrolmentId: string; stepId: string; kind: string; contentType: string; sizeBytes: number }): Promise<{ artefactId: string; upload: SignedUpload }> {
  const context = await loadForWrite(ctx, input.enrolmentId, input.stepId);
  if (!isUploadKind(input.kind) || !context.allowedKinds.includes(input.kind)) throw new AppError("invalid_input", "This step doesn't take that kind of evidence. Check what it asks for.");
  const declared = checkDeclaredUpload({ kind: input.kind, contentType: input.contentType, sizeBytes: input.sizeBytes }, await getSetting(ctx, "uploads.max_mb"));
  if (!declared.ok) throw new AppError("upload_rejected", declared.message);
  await assertRoomForMore(ctx, context);

  const id = randomUUID();
  const key = `evidence/pending/${context.enrolment.learnerId}/${id}`;
  await ctx.db.insert(artefact).values({ id, learnerId: context.enrolment.learnerId, enrolmentId: input.enrolmentId, stepId: input.stepId, kind: input.kind, storageKey: key, mime: declared.mime, sizeBytes: input.sizeBytes, moderationState: "pending", peopleCheck: "pending", createdAt: ctx.now, updatedAt: ctx.now });
  const upload = await getStorage("private").signedUploadUrl(key, { contentType: declared.mime, maxBytes: declared.maxBytes, now: ctx.now });
  return { artefactId: id, upload };
}

/** A file already rejected once for showing a person, or quarantined, is treated the same way again without asking the detector. */
async function knownVerdictForHash(db: Db, hash: string): Promise<PeopleVerdict | null> {
  const rows = await db
    .select({ quarantined: artefact.quarantined })
    .from(artefact)
    .where(and(eq(artefact.sha256, hash), or(eq(artefact.quarantined, true), and(eq(artefact.moderationState, "blocked"), eq(artefact.peopleCheck, "people_suspected")))))
    .limit(5);
  if (rows.length === 0) return null;
  return rows.some((row) => row.quarantined) ? "illegal_suspected" : "people";
}

/**
 * Called when the browser says its upload has finished. Nothing about the file is trusted until
 * this has run: it confirms the object exists and is within its size, reads the real type from the
 * bytes and compares it with what was declared, removes metadata from images, records the hash,
 * and runs people screening on images and video.
 */
export async function completeUpload(ctx: Ctx, input: { artefactId: string }, deps: SubmissionDeps = {}): Promise<EvidenceItem> {
  const [ticket] = await ctx.db.select().from(artefact).where(eq(artefact.id, input.artefactId)).limit(1);
  if (!ticket || ctx.actor.type !== "learner" || ticket.learnerId !== ctx.actor.userId || !ticket.stepId) throw new AppError("not_found", "That upload could not be found. Try uploading the file again.");
  if (!isUploadTicket(ticket) || !isUploadKind(ticket.kind) || ticket.storageKey === null || ticket.projectVersionId !== null) throw new AppError("conflict", "That upload has already been dealt with.");
  const kind = ticket.kind;
  const pendingKey = ticket.storageKey;
  const context = await loadForWrite(ctx, ticket.enrolmentId, ticket.stepId);
  const storage = getStorage("private");
  const maxBytes = Math.floor((await getSetting(ctx, "uploads.max_mb"))[kind] * 1024 * 1024);

  const discard = async (): Promise<void> => {
    await storage.delete(pendingKey);
    await ctx.db.delete(artefact).where(eq(artefact.id, ticket.id));
  };

  try {
    await verifyUpload(pendingKey, { maxBytes }, storage);
  } catch (error) {
    await ctx.db.delete(artefact).where(eq(artefact.id, ticket.id));
    throw error;
  }
  const object = await storage.get(pendingKey);
  if (!object) {
    await discard();
    throw new AppError("upload_rejected", "We couldn't find that upload. Try uploading the file again.");
  }
  const inspected = await inspectUpload(object.body, { kind, declaredType: ticket.mime ?? "", maxBytes });
  if (!inspected.ok) {
    await discard();
    await recordCheck(ctx.db, { subjectType: "artefact", subjectId: ticket.id, learnerId: ticket.learnerId, provider: "file-check", verdict: "blocked", categories: { reason: inspected.reason, kind }, now: ctx.now });
    throw new AppError("upload_rejected", inspected.message, { detail: { reason: inspected.reason } });
  }

  // The hash is of the file exactly as it was sent, so the same file can be recognised if it comes back.
  const hash = sha256(object.body);
  const tools = await linkToolsFor(ctx, context.enrolment.courseVersionId);
  const sent = context.step.type === "upload";
  const reread = async (): Promise<EvidenceItem> => {
    const [fresh] = await ctx.db.select().from(artefact).where(eq(artefact.id, ticket.id)).limit(1);
    if (!fresh) throw new AppError("internal", "We couldn't save that upload. Try again in a moment.");
    return toItem(fresh, tools, sent);
  };

  let verdict: PeopleVerdict | null = null;
  let provider: string | null = null;
  if (inspected.isMedia && (kind === "screenshot" || kind === "video")) {
    const detector = getPeopleDetector();
    provider = detector.name;
    const known = await knownVerdictForHash(ctx.db, hash);
    if (known) {
      verdict = known;
      provider = "hash-match";
    } else {
      try {
        verdict = await detector.detect({ bytes: object.body, mime: inspected.mime, kind });
      } catch (error) {
        // A detector that fails never clears anything: a person looks instead.
        logError("submission.people_detection_failed", error, { artefactId: ticket.id, provider: detector.name });
        verdict = "needs_human";
      }
    }
  }
  const peopleAllowed = await getSetting(ctx, "uploads.people_screening_enabled");
  const facts = { sha256: hash, mime: inspected.mime, sizeBytes: inspected.bytes.length, peopleCheckProvider: provider, updatedAt: ctx.now };

  if (verdict === "illegal_suspected") {
    // Quarantined exactly as it arrived: kept as evidence, out of everyone's reach, never deleted here.
    // TODO(legal): reporting duties for suspected illegal content are for the DSL and a lawyer to confirm (decision D3).
    const quarantineKey = `quarantine/${ticket.id}`;
    await storage.put(quarantineKey, object.body, { contentType: inspected.mime });
    await storage.delete(pendingKey);
    await ctx.db.update(artefact).set({ ...facts, sizeBytes: object.body.length, storageKey: quarantineKey, quarantined: true, moderationState: "escalated", peopleCheck: "people_suspected", rejectedReason: QUARANTINE_MESSAGE }).where(eq(artefact.id, ticket.id));
    await recordCheck(ctx.db, { subjectType: "artefact", subjectId: ticket.id, learnerId: ticket.learnerId, provider: `people-detection:${provider}`, verdict: "blocked", categories: { illegalSuspected: true, kind }, severity: "critical", now: ctx.now });
    const opened = await raiseSafeguarding(ctx, { learnerId: ticket.learnerId, severity: "critical", trigger: "illegal_content", summary: "An uploaded file was flagged as possibly illegal. It has been quarantined, not deleted.", sourceType: "artefact", sourceId: ticket.id }, { subjectType: "artefact", subjectId: ticket.id });
    await audit(ctx, { action: "artefact.quarantine", targetType: "artefact", targetId: ticket.id, meta: { caseId: opened.caseId, provider } });
    if (sent) await syncUploadStep(asSystem(ctx, "submission.auto_checks"), context.enrolment.id, context.step.id);
    throw new AppError("upload_rejected", QUARANTINE_MESSAGE, { detail: { reason: "quarantined" } });
  }

  if (verdict === "people" && !peopleAllowed) {
    // Deleted from storage first, then recorded: a failure in between leaves a row pointing at nothing, never a kept file.
    await storage.delete(pendingKey);
    await ctx.db.update(artefact).set({ ...facts, sizeBytes: object.body.length, storageKey: null, deletedFromStorageAt: ctx.now, moderationState: "blocked", peopleCheck: "people_suspected", rejectedReason: PEOPLE_REJECTED_MESSAGE }).where(eq(artefact.id, ticket.id));
    await recordCheck(ctx.db, { subjectType: "artefact", subjectId: ticket.id, learnerId: ticket.learnerId, provider: `people-detection:${provider}`, verdict: "blocked", categories: { peopleSuspected: true, kind, deleted: true }, now: ctx.now });
    if (sent) await syncUploadStep(asSystem(ctx, "submission.auto_checks"), context.enrolment.id, context.step.id);
    return reread();
  }

  const peopleCheck: ArtefactRow["peopleCheck"] = verdict === null ? "not_applicable" : verdict === "clear" ? "clear" : "needs_human";
  const finalKey = `evidence/${ticket.learnerId}/${ticket.id}.${inspected.ext}`;
  await storage.put(finalKey, inspected.bytes, { contentType: inspected.mime });
  await storage.delete(pendingKey);
  const [stored] = await ctx.db.update(artefact).set({ ...facts, storageKey: finalKey, peopleCheck }).where(eq(artefact.id, ticket.id)).returning();
  if (!stored) throw new AppError("internal", "We couldn't save that upload. Try again in a moment.");
  await recordCheck(ctx.db, { subjectType: "artefact", subjectId: ticket.id, learnerId: ticket.learnerId, provider: "file-check", verdict: "clean", categories: { kind, mime: inspected.mime, metadataRemoved: inspected.isMedia, people: peopleCheck }, now: ctx.now });

  if (sent) await finaliseUploadStepItem(ctx, context, stored, deps);
  return reread();
}

/**
 * Takes something out of a draft. A file that was never sent is deleted for good. Something that
 * was rejected stays on record (its hash and metadata are kept) and is only cleared from view.
 * Evidence that has been sent, or is with a reviewer, cannot be removed.
 */
export async function removeEvidence(ctx: Ctx, input: { artefactId: string }): Promise<void> {
  const [row] = await ctx.db.select().from(artefact).where(eq(artefact.id, input.artefactId)).limit(1);
  if (!row || ctx.actor.type !== "learner" || row.learnerId !== ctx.actor.userId || !row.stepId || row.quarantined) throw new AppError("not_found", "That couldn't be found. It may already have been removed.");
  assertCan(ctx.actor, "learner.submission.create", { learnerId: row.learnerId });
  const context = await loadStepContext(ctx, row.enrolmentId, row.stepId);
  if (row.projectVersionId !== null) throw new AppError("conflict", "That has already been sent in, so it can't be removed.");
  if (row.moderationState === "blocked") {
    await ctx.db.update(artefact).set({ stepId: null, updatedAt: ctx.now }).where(eq(artefact.id, row.id));
    return;
  }
  if (context.step.type === "upload") throw new AppError("conflict", "That has already been sent in, so it can't be removed.");
  if (row.storageKey) await getStorage("private").delete(row.storageKey);
  await ctx.db.delete(artefact).where(eq(artefact.id, row.id));
}

// ───────────────────────────── Submitting ─────────────────────────────

type TextCheck = { severity: "critical" | "high" | null; trigger: "crisis_classifier" | "abuse_disclosure" | "exploitation" | "grooming" | null; summary: Record<string, number>; action: string };

/**
 * Titles and notes go through the local rules moderator. Wording that would be blocked is turned
 * back before anything is stored. A crisis signal is never turned back: the work is held for a
 * person, a safeguarding case is opened and the learner is shown where to get help.
 */
async function checkText(ctx: Ctx, learnerId: string, stepId: string, texts: readonly string[]): Promise<TextCheck> {
  const summary = await getLearnerSummary(ctx, learnerId);
  const result: TextCheck = { severity: null, trigger: null, summary: {}, action: "allow" };
  for (const text of texts) {
    if (text.trim().length === 0) continue;
    const verdict = classify({ text, direction: "input", band: summary.safetyBand });
    Object.assign(result.summary, verdict.summary);
    if (verdict.action === "crisis" && verdict.crisis) {
      if (result.severity !== "critical") result.severity = verdict.crisis.severity;
      result.trigger = verdict.crisis.trigger;
      result.action = "crisis";
    } else if (verdict.action === "block") {
      if (verdict.safeguarding) {
        await raiseSafeguarding(ctx, { learnerId, severity: verdict.safeguarding.severity, trigger: verdict.safeguarding.trigger, summary: "A project title or note was blocked by the safety rules.", sourceType: "project_text", detail: text }, { subjectType: "step_note", subjectId: stepId });
      }
      throw new AppError("moderation_blocked", TEXT_BLOCKED_MESSAGE, { detail: { category: verdict.category } });
    }
  }
  return result;
}

async function validSelfCheck(db: Db, courseVersionId: string, input: Record<string, string>, required: boolean): Promise<Record<string, string>> {
  const criteria = await db.select({ key: rubricCriterion.key, levels: rubricCriterion.levels }).from(rubricCriterion).where(eq(rubricCriterion.courseVersionId, courseVersionId)).orderBy(asc(rubricCriterion.position));
  const clean: Record<string, string> = {};
  const missing: string[] = [];
  for (const criterion of criteria) {
    const answer = input[criterion.key];
    const labels = Array.isArray(criterion.levels) ? criterion.levels.flatMap((level) => (level && typeof level === "object" && "label" in level && typeof level.label === "string" ? [level.label] : [])) : [];
    if (typeof answer === "string" && labels.includes(answer)) clean[criterion.key] = answer;
    else missing.push(criterion.key);
  }
  if (required && missing.length > 0) {
    throw new AppError("invalid_input", "Rate your project against each point before you hand it in. \"Not yet\" is an honest answer and never stops you.", { fieldErrors: Object.fromEntries(missing.map((key) => [`selfCheck.${key}`, ["Choose the answer that fits best."]])) });
  }
  return clean;
}

export type SubmitResult = {
  projectId: string;
  version: number;
  status: "accepted" | "awaiting_review";
  /** Set when a certificate was issued as a result. */
  certificateId: string | null;
  /** The title or note raised a safety flag: show the fixed crisis signposting. */
  showCrisisScript: boolean;
};

/**
 * Sends the draft in. Runs the automated checks, then accepts it, or holds it for a person (a flag,
 * an unchecked image or video, an off-Register link, the auto-accept setting being off, or the
 * random sample). Resubmitting after "needs changes" makes a new version; earlier versions are kept.
 */
export async function submitWork(ctx: Ctx, input: { enrolmentId: string; stepId: string; title?: string; note?: string; selfCheck?: Record<string, string> }, deps: SubmissionDeps = {}): Promise<SubmitResult> {
  const context = await loadForWrite(ctx, input.enrolmentId, input.stepId);
  if (context.step.type !== "submit") throw new AppError("invalid_input", "On this step each thing you add is sent straight away, so there is nothing more to hand in.");
  const learnerId = context.enrolment.learnerId;

  const title = (input.title ?? "").trim().replace(/\s+/g, " ") || context.enrolment.courseTitle;
  const note = (input.note ?? "").trim();
  if (Array.from(title).length > MAX_TITLE_LENGTH) throw new AppError("invalid_input", `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`, { fieldErrors: { title: [`Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`] } });
  if (Array.from(note).length > MAX_NOTE_LENGTH) throw new AppError("invalid_input", `Keep your note to ${MAX_NOTE_LENGTH} characters or fewer.`, { fieldErrors: { note: [`Keep your note to ${MAX_NOTE_LENGTH} characters or fewer.`] } });
  const selfCheck = await validSelfCheck(ctx.db, context.enrolment.courseVersionId, input.selfCheck ?? {}, context.requireSelfCheck);

  // The learner's own words: only the course title is ours, so only a changed title is checked.
  const text = await checkText(ctx, learnerId, input.stepId, [title === context.enrolment.courseTitle ? "" : title, note]);
  const [autoAccept, sampleRate, tools] = await Promise.all([getSetting(ctx, "moderation.auto_accept_clean_submissions"), getSetting(ctx, "moderation.sample_rate"), linkToolsFor(ctx, context.enrolment.courseVersionId)]);
  const dice = roll(deps);
  const system = asSystem(ctx, "submission.auto_checks");

  const result = await ctx.db.transaction(async (tx) => {
    // One submission at a time per enrolment: the project row is the lock.
    await tx.insert(project).values({ learnerId, enrolmentId: input.enrolmentId, courseId: context.enrolment.courseId, title, status: "in_progress", createdAt: ctx.now, updatedAt: ctx.now }).onConflictDoNothing({ target: project.enrolmentId });
    const [mine] = await tx.select().from(project).where(eq(project.enrolmentId, input.enrolmentId)).for("update");
    if (!mine) throw new AppError("internal", "We couldn't save your project. Nothing was lost. Try again in a moment.");
    if (mine.status === "awaiting_review") throw new AppError("conflict", "Your project is already being checked. We'll tell you as soon as it's done.");
    if (mine.status === "accepted") throw new AppError("conflict", "Your project has already been accepted. It's in your portfolio.");

    const draft = (await stepArtefacts(tx, input.enrolmentId, input.stepId)).filter((row) => row.moderationState === "pending");
    if (draft.length === 0) throw new AppError("invalid_input", "Add your evidence first: a link or one of the uploads this step asks for.");
    if (draft.some((row) => !context.allowedKinds.includes(row.kind))) throw new AppError("invalid_input", "Something in your evidence isn't a kind this step takes. Remove it and try again.");

    const items: CheckedItem[] = draft.map((row) => ({ kind: row.kind, peopleCheck: row.peopleCheck, onRegister: row.kind === "link" && row.url ? matchLinkToTool(row.url, tools) !== null : undefined }));
    const outcome = decideSubmission({ autoAccept, sampleRate, roll: dice, items, textSeverity: text.severity });
    const accepted = outcome.decision === "accept";

    const [latest] = await tx.select({ version: projectVersion.version }).from(projectVersion).where(eq(projectVersion.projectId, mine.id)).orderBy(desc(projectVersion.version)).limit(1);
    const [version] = await tx
      .insert(projectVersion)
      .values({
        projectId: mine.id,
        learnerId,
        version: (latest?.version ?? 0) + 1,
        stepId: input.stepId,
        note: note || null,
        selfCheck,
        moderationState: accepted ? "approved" : "pending",
        sampled: outcome.sampled,
        autoChecks: { outcome: outcome.decision, reasons: outcome.reasons, text: text.action, items: items.map((item) => ({ kind: item.kind, people: item.peopleCheck, ...(item.kind === "link" ? { onRegister: item.onRegister === true } : {}) })), autoAccept, sampleRate },
        submittedAt: ctx.now,
        decidedAt: accepted ? ctx.now : null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (!version) throw new AppError("internal", "We couldn't save your project. Nothing was lost. Try again in a moment.");

    await tx.update(artefact).set({ projectId: mine.id, projectVersionId: version.id, moderationState: accepted ? "approved" : "pending", updatedAt: ctx.now }).where(inArray(artefact.id, draft.map((row) => row.id)));
    // Rejected leftovers from the draft stay on record but leave the step's view.
    await tx.update(artefact).set({ stepId: null, updatedAt: ctx.now }).where(and(eq(artefact.enrolmentId, input.enrolmentId), eq(artefact.stepId, input.stepId), isNull(artefact.projectVersionId), eq(artefact.moderationState, "blocked")));
    await tx.update(project).set({ title, status: accepted ? "accepted" : "awaiting_review", currentVersionId: version.id, acceptedAt: accepted ? ctx.now : null, updatedAt: ctx.now }).where(eq(project.id, mine.id));

    await recordCheck(tx, { subjectType: "project_version", subjectId: version.id, learnerId, provider: "rules", verdict: text.severity ? "flagged" : "clean", categories: text.summary, severity: text.severity ?? undefined, now: ctx.now });
    await recordCheck(tx, { subjectType: "project_version", subjectId: version.id, learnerId, provider: "submission-checks", verdict: accepted ? "clean" : "flagged", categories: { reasons: outcome.reasons, sampled: outcome.sampled }, now: ctx.now });
    if (outcome.decision === "hold") {
      await enqueueModeration({ ...ctx, db: tx }, { subjectType: "submission", subjectId: version.id, learnerId, source: outcome.source, severity: outcome.severity, reason: holdSummary(outcome), flags: { reasons: outcome.reasons, sampled: outcome.sampled } });
    }

    // The step is done once work is sent in; the certificate waits for acceptance.
    await recordEvidenceOutcome({ ...ctx, db: tx }, { enrolmentId: input.enrolmentId, stepId: input.stepId, outcome: "submitted" });
    if (accepted) await recordEvidenceOutcome({ ...system, db: tx }, { enrolmentId: input.enrolmentId, stepId: input.stepId, outcome: "accepted" });
    return { projectId: mine.id, versionId: version.id, version: version.version, accepted };
  });

  if (text.severity && text.trigger) {
    await raiseSafeguarding(ctx, { learnerId, severity: text.severity, trigger: text.trigger, summary: "A project title or note raised a crisis signal. The submission is held for review.", sourceType: "project_version", sourceId: result.versionId, detail: [title, note].filter(Boolean).join("\n\n") }, { subjectType: "submission", subjectId: result.versionId });
  }
  const certificate = result.accepted ? await issueCertificateIfEligible(system, input.enrolmentId) : null;
  return { projectId: result.projectId, version: result.version, status: result.accepted ? "accepted" : "awaiting_review", certificateId: certificate?.id ?? null, showCrisisScript: text.severity !== null };
}

// ───────────────────────────── Decisions (called by moderation.ts) ─────────────────────────────

/** Deletes the stored files of these artefacts and records that it happened. Storage first, then the rows. */
async function deleteStoredFiles(db: Db, rows: readonly ArtefactRow[], now: Date): Promise<void> {
  const storage = getStorage("private");
  for (const row of rows) {
    if (row.storageKey === null || row.quarantined) continue;
    await storage.delete(row.storageKey);
    await db.update(artefact).set({ storageKey: null, deletedFromStorageAt: now, updatedAt: now }).where(eq(artefact.id, row.id));
  }
}

export type DecisionEffect = { learnerId: string; enrolmentId: string | null; projectId: string | null; accepted: boolean };

/**
 * Applies a person's decision to a submission. Run inside the moderation transaction (`ctx.db` is
 * the transaction; `ctx.actor` is the member of staff). `reject` needs the message the learner
 * will read. `escalate` keeps the work held and puts its files out of reach.
 */
export async function applySubmissionDecision(ctx: Ctx, versionId: string, verdict: "accept" | "reject" | "escalate", note: string | null): Promise<DecisionEffect> {
  const [version] = await ctx.db.select().from(projectVersion).where(eq(projectVersion.id, versionId)).for("update");
  if (!version) throw new AppError("not_found", "That submission could not be found. It may have been deleted.");
  if (version.moderationState !== "pending" && version.moderationState !== "escalated") throw new AppError("conflict", "That submission has already been decided.");
  const [mine] = await ctx.db.select().from(project).where(eq(project.id, version.projectId)).for("update");
  if (!mine) throw new AppError("not_found", "That submission could not be found. It may have been deleted.");
  const rows = await ctx.db.select().from(artefact).where(eq(artefact.projectVersionId, version.id));
  const decidedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  const current = mine.currentVersionId === version.id;
  const effect: DecisionEffect = { learnerId: version.learnerId, enrolmentId: mine.enrolmentId, projectId: mine.id, accepted: false };

  if (verdict === "escalate") {
    await ctx.db.update(projectVersion).set({ moderationState: "escalated", updatedAt: ctx.now }).where(eq(projectVersion.id, version.id));
    await ctx.db.update(artefact).set({ quarantined: true, moderationState: "escalated", updatedAt: ctx.now }).where(eq(artefact.projectVersionId, version.id));
    return effect;
  }

  if (verdict === "accept") {
    await ctx.db.update(projectVersion).set({ moderationState: "approved", decidedAt: ctx.now, decidedBy, decisionReason: note, updatedAt: ctx.now }).where(eq(projectVersion.id, version.id));
    await ctx.db.update(artefact).set({ moderationState: "approved", quarantined: false, updatedAt: ctx.now }).where(eq(artefact.projectVersionId, version.id));
    if (current) {
      await ctx.db.update(project).set({ status: "accepted", acceptedAt: ctx.now, updatedAt: ctx.now }).where(eq(project.id, mine.id));
      if (version.stepId) await recordEvidenceOutcome(ctx, { enrolmentId: mine.enrolmentId, stepId: version.stepId, outcome: "accepted" });
    }
    return { ...effect, accepted: current };
  }

  if (!note || note.trim().length === 0) throw new AppError("invalid_input", "Write a short, kind message telling the learner what to change. They will read it.", { fieldErrors: { note: ["Add the message the learner will see."] } });
  // Rejected work is not kept: the files go at once, the hashes and metadata stay.
  await deleteStoredFiles(ctx.db, rows, ctx.now);
  await ctx.db.update(artefact).set({ moderationState: "blocked", quarantined: false, updatedAt: ctx.now }).where(eq(artefact.projectVersionId, version.id));
  await ctx.db.update(projectVersion).set({ moderationState: "blocked", decidedAt: ctx.now, decidedBy, decisionReason: note.trim(), updatedAt: ctx.now }).where(eq(projectVersion.id, version.id));
  if (current) {
    await ctx.db.update(project).set({ status: "blocked", acceptedAt: null, updatedAt: ctx.now }).where(eq(project.id, mine.id));
    if (version.stepId) await recordEvidenceOutcome(ctx, { enrolmentId: mine.enrolmentId, stepId: version.stepId, outcome: "rejected" });
  }
  return effect;
}

/** The same for one piece of evidence on a mid-course `upload` step. */
export async function applyArtefactDecision(ctx: Ctx, artefactId: string, verdict: "accept" | "reject" | "escalate", note: string | null): Promise<DecisionEffect> {
  const [row] = await ctx.db.select().from(artefact).where(eq(artefact.id, artefactId)).for("update");
  if (!row) throw new AppError("not_found", "That upload could not be found. It may have been deleted.");
  if (row.projectVersionId !== null) throw new AppError("conflict", "That file is part of a submission. Decide the submission instead.");
  if (row.moderationState !== "pending" && !(row.moderationState === "escalated" && verdict !== "escalate")) throw new AppError("conflict", "That upload has already been decided.");
  const effect: DecisionEffect = { learnerId: row.learnerId, enrolmentId: row.enrolmentId, projectId: null, accepted: false };

  if (verdict === "escalate") {
    await ctx.db.update(artefact).set({ quarantined: true, moderationState: "escalated", updatedAt: ctx.now }).where(eq(artefact.id, row.id));
  } else if (verdict === "accept") {
    await ctx.db.update(artefact).set({ moderationState: "approved", quarantined: false, updatedAt: ctx.now }).where(eq(artefact.id, row.id));
  } else {
    if (!note || note.trim().length === 0) throw new AppError("invalid_input", "Write a short, kind message telling the learner what to send instead. They will read it.", { fieldErrors: { note: ["Add the message the learner will see."] } });
    await deleteStoredFiles(ctx.db, [row], ctx.now);
    await ctx.db.update(artefact).set({ moderationState: "blocked", quarantined: false, rejectedReason: note.trim(), updatedAt: ctx.now }).where(eq(artefact.id, row.id));
  }
  if (row.stepId) await syncUploadStep(ctx, row.enrolmentId, row.stepId);
  return { ...effect, accepted: verdict === "accept" };
}

/** Tells the learner, in our words, that a person has decided. The reviewer's message is on the project page, not in the notice. */
export async function notifyDecision(ctx: Ctx, effect: DecisionEffect, verdict: "accept" | "reject"): Promise<void> {
  const href = effect.projectId ? `/portfolio/${effect.projectId}` : "/home";
  const copy =
    verdict === "accept"
      ? { type: "submission.accepted", title: "Your work has been accepted", body: effect.projectId ? "Your project has been checked and it's now in your portfolio." : "Your upload has been checked and accepted. You can carry on." }
      : { type: "submission.needs_changes", title: "Your work needs a change", body: "Someone on our team has had a look and left you a note about what to change. Nothing is wrong with you or your account." };
  await notify(ctx, { userId: effect.learnerId, ...copy, href, channels: ["in_app"] });
}

// ───────────────────────────── Housekeeping ─────────────────────────────

/** Removes upload links that were handed out and never completed, with anything that reached storage. Idempotent. */
export async function cleanUpAbandonedUploads(ctx: Pick<Ctx, "db" | "now">): Promise<{ removed: number }> {
  const cutoff = new Date(ctx.now.getTime() - ABANDONED_UPLOAD_HOURS * 60 * 60 * 1000);
  const rows = await ctx.db
    .select({ id: artefact.id, storageKey: artefact.storageKey })
    .from(artefact)
    .where(and(sql`${artefact.kind} <> 'link'`, isNull(artefact.sha256), isNull(artefact.projectVersionId), isNull(artefact.deletedFromStorageAt), isNotNull(artefact.storageKey), eq(artefact.moderationState, "pending"), eq(artefact.quarantined, false), lt(artefact.createdAt, cutoff)))
    .limit(500);
  const storage = getStorage("private");
  for (const row of rows) {
    if (row.storageKey) await storage.delete(row.storageKey);
    await ctx.db.delete(artefact).where(eq(artefact.id, row.id));
  }
  return { removed: rows.length };
}

export type { VersionRow };
