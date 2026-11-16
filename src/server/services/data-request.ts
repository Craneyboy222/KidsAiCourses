import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { env } from "@/env";
import { formatDate } from "@/lib/dates";
import { revokeAllSessions } from "@/server/auth/accounts";
import { newLearnerPlaceholderEmail, userEmail } from "@/server/auth/learner-email";
import { audit } from "@/server/audit";
import { assertCan, type LearnerActor, type ParentActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { decrypt } from "@/server/crypto";
import {
  account,
  aiMessage,
  aiRequest,
  artefact,
  certificate,
  consentRecord,
  course,
  creditBalance,
  creditLedger,
  dataRequest,
  enrolment,
  family,
  familyMember,
  inviteCode,
  learnerProfile,
  moderationEvent,
  moderationItem,
  notification,
  parentControl,
  parentLinkRequest,
  project,
  projectVersion,
  quiz,
  quizAttempt,
  rateLimitBucket,
  reflection,
  report,
  retentionPolicy,
  safeguardingCase,
  session,
  step,
  stepProgress,
  subscription,
  tool,
  toolApproval,
  tutorConversation,
  twoFactor,
  unlockRequest,
  usageDay,
  user,
  wishlist,
  withAppendOnlyMaintenance,
  type Db,
} from "@/server/db";
import { registerEmailTemplate, sendEmail } from "@/server/email";
import { AppError } from "@/server/errors";
import { enqueue } from "@/server/jobs";
import { logError, logWarn } from "@/server/log";
import { notify } from "@/server/notifications";
import { getStorage } from "@/server/storage";
import { cancelFamilySubscriptions } from "./billing";
import { DELETION_UNDO_DAYS, removeChild } from "./children";
import { CONSENT_HOLD, missingRequiredConsents } from "./consent";
import { buildZip, type ZipEntry } from "./data-export-zip";
import { getLearnerSummary, isIndependentLearner, listChildren, listParentUserIds, type LearnerSummary } from "./family";
import { revokeInviteCodes } from "./invite";
import { PARENT_PAUSE_REASON } from "./parent-controls";

/**
 * Data download and deletion (spec 3.6, Section 4 "Data deletion", Section 9).
 *
 * Download: a parent asks for one child's data, or an 18-year-old asks for their own. A job
 * builds a ZIP in private storage. The link we email is only a link to our own page: the file is
 * handed over to a signed-in member of the same family (or the learner themselves), for 7 days.
 *
 * Delete: a request starts a 14-day window in which it can be undone. Nothing is deleted until
 * the window ends; then the `data.delete_due` job removes the rows and the files.
 *
 * What is kept, and why (spec Section 9):
 *  - consent records: append-only evidence of who agreed to what. They hold ids, not names.
 *  - safeguarding records: cases, flagged Coach conversations and quarantined files stay under the
 *    safeguarding schedule. A learner with any of these is anonymised rather than removed, so the
 *    records keep an owner the DSL can work with, but no name, username or sign-in.
 *  - payment records: kept for six years (parent data only). A family that has ever had a paid
 *    plan keeps its `family` and `subscription` rows; the owner's account is anonymised.
 *  - the audit log: two years.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a finished export can be downloaded (spec 3.6). */
export const EXPORT_LINK_DAYS = 7;
/** How long the signed storage link behind a download works. The 7 days above are enforced by us, on every click. */
export const EXPORT_SIGNED_LINK_SECONDS = 120;
/** Stored files beyond this total are listed in the export but not copied into it. */
export const MAX_EXPORT_FILE_BYTES = 250 * 1024 * 1024;
export const EXPORT_EVENT = "data/export.requested";

/**
 * Whether an export a PARENT asks for contains the child's private writing: Coach messages, notes
 * on steps, reflections and ethics answers, quiz answers and the note sent with a submission.
 *
 * Off. Teenagers are told, on their own settings page, that a parent cannot read these
 * (`parent_view.hidden.*`), and spec 3.6 shows parents counts and topics only. So a parent's
 * export carries the counts and dates, and says plainly what was left out and how to ask for it.
 * An 18-year-old's own export always includes them. See docs/OPEN_QUESTIONS.md. ⚖️
 */
export const PARENT_EXPORT_INCLUDES_PRIVATE_TEXT = false;

/** The statement shown before a deletion and repeated in the emails. One wording, everywhere. */
export const DELETION_STATEMENT = {
  deleted: [
    "The profile: nickname, username, birth month and year, interests and settings.",
    "All progress: courses started, steps, quiz attempts, notes and reflections.",
    "Every project, with the files and links that were sent in, and every certificate.",
    "Coach chats still held, and the record of how Coach was used.",
    "The limits you set, and the requests they sent you.",
  ],
  kept: [
    "The record of the permissions you gave or withdrew. It holds an account number, not a name, and is our evidence that consent was given.",
    "Safeguarding records, if there are any. These are kept under our safeguarding policy, can be seen only by our safeguarding lead, and are deleted on their own schedule.",
    "Payment records, which the law requires us to keep for six years. These are about the adult who paid, never the child.",
    "Our security log of changes to the account, for two years.",
  ],
} as const;

const KEPT_LINES = DELETION_STATEMENT.kept.map((line) => `- ${line}`).join("\n");

registerEmailTemplate("data_delete_scheduled", {
  audience: "parent",
  category: "transactional",
  description: "Confirms a deletion request, the date it takes effect, what is deleted and what is kept.",
  subject: "Deletion is scheduled for {{deleteOn}}",
  body: `
We have received the request to delete {{accountLabel}}.

Everything will be permanently deleted on **{{deleteOn}}**. Until then nothing has been removed, and you can change your mind.

[Undo the deletion]({{url}})

After that date it can't be undone.

What we keep, and why:

${KEPT_LINES}
`,
});

registerEmailTemplate("data_delete_cancelled", {
  audience: "parent",
  category: "transactional",
  description: "Confirms that a deletion request was undone.",
  subject: "The deletion has been cancelled",
  body: `
The request to delete {{accountLabel}} has been cancelled. Nothing was removed.

[Go to my privacy page]({{url}})

If you didn't cancel it, sign in and check your account, then reply to this email.
`,
});

registerEmailTemplate("data_delete_completed", {
  audience: "parent",
  category: "transactional",
  description: "Confirms that a deletion has been carried out, and what was kept.",
  subject: "The deletion is complete",
  body: `
As requested, we have permanently deleted {{accountLabel}} from {{brandName}}.

What we have kept, and why:

${KEPT_LINES}

If you think this was a mistake, reply to this email as soon as you can.
`,
});

// ── Who is asking ───────────────────────────────────────────────────────────

type Requester = { kind: "parent"; actor: ParentActor } | { kind: "adult"; actor: LearnerActor };

const NOT_FOR_UNDER_18 = "Your parent or carer looks after your data until you're 18. Ask them if you'd like a copy of it, or want something removed.";

/**
 * Parents act for their family; a learner acts only for themselves, and only at 18 (spec 3.6 and
 * the brief: "A learner aged 18 can do both for themselves"). Staff and jobs do not come this way.
 */
function requesterOf(ctx: Ctx): Requester {
  const { actor } = ctx;
  if (actor.type === "parent") return { kind: "parent", actor };
  if (actor.type === "learner") {
    if (actor.safetyBand !== "adult_18") throw new AppError("forbidden", NOT_FOR_UNDER_18);
    return { kind: "adult", actor };
  }
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  throw new AppError("forbidden", "You don't have permission to do that.");
}

const CHILD_NOT_FOUND = "That child could not be found in your family.";
const REQUEST_NOT_FOUND = "That request could not be found. It may have run out.";

/** A child of the signed-in parent's own family, or "not found". The family comes from the session, never the URL. */
async function childOfParent(ctx: Ctx, parent: ParentActor, learnerId: string): Promise<LearnerSummary> {
  if (!UUID.test(learnerId)) throw new AppError("not_found", CHILD_NOT_FOUND);
  let learner: LearnerSummary;
  try {
    learner = await getLearnerSummary(ctx, learnerId);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") throw new AppError("not_found", CHILD_NOT_FOUND);
    throw error;
  }
  if (learner.familyId !== parent.familyId) throw new AppError("not_found", CHILD_NOT_FOUND);
  return learner;
}

type RequestRow = typeof dataRequest.$inferSelect;

/** Loads a request and checks it belongs to the person asking. Anything else is "not found". */
async function ownRequest(ctx: Ctx, requestId: string, db: Db = ctx.db, lock = false): Promise<{ row: RequestRow; who: Requester }> {
  const who = requesterOf(ctx);
  if (!UUID.test(requestId)) throw new AppError("not_found", REQUEST_NOT_FOUND);
  const query = db.select().from(dataRequest).where(eq(dataRequest.id, requestId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new AppError("not_found", REQUEST_NOT_FOUND);
  const mine = who.kind === "parent" ? row.familyId !== null && row.familyId === who.actor.familyId : row.learnerId !== null && row.learnerId === who.actor.userId;
  if (!mine) throw new AppError("not_found", REQUEST_NOT_FOUND);
  return { row, who };
}

// ── What the privacy pages show ─────────────────────────────────────────────

export type DataRequestView = {
  id: string;
  kind: "export" | "delete";
  status: RequestRow["status"];
  /** `family` for a whole-family deletion; otherwise the request is about one learner. */
  scope: "learner" | "family";
  learnerId: string | null;
  /** The learner's nickname while the account still exists. */
  learnerNickname: string | null;
  requestedAt: Date;
  /** Delete: the moment the undo window ends. */
  undoUntil: Date | null;
  canUndo: boolean;
  /** Export: ready and not yet run out. */
  downloadReady: boolean;
  exportExpiresAt: Date | null;
  processedAt: Date | null;
};

function toView(row: RequestRow, nicknames: Map<string, string>, now: Date): DataRequestView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    scope: row.kind === "delete" && row.learnerId === null && row.status !== "completed" ? "family" : row.learnerId === null && row.kind === "delete" && row.requestedBy === null ? "family" : "learner",
    learnerId: row.learnerId,
    learnerNickname: row.learnerId ? (nicknames.get(row.learnerId) ?? null) : null,
    requestedAt: row.createdAt,
    undoUntil: row.undoUntil,
    canUndo: row.kind === "delete" && row.status === "requested" && row.undoUntil !== null && row.undoUntil > now,
    downloadReady: row.kind === "export" && row.status === "ready" && row.exportStorageKey !== null && row.exportExpiresAt !== null && row.exportExpiresAt > now,
    exportExpiresAt: row.exportExpiresAt,
    processedAt: row.processedAt,
  };
}

async function nicknamesFor(ctx: Pick<Ctx, "db">, learnerIds: string[]): Promise<Map<string, string>> {
  if (learnerIds.length === 0) return new Map();
  const rows = await ctx.db.select({ userId: learnerProfile.userId, nickname: learnerProfile.nickname }).from(learnerProfile).where(inArray(learnerProfile.userId, learnerIds));
  return new Map(rows.map((row) => [row.userId, row.nickname]));
}

/** The signed-in person's requests, newest first: a parent's whole family, or an adult learner's own. */
export async function listDataRequests(ctx: Ctx, options: { limit?: number } = {}): Promise<DataRequestView[]> {
  const who = requesterOf(ctx);
  if (who.kind === "parent") assertCan(who.actor, "family.read", { familyId: who.actor.familyId });
  const rows = await ctx.db
    .select()
    .from(dataRequest)
    .where(who.kind === "parent" ? eq(dataRequest.familyId, who.actor.familyId) : eq(dataRequest.learnerId, who.actor.userId))
    .orderBy(desc(dataRequest.createdAt))
    .limit(Math.min(Math.max(options.limit ?? 30, 1), 100));
  const nicknames = await nicknamesFor(ctx, [...new Set(rows.flatMap((row) => (row.learnerId ? [row.learnerId] : [])))]);
  return rows.map((row) => toView(row, nicknames, ctx.now));
}

export type RetentionLine = { key: string; what: string; why: string; keptFor: string };

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
function period(days: number): string {
  if (days % 365 === 0) return plural(days / 365, "year");
  if (days >= 365 && Math.abs(days / 30.4 - Math.round(days / 30.4)) < 0.2) return plural(Math.round(days / 30.4), "month");
  return plural(days, "day");
}

/** Spec Section 9 defaults, in plain English. `retention_policy` rows with the same key override the number of days. */
const RETENTION_DEFAULTS: { key: string; days: number; what: string; why: string; keptFor: (period: string) => string }[] = [
  { key: "account_inactive", days: 730, what: "The account, profile and progress", why: "So your child can sign in, carry on where they left off and keep what they've made.", keptFor: (p) => `For as long as the account is open. If nobody uses it for ${p}, we warn you 30 days ahead and then delete it.` },
  { key: "artefacts", days: 0, what: "Projects, and the files and links sent in with them", why: "To show the portfolio and to issue certificates.", keptFor: () => "For as long as the account is open. Work that fails our checks is deleted straight away." },
  { key: "tutor_conversation_default", days: 30, what: "Coach chats", why: "So a chat can carry on during a session, and so we can check Coach is behaving safely.", keptFor: (p) => `${p} after the session, then the words are deleted and only counts and topics remain.` },
  { key: "tutor_conversation_extended", days: 90, what: "Coach chats, if you switched on chat history", why: "So your child can pick a chat back up later. This is your choice in Permissions.", keptFor: (p) => `${p}.` },
  { key: "ai_metadata", days: 395, what: "The record of how Coach was used (dates and amounts, never the words)", why: "To count monthly Coach messages and keep costs under control.", keptFor: (p) => `${p}, then only totals that identify nobody.` },
  { key: "flagged_content", days: 365, what: "Anything our safety checks flagged", why: "So a person can review it and we can act on it properly.", keptFor: (p) => `${p} after it is dealt with.` },
  { key: "safeguarding_case", days: 0, what: "Safeguarding records", why: "We have a duty to keep a proper record when a child may be at risk.", keptFor: () => "As set by our safeguarding policy. Only our safeguarding lead can read them." },
  { key: "consent_record", days: 0, what: "The permissions you gave or withdrew", why: "It is our evidence that a parent or carer agreed.", keptFor: () => "Kept after the account closes. It holds an account number, not a name." },
  { key: "billing_records", days: 2190, what: "Payment records (about you, never your child)", why: "Tax and accounting law.", keptFor: (p) => `${p}.` },
  { key: "audit_log", days: 730, what: "Our security log of changes to the account", why: "To investigate problems and show who changed what.", keptFor: (p) => `${p}.` },
  { key: "pending_teen", days: 7, what: "A sign-up a teenager started that no parent approved", why: "To give a parent time to answer.", keptFor: (p) => `${p}, then everything about it is deleted.` },
];

/** "What we hold and why", with the periods as they are configured today. */
export async function getRetentionSummary(ctx: Pick<Ctx, "db">): Promise<RetentionLine[]> {
  const rows = await ctx.db.select({ key: retentionPolicy.key, days: retentionPolicy.days }).from(retentionPolicy);
  const configured = new Map(rows.map((row) => [row.key, row.days]));
  return RETENTION_DEFAULTS.map((line) => {
    const days = configured.get(line.key);
    return { key: line.key, what: line.what, why: line.why, keptFor: line.keptFor(period(days !== undefined && days > 0 ? days : line.days)) };
  });
}

// ── Download ────────────────────────────────────────────────────────────────

const exportKey = (requestId: string) => `exports/${requestId}/your-data.zip`;

async function emailOf(ctx: Pick<Ctx, "db">, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await ctx.db.select({ email: user.email, status: user.status }).from(user).where(eq(user.id, userId)).limit(1);
  return row && row.status !== "deleted" ? userEmail(row) : null;
}

/** Sends one of our emails if the person has an address. Never fails the caller: the page shows the same facts. */
async function emailRequester(ctx: Pick<Ctx, "db" | "now">, userId: string | null, template: string, data: Record<string, string>): Promise<boolean> {
  try {
    const to = await emailOf(ctx, userId);
    if (!to || !userId) return false;
    await sendEmail(ctx, { to, userId, template, data });
    return true;
  } catch (error) {
    logWarn("data_request.email_failed", { template, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const appUrl = () => env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const privacyPath = (who: "parent" | "adult") => (who === "parent" ? "/parent/privacy" : "/settings/privacy");

/**
 * Asks for a copy of one learner's data. A parent names a child in their family; an 18-year-old
 * can only ask for their own. Asking again while one is being prepared returns the same request.
 */
export async function requestExport(ctx: Ctx, input: { learnerId?: string } = {}): Promise<DataRequestView> {
  const who = requesterOf(ctx);
  let learner: LearnerSummary;
  if (who.kind === "parent") {
    learner = await childOfParent(ctx, who.actor, input.learnerId ?? "");
    assertCan(who.actor, "family.data.export", { familyId: learner.familyId });
    if (await isIndependentLearner(ctx, learner.learnerId)) {
      throw new AppError("forbidden", `${learner.nickname} is 18 and runs their own account now. They can download their own data from their settings.`);
    }
  } else {
    if (input.learnerId !== undefined && input.learnerId !== who.actor.userId) throw new AppError("not_found", REQUEST_NOT_FOUND);
    assertCan(who.actor, "family.data.export", { learnerId: who.actor.userId });
    learner = await getLearnerSummary(ctx, who.actor.userId);
  }

  const { row, created } = await ctx.db.transaction(async (tx) => {
    // One at a time per learner: lock their row so two clicks cannot start two exports.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, learner.learnerId)).for("update");
    const [open] = await tx
      .select()
      .from(dataRequest)
      .where(and(eq(dataRequest.learnerId, learner.learnerId), eq(dataRequest.kind, "export"), eq(dataRequest.requestedBy, who.actor.userId), inArray(dataRequest.status, ["requested", "processing"])))
      .limit(1);
    if (open) return { row: open, created: false };
    const [inserted] = await tx
      .insert(dataRequest)
      .values({ kind: "export", status: "requested", familyId: learner.familyId, learnerId: learner.learnerId, requestedBy: who.actor.userId, createdAt: ctx.now, updatedAt: ctx.now })
      .returning();
    if (!inserted) throw new AppError("internal", "We couldn't start that. Nothing was lost. Try again in a moment.");
    await audit(ctx, { action: "data.export.request", targetType: "user", targetId: learner.learnerId, meta: { requestId: inserted.id, familyId: learner.familyId, by: who.kind } }, tx);
    return { row: inserted, created: true };
  });

  if (created) await enqueue(EXPORT_EVENT, { requestId: row.id }, { idempotencyKey: `data-export:${row.id}` });
  return toView(row, new Map([[learner.learnerId, learner.nickname]]), ctx.now);
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

const FILE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "application/zip": "zip",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export type ExportOptions = {
  /** Coach messages, notes, reflections, quiz answers and submission notes. The learner's own export only. */
  privateText: boolean;
  /** Work that has not been accepted. The learner's own export only: parents see accepted work. */
  unacceptedWork: boolean;
};

export type BuiltExport = { zip: Buffer; fileNames: string[]; filesIncluded: number; filesLeftOut: number };

/**
 * Gathers everything for one learner and packs it. Every query is by this learner's id and
 * nothing else, so another child's rows cannot arrive by a join. Records held under the
 * safeguarding policy (flagged conversations, quarantined files, cases, reports) are never
 * included, whoever asks; the README says so in the same words every time, so its presence tells
 * nobody anything.
 */
export async function buildExportArchive(ctx: Pick<Ctx, "db" | "now">, learnerId: string, options: ExportOptions): Promise<BuiltExport> {
  const { db } = ctx;
  const [person] = await db
    .select({
      username: user.username,
      status: user.status,
      createdAt: user.createdAt,
      nickname: learnerProfile.nickname,
      firstName: learnerProfile.firstName,
      birthMonth: learnerProfile.birthMonth,
      birthYear: learnerProfile.birthYear,
      safetyBand: learnerProfile.safetyBand,
      pathway: learnerProfile.pathway,
      interests: learnerProfile.interests,
      a11y: learnerProfile.a11y,
      certificateNameChoice: learnerProfile.certificateNameChoice,
      onboardingCompletedAt: learnerProfile.onboardingCompletedAt,
    })
    .from(user)
    .innerJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .where(and(eq(user.id, learnerId), eq(user.kind, "learner")))
    .limit(1);
  if (!person) throw new AppError("not_found", "That learner could not be found. They may have been removed.");

  const [controls, enrolments, steps, attempts, reflections, usage, projects, versions, artefacts, certificates, consents, conversations, requests, balances, approvals, unlocks, saved] = await Promise.all([
    db.select().from(parentControl).where(eq(parentControl.learnerId, learnerId)).limit(1),
    db
      .select({ id: enrolment.id, courseTitle: course.title, courseSlug: course.slug, status: enrolment.status, startedAt: enrolment.startedAt, completedAt: enrolment.completedAt, lastActivityAt: enrolment.lastActivityAt })
      .from(enrolment)
      .innerJoin(course, eq(course.id, enrolment.courseId))
      .where(eq(enrolment.learnerId, learnerId))
      .orderBy(asc(enrolment.startedAt)),
    db
      .select({ enrolmentId: stepProgress.enrolmentId, stepKey: step.key, stepTitle: step.title, stepType: step.type, status: stepProgress.status, completedAt: stepProgress.completedAt, skippedAt: stepProgress.skippedAt, notes: stepProgress.notes, data: stepProgress.data })
      .from(stepProgress)
      .innerJoin(step, eq(step.id, stepProgress.stepId))
      .where(eq(stepProgress.learnerId, learnerId))
      .orderBy(asc(stepProgress.createdAt)),
    db
      .select({ enrolmentId: quizAttempt.enrolmentId, quizTitle: quiz.title, attemptNumber: quizAttempt.attemptNumber, score: quizAttempt.score, passed: quizAttempt.passed, answers: quizAttempt.answers, createdAt: quizAttempt.createdAt })
      .from(quizAttempt)
      .innerJoin(quiz, eq(quiz.id, quizAttempt.quizId))
      .where(eq(quizAttempt.learnerId, learnerId))
      .orderBy(asc(quizAttempt.createdAt)),
    db
      .select({ enrolmentId: reflection.enrolmentId, stepTitle: step.title, body: reflection.body, createdAt: reflection.createdAt, updatedAt: reflection.updatedAt })
      .from(reflection)
      .innerJoin(step, eq(step.id, reflection.stepId))
      .where(eq(reflection.learnerId, learnerId))
      .orderBy(asc(reflection.createdAt)),
    db.select({ day: usageDay.day, seconds: usageDay.seconds }).from(usageDay).where(eq(usageDay.learnerId, learnerId)).orderBy(asc(usageDay.day)),
    db
      .select({ id: project.id, title: project.title, courseTitle: course.title, status: project.status, acceptedAt: project.acceptedAt, createdAt: project.createdAt })
      .from(project)
      .innerJoin(course, eq(course.id, project.courseId))
      .where(eq(project.learnerId, learnerId))
      .orderBy(asc(project.createdAt)),
    db.select().from(projectVersion).where(eq(projectVersion.learnerId, learnerId)).orderBy(asc(projectVersion.submittedAt)),
    db.select().from(artefact).where(eq(artefact.learnerId, learnerId)).orderBy(asc(artefact.createdAt)),
    db.select({ courseTitle: certificate.courseTitle, displayName: certificate.displayName, verifyCode: certificate.verifyCode, issuedAt: certificate.issuedAt, revokedAt: certificate.revokedAt }).from(certificate).where(eq(certificate.learnerId, learnerId)).orderBy(asc(certificate.issuedAt)),
    db.select({ key: consentRecord.consentKey, version: consentRecord.consentVersion, action: consentRecord.action, method: consentRecord.method, createdAt: consentRecord.createdAt }).from(consentRecord).where(eq(consentRecord.learnerId, learnerId)).orderBy(asc(consentRecord.createdAt)),
    db.select().from(tutorConversation).where(eq(tutorConversation.learnerId, learnerId)).orderBy(asc(tutorConversation.createdAt)),
    db.select({ createdAt: aiRequest.createdAt, creditsCharged: aiRequest.creditsCharged }).from(aiRequest).where(and(eq(aiRequest.userId, learnerId), eq(aiRequest.feature, "tutor"), eq(aiRequest.isPreview, false))).orderBy(asc(aiRequest.createdAt)),
    db.select({ periodKey: creditBalance.periodKey, periodStart: creditBalance.periodStart, periodEnd: creditBalance.periodEnd, granted: creditBalance.granted, spent: creditBalance.spent }).from(creditBalance).where(eq(creditBalance.learnerId, learnerId)).orderBy(asc(creditBalance.periodStart)),
    db
      .select({ toolName: tool.name, courseTitle: course.title, status: toolApproval.status, requestedAt: toolApproval.requestedAt, decidedAt: toolApproval.decidedAt })
      .from(toolApproval)
      .innerJoin(tool, eq(tool.id, toolApproval.toolId))
      .innerJoin(course, eq(course.id, toolApproval.courseId))
      .where(eq(toolApproval.learnerId, learnerId)),
    db.select({ courseTitle: course.title, kind: unlockRequest.kind, status: unlockRequest.status, createdAt: unlockRequest.createdAt, decidedAt: unlockRequest.decidedAt }).from(unlockRequest).innerJoin(course, eq(course.id, unlockRequest.courseId)).where(eq(unlockRequest.learnerId, learnerId)),
    db.select({ courseTitle: course.title, createdAt: wishlist.createdAt }).from(wishlist).innerJoin(course, eq(course.id, wishlist.courseId)).where(eq(wishlist.learnerId, learnerId)),
  ]);

  const visibleProject = (status: string) => options.unacceptedWork || status === "accepted";
  const projectIds = new Set(projects.filter((entry) => visibleProject(entry.status)).map((entry) => entry.id));
  const visibleVersions = versions.filter((entry) => projectIds.has(entry.projectId) && (options.unacceptedWork || entry.moderationState === "approved"));
  const versionIds = new Set(visibleVersions.map((entry) => entry.id));
  // Held files never leave; rejected ones are already gone from storage. A parent gets accepted work only.
  const visibleArtefacts = artefacts.filter((entry) => !entry.quarantined && entry.projectVersionId !== null && versionIds.has(entry.projectVersionId) && (options.unacceptedWork ? entry.moderationState !== "blocked" : entry.moderationState === "approved"));

  const entries: ZipEntry[] = [];
  const add = (name: string, value: unknown) => entries.push({ name, data: json(value) });

  add("profile.json", {
    nickname: person.nickname,
    firstName: person.firstName,
    username: person.username,
    birthMonth: person.birthMonth,
    birthYear: person.birthYear,
    ageGroup: person.safetyBand,
    pathway: person.pathway,
    interests: person.interests,
    accessibilityPreferences: person.a11y,
    nameOnCertificates: person.certificateNameChoice,
    accountStatus: person.status,
    accountCreatedAt: iso(person.createdAt),
    onboardingCompletedAt: iso(person.onboardingCompletedAt),
    limitsSetByParent: controls[0]
      ? {
          dailyMinutesCap: controls[0].dailyMinutesCap,
          quietStartMin: controls[0].quietStartMin,
          quietEndMin: controls[0].quietEndMin,
          blockedCategories: controls[0].blockedCategories,
          blockedCourseCount: controls[0].blockedCourseIds.length,
          requireApprovalForPro: controls[0].requireApprovalForPro,
          paused: controls[0].paused,
        }
      : null,
  });

  add("progress.json", {
    courses: enrolments.map((entry) => ({
      course: entry.courseTitle,
      slug: entry.courseSlug,
      status: entry.status,
      startedAt: iso(entry.startedAt),
      completedAt: iso(entry.completedAt),
      lastActivityAt: iso(entry.lastActivityAt),
      steps: steps
        .filter((row) => row.enrolmentId === entry.id)
        .map((row) => ({ step: row.stepTitle, key: row.stepKey, type: row.stepType, status: row.status, completedAt: iso(row.completedAt), skippedAt: iso(row.skippedAt), ...(options.privateText ? { notes: row.notes, saved: row.data } : { hasNotes: (row.notes ?? "").trim().length > 0 }) })),
      quizAttempts: attempts
        .filter((row) => row.enrolmentId === entry.id)
        .map((row) => ({ quiz: row.quizTitle, attempt: row.attemptNumber, score: row.score, passed: row.passed, at: iso(row.createdAt), ...(options.privateText ? { answers: row.answers } : {}) })),
      reflections: options.privateText
        ? reflections.filter((row) => row.enrolmentId === entry.id).map((row) => ({ step: row.stepTitle, text: row.body, writtenAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }))
        : { written: reflections.filter((row) => row.enrolmentId === entry.id).length },
    })),
    timeByDay: usage.map((row) => ({ date: row.day, minutes: Math.floor(row.seconds / 60) })),
    savedForLater: saved.map((row) => ({ course: row.courseTitle, savedAt: iso(row.createdAt) })),
  });

  const storage = getStorage("private");
  const fileNames: string[] = [];
  const leftOut: { file: string; reason: string }[] = [];
  let fileBytes = 0;
  const artefactFile = new Map<string, string>();
  for (const row of visibleArtefacts) {
    if (row.storageKey === null || row.deletedFromStorageAt !== null || row.storageKey.startsWith("quarantine/")) continue;
    const name = `files/${row.projectId ?? "project"}/${row.kind}-${row.id.slice(0, 8)}.${FILE_EXTENSIONS[row.mime ?? ""] ?? "bin"}`;
    const size = Number(row.sizeBytes ?? 0);
    if (fileBytes + size > MAX_EXPORT_FILE_BYTES) {
      leftOut.push({ file: name, reason: "This download would have been too large with it. You can open it from the portfolio instead." });
      continue;
    }
    try {
      const file = await storage.get(row.storageKey);
      if (!file) {
        leftOut.push({ file: name, reason: "We no longer hold this file." });
        continue;
      }
      if (fileBytes + file.size > MAX_EXPORT_FILE_BYTES) {
        leftOut.push({ file: name, reason: "This download would have been too large with it. You can open it from the portfolio instead." });
        continue;
      }
      fileBytes += file.size;
      // Pictures, video and audio are compressed already.
      entries.push({ name, data: file.body, store: /^(image|video|audio)\//.test(row.mime ?? "") });
      fileNames.push(name);
      artefactFile.set(row.id, name);
    } catch (error) {
      logWarn("data_export.file_unavailable", { artefactId: row.id, error: error instanceof Error ? error.message : String(error) });
      leftOut.push({ file: name, reason: "We couldn't read this file when the download was made. Ask for a new download to try again." });
    }
  }

  add("submissions.json", {
    projects: projects
      .filter((entry) => projectIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        course: entry.courseTitle,
        status: entry.status,
        createdAt: iso(entry.createdAt),
        acceptedAt: iso(entry.acceptedAt),
        versions: visibleVersions
          .filter((version) => version.projectId === entry.id)
          .map((version) => ({
            version: version.version,
            submittedAt: iso(version.submittedAt),
            state: version.moderationState,
            decidedAt: iso(version.decidedAt),
            ...(options.privateText ? { note: version.note, selfCheck: version.selfCheck, reviewerMessage: version.decisionReason } : {}),
            evidence: visibleArtefacts
              .filter((row) => row.projectVersionId === version.id)
              .map((row) => ({ kind: row.kind, link: row.url, file: artefactFile.get(row.id) ?? null, type: row.mime, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes), state: row.moderationState, addedAt: iso(row.createdAt) })),
          })),
      })),
    filesLeftOut: leftOut,
  });

  add("certificates.json", certificates.map((row) => ({ course: row.courseTitle, name: row.displayName, verifyCode: row.verifyCode, issuedAt: iso(row.issuedAt), revokedAt: iso(row.revokedAt) })));
  add("consent-history.json", consents.map((row) => ({ permission: row.key, wordingVersion: row.version, action: row.action, how: row.method, at: iso(row.createdAt) })));
  add("requests.json", {
    toolApprovals: approvals.map((row) => ({ tool: row.toolName, course: row.courseTitle, status: row.status, requestedAt: iso(row.requestedAt), decidedAt: iso(row.decidedAt) })),
    unlockRequests: unlocks.map((row) => ({ course: row.courseTitle, kind: row.kind, status: row.status, requestedAt: iso(row.createdAt), decidedAt: iso(row.decidedAt) })),
  });

  // Coach. Metadata for everyone; words only for the learner's own export, and never from a
  // conversation held under the safeguarding schedule.
  const held = (row: (typeof conversations)[number]) => row.flagged || row.safeguardingCaseId !== null;
  const messagesByConversation = new Map<string, { role: string; text: string; at: string | null }[]>();
  if (options.privateText) {
    const open = conversations.filter((row) => !held(row) && row.contentDeletedAt === null).map((row) => row.id);
    if (open.length > 0) {
      const rows = await db
        .select({ conversationId: aiMessage.conversationId, role: aiMessage.role, content: aiMessage.contentEncrypted, createdAt: aiMessage.createdAt })
        .from(aiMessage)
        .where(and(eq(aiMessage.learnerId, learnerId), inArray(aiMessage.conversationId, open), eq(aiMessage.flagged, false), sql`${aiMessage.expiresAt} > ${ctx.now.toISOString()}::timestamptz`))
        .orderBy(asc(aiMessage.createdAt));
      for (const row of rows) {
        let text: string;
        try {
          text = decrypt(row.content, "content");
        } catch {
          continue;
        }
        const list = messagesByConversation.get(row.conversationId) ?? [];
        list.push({ role: row.role, text, at: iso(row.createdAt) });
        messagesByConversation.set(row.conversationId, list);
      }
    }
  }
  add("coach.json", {
    conversations: conversations.map((row) => ({
      startedAt: iso(row.createdAt),
      lastMessageAt: iso(row.lastMessageAt),
      messageCount: row.messageCount,
      topics: row.topics,
      ...(options.privateText ? { messages: messagesByConversation.get(row.id) ?? [] } : {}),
    })),
    use: requests.map((row) => ({ at: iso(row.createdAt), creditsUsed: row.creditsCharged })),
    monthlyAllowance: balances.map((row) => ({ period: row.periodKey, from: iso(row.periodStart), to: iso(row.periodEnd), given: row.granted, used: row.spent })),
  });

  const readme = [
    `Your data from ${env.NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`,
    `Made on ${formatDate(ctx.now)} for the account "${person.nickname}".`,
    "",
    "What is in this download",
    "- profile.json: the profile, settings and any limits set by a parent or carer.",
    "- progress.json: courses, steps, quiz results and time spent each day.",
    "- submissions.json: projects and what was sent in. Files we hold are in the files folder.",
    "- certificates.json: certificates earned.",
    "- consent-history.json: every permission given or withdrawn, and when.",
    "- requests.json: requests to approve a tool or unlock a course.",
    "- coach.json: when Coach was used, how much, and the topics.",
    "",
    "What is not in it",
    ...(options.privateText
      ? []
      : [
          "- The words of Coach chats, private notes on steps, reflections, ethics answers and quiz answers.",
          "  We tell every learner that a parent or carer cannot read these, so that they can ask questions freely.",
          "  The counts and dates are included. To ask about the rest, contact us and we will go through it with you.",
          "- Work that has not been accepted yet.",
        ]),
    "- Coach chats past their keeping time: the words are deleted and only counts and topics remain.",
    "- Any record held under our safeguarding policy. Those are handled only by our safeguarding lead. Contact us to ask about them.",
    "- Projects built in other tools: we never hold those, only the links and files sent to us.",
    ...(leftOut.length > 0 ? ["", `${leftOut.length} file(s) could not be included. They are listed in submissions.json under "filesLeftOut".`] : []),
    "",
  ].join("\n");
  entries.unshift({ name: "README.txt", data: readme });

  return { zip: buildZip(entries, ctx.now), fileNames: entries.map((entry) => entry.name), filesIncluded: fileNames.length, filesLeftOut: leftOut.length };
}

export type ExportJobResult = { requestId: string; status: "ready" | "skipped" | "failed"; files?: number; bytes?: number };

/**
 * The `data.export` job: builds the ZIP, stores it privately and tells the person who asked.
 * Safe to run twice: a request that is already ready, cancelled or failed is left alone.
 */
export async function runExport(ctx: Ctx, requestId: string): Promise<ExportJobResult> {
  if (!UUID.test(requestId)) return { requestId, status: "skipped" };
  const [claimed] = await ctx.db
    .update(dataRequest)
    .set({ status: "processing", updatedAt: ctx.now })
    .where(and(eq(dataRequest.id, requestId), eq(dataRequest.kind, "export"), inArray(dataRequest.status, ["requested", "failed"])))
    .returning();
  if (!claimed) return { requestId, status: "skipped" };

  const fail = async (reason: string): Promise<ExportJobResult> => {
    await ctx.db.update(dataRequest).set({ status: "failed", error: reason, updatedAt: ctx.now }).where(eq(dataRequest.id, requestId));
    return { requestId, status: "failed" };
  };
  if (!claimed.learnerId || !claimed.requestedBy) return fail("The account no longer exists.");

  // Who asked decides what goes in: a learner's own export is complete, a parent's keeps the child's private writing out.
  const own = claimed.requestedBy === claimed.learnerId;
  const options: ExportOptions = { privateText: own || PARENT_EXPORT_INCLUDES_PRIVATE_TEXT, unacceptedWork: own };
  let built: BuiltExport;
  try {
    built = await buildExportArchive(ctx, claimed.learnerId, options);
  } catch (error) {
    logError("data_export.build_failed", error, { requestId });
    await fail("The download could not be put together.");
    throw error;
  }

  const key = exportKey(requestId);
  const expiresAt = new Date(ctx.now.getTime() + EXPORT_LINK_DAYS * DAY_MS);
  await getStorage("private").put(key, built.zip, { contentType: "application/zip" });
  await ctx.db.update(dataRequest).set({ status: "ready", exportStorageKey: key, exportExpiresAt: expiresAt, processedAt: ctx.now, error: null, updatedAt: ctx.now }).where(eq(dataRequest.id, requestId));
  await audit(ctx, { action: "data.export.ready", targetType: "user", targetId: claimed.learnerId, meta: { requestId, files: built.filesIncluded, filesLeftOut: built.filesLeftOut, bytes: built.zip.length, privateText: options.privateText } });

  const path = privacyPath(own ? "adult" : "parent");
  try {
    await notify(ctx, {
      userId: claimed.requestedBy,
      type: "data.export_ready",
      title: "Your data download is ready",
      body: `You can download it from your Privacy page until ${formatDate(expiresAt)}.`,
      href: path,
      // The email carries a link to our page, never to the file: the file is only handed to someone signed in.
      emailTemplate: "data_export_ready",
      emailData: { url: `${appUrl()}${path}`, expiresOn: formatDate(expiresAt) },
      dedupeKey: `data-export-ready:${requestId}`,
    });
  } catch (error) {
    logWarn("data_export.notify_failed", { requestId, error: error instanceof Error ? error.message : String(error) });
  }
  return { requestId, status: "ready", files: built.filesIncluded, bytes: built.zip.length };
}

/**
 * A short-lived link to a finished export, for the family that asked for it (or the learner
 * themselves) and nobody else. The seven days are checked here on every click.
 */
export async function getExportDownload(ctx: Ctx, requestId: string): Promise<{ url: string; expiresInSec: number }> {
  const { row, who } = await ownRequest(ctx, requestId);
  if (who.kind === "parent") assertCan(who.actor, "family.data.export", { familyId: row.familyId });
  else assertCan(who.actor, "family.data.export", { learnerId: row.learnerId });
  if (row.kind !== "export") throw new AppError("not_found", REQUEST_NOT_FOUND);
  // A parent may not collect a download an 18-year-old made of their own data, which includes their private writing.
  if (who.kind === "parent" && row.requestedBy !== null && row.requestedBy === row.learnerId) throw new AppError("not_found", REQUEST_NOT_FOUND);
  if (row.status === "requested" || row.status === "processing") throw new AppError("not_ready", "That download is still being put together. We'll email you when it's ready.");
  if (row.status !== "ready" || !row.exportStorageKey || !row.exportExpiresAt || row.exportExpiresAt <= ctx.now) {
    throw new AppError("not_found", "That download has run out. You can ask for a new one from your Privacy page.");
  }
  const storage = getStorage("private");
  if (!(await storage.exists(row.exportStorageKey))) throw new AppError("not_found", "That download has run out. You can ask for a new one from your Privacy page.");
  const url = await storage.signedDownloadUrl(row.exportStorageKey, { expiresInSec: EXPORT_SIGNED_LINK_SECONDS, downloadName: "your-data.zip", now: ctx.now });
  await audit(ctx, { action: "data.export.download", targetType: "data_request", targetId: row.id, meta: { learnerId: row.learnerId, familyId: row.familyId } });
  return { url, expiresInSec: EXPORT_SIGNED_LINK_SECONDS };
}

/** Removes export files whose seven days are up. Part of the `data.delete_due` job. */
export async function purgeExpiredExports(ctx: Pick<Ctx, "db" | "now">): Promise<{ exportsRemoved: number }> {
  const rows = await ctx.db
    .select({ id: dataRequest.id, key: dataRequest.exportStorageKey })
    .from(dataRequest)
    .where(and(eq(dataRequest.kind, "export"), eq(dataRequest.status, "ready"), isNotNull(dataRequest.exportStorageKey), lte(dataRequest.exportExpiresAt, ctx.now)))
    .limit(200);
  let exportsRemoved = 0;
  for (const row of rows) {
    if (row.key) await getStorage("private").delete(row.key);
    await ctx.db.update(dataRequest).set({ status: "completed", exportStorageKey: null, updatedAt: ctx.now }).where(eq(dataRequest.id, row.id));
    exportsRemoved += 1;
  }
  return { exportsRemoved };
}

// ── Delete: asking and undoing ──────────────────────────────────────────────

const undoDeadline = (now: Date) => new Date(now.getTime() + DELETION_UNDO_DAYS * DAY_MS);
const OPEN_DELETE = ["requested", "processing"] as const;

async function tellRequesterScheduled(ctx: Ctx, userId: string, who: "parent" | "adult", accountLabel: string, undoUntil: Date, requestId: string): Promise<void> {
  const path = privacyPath(who);
  try {
    await notify(ctx, {
      userId,
      type: "data.delete_scheduled",
      title: `Deletion is scheduled for ${formatDate(undoUntil)}`,
      body: `We'll delete ${accountLabel} on ${formatDate(undoUntil)}. Until then you can undo this from your Privacy page.`,
      href: path,
      channels: ["in_app"],
      dedupeKey: `data-delete-scheduled:${requestId}`,
    });
  } catch (error) {
    logWarn("data_request.notify_failed", { requestId, error: error instanceof Error ? error.message : String(error) });
  }
  await emailRequester(ctx, userId, "data_delete_scheduled", { accountLabel, deleteOn: formatDate(undoUntil), url: `${appUrl()}${path}` });
}

/**
 * A parent asks for one child's account to be deleted. The account closes now and is deleted
 * when the 14-day undo window ends. Uses the accounts slice's `removeChild`, which makes the
 * family check, closes the account and leaves the request; this adds the confirmation.
 */
export async function requestChildDeletion(ctx: Ctx, learnerId: string): Promise<DataRequestView> {
  const who = requesterOf(ctx);
  if (who.kind !== "parent") throw new AppError("forbidden", "That's for parent and carer accounts.");
  const learner = await childOfParent(ctx, who.actor, learnerId);
  assertCan(who.actor, "family.data.delete", { familyId: learner.familyId });
  const removed = await removeChild(ctx, learner.learnerId);
  const [row] = await ctx.db
    .select()
    .from(dataRequest)
    .where(and(eq(dataRequest.learnerId, learner.learnerId), eq(dataRequest.kind, "delete"), inArray(dataRequest.status, [...OPEN_DELETE])))
    .orderBy(desc(dataRequest.createdAt))
    .limit(1);
  if (!row) throw new AppError("internal", "We couldn't start that. Nothing was removed. Try again in a moment.");
  await tellRequesterScheduled(ctx, who.actor.userId, "parent", `${learner.nickname}'s account`, removed.undoUntil, row.id);
  return toView(row, new Map([[learner.learnerId, learner.nickname]]), ctx.now);
}

/** An 18-year-old asks for their own account to be deleted, with the same 14 days to change their mind. */
export async function requestSelfDeletion(ctx: Ctx): Promise<DataRequestView> {
  const who = requesterOf(ctx);
  if (who.kind !== "adult") throw new AppError("forbidden", "Use your Privacy page to delete a child's account or your family account.");
  const learnerId = who.actor.userId;
  assertCan(who.actor, "family.data.delete", { learnerId });
  const learner = await getLearnerSummary(ctx, learnerId);
  const undoUntil = undoDeadline(ctx.now);

  const row = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, learnerId)).for("update");
    const [open] = await tx.select().from(dataRequest).where(and(eq(dataRequest.learnerId, learnerId), eq(dataRequest.kind, "delete"), inArray(dataRequest.status, [...OPEN_DELETE]))).limit(1);
    if (open) return open;
    // They stay signed in so that they can undo it; the account does nothing else while it waits.
    await tx.update(user).set({ status: "pending_deletion", statusReason: "deleted_by_self", updatedAt: ctx.now }).where(eq(user.id, learnerId));
    await revokeInviteCodes(ctx, learnerId, tx);
    const [inserted] = await tx.insert(dataRequest).values({ kind: "delete", status: "requested", familyId: learner.familyId, learnerId, requestedBy: learnerId, undoUntil, createdAt: ctx.now, updatedAt: ctx.now }).returning();
    if (!inserted) throw new AppError("internal", "We couldn't start that. Nothing was removed. Try again in a moment.");
    await audit(ctx, { action: "data.delete.request", targetType: "user", targetId: learnerId, reason: "Asked for by the learner (18 or over)", meta: { requestId: inserted.id, scope: "self", undoUntil: undoUntil.toISOString() } }, tx);
    return inserted;
  });
  await tellRequesterScheduled(ctx, learnerId, "adult", "your account", row.undoUntil ?? undoUntil, row.id);
  return toView(row, new Map([[learnerId, learner.nickname]]), ctx.now);
}

async function familyOwnerId(db: Db, familyId: string): Promise<string | null> {
  const [row] = await db.select({ ownerUserId: family.ownerUserId }).from(family).where(eq(family.id, familyId)).limit(1);
  return row?.ownerUserId ?? null;
}

/**
 * The parent who set the family up asks for the whole family to be deleted: every child, every
 * parent and carer, and the family itself. Children's accounts close now. The adults can still
 * sign in for 14 days, because somebody has to be able to undo it.
 */
export async function requestFamilyDeletion(ctx: Ctx): Promise<DataRequestView> {
  const who = requesterOf(ctx);
  if (who.kind !== "parent") throw new AppError("forbidden", "That's for parent and carer accounts.");
  const { familyId, userId } = who.actor;
  assertCan(who.actor, "family.data.delete", { familyId });
  if ((await familyOwnerId(ctx.db, familyId)) !== userId) {
    throw new AppError("forbidden", "Only the person who set up this family account can delete all of it. You can still delete a child's account, or ask them to do this.");
  }
  const children = await listChildren(ctx, familyId);
  const independent = new Set<string>();
  for (const child of children) if (await isIndependentLearner(ctx, child.learnerId)) independent.add(child.learnerId);
  const undoUntil = undoDeadline(ctx.now);

  const row = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: family.id }).from(family).where(eq(family.id, familyId)).for("update");
    const [open] = await tx.select().from(dataRequest).where(and(eq(dataRequest.familyId, familyId), eq(dataRequest.kind, "delete"), isNull(dataRequest.learnerId), inArray(dataRequest.status, [...OPEN_DELETE]))).limit(1);
    if (open) return open;
    for (const child of children) {
      // An 18-year-old who runs their own account is not ours to close: they leave the family with their work.
      if (independent.has(child.learnerId) || child.status === "pending_deletion") continue;
      await tx.update(user).set({ status: "pending_deletion", statusReason: "family_deletion", updatedAt: ctx.now }).where(eq(user.id, child.learnerId));
      await revokeAllSessions(tx, child.learnerId);
      await revokeInviteCodes(ctx, child.learnerId, tx);
    }
    const [inserted] = await tx.insert(dataRequest).values({ kind: "delete", status: "requested", familyId, learnerId: null, requestedBy: userId, undoUntil, createdAt: ctx.now, updatedAt: ctx.now }).returning();
    if (!inserted) throw new AppError("internal", "We couldn't start that. Nothing was removed. Try again in a moment.");
    await audit(ctx, { action: "data.delete.request", targetType: "family", targetId: familyId, reason: "Asked for by the parent who owns the family account", meta: { requestId: inserted.id, scope: "family", children: children.length, undoUntil: undoUntil.toISOString() } }, tx);
    return inserted;
  });

  await tellRequesterScheduled(ctx, userId, "parent", "your family account and every child's account in it", row.undoUntil ?? undoUntil, row.id);
  for (const learnerId of independent) {
    try {
      await notify(ctx, {
        userId: learnerId,
        type: "account.family_closing",
        title: "The family account you're linked to is closing",
        body: `Your account and your work stay with you. On ${formatDate(row.undoUntil ?? undoUntil)} it moves to a free plan of its own.`,
        href: "/settings",
        channels: ["in_app"],
        dedupeKey: `family-closing:${row.id}:${learnerId}`,
      });
    } catch (error) {
      logWarn("data_request.notify_failed", { requestId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return toView(row, new Map(), ctx.now);
}

/**
 * Puts a closed account back as it was: active, unless it is still waiting for permissions or a
 * parent had paused it.
 */
async function reopenLearner(ctx: Pick<Ctx, "now">, tx: Db, learnerId: string): Promise<void> {
  const [target] = await tx.select({ status: user.status }).from(user).where(eq(user.id, learnerId)).for("update");
  if (!target || target.status !== "pending_deletion") return;
  const missing = await missingRequiredConsents({ db: tx }, learnerId);
  const [control] = await tx.select({ paused: parentControl.paused }).from(parentControl).where(eq(parentControl.learnerId, learnerId)).limit(1);
  const next =
    missing.length > 0
      ? { status: "paused" as const, statusReason: CONSENT_HOLD.required as string }
      : control?.paused
        ? { status: "paused" as const, statusReason: PARENT_PAUSE_REASON as string }
        : { status: "active" as const, statusReason: null };
  await tx.update(user).set({ ...next, updatedAt: ctx.now }).where(eq(user.id, learnerId));
}

/** Undoes a deletion inside its 14 days. After that, or once the job has started on it, it is too late. */
export async function cancelDeletion(ctx: Ctx, requestId: string): Promise<DataRequestView> {
  const result = await ctx.db.transaction(async (tx) => {
    const { row, who } = await ownRequest(ctx, requestId, tx, true);
    if (who.kind === "parent") assertCan(who.actor, "family.data.delete", { familyId: row.familyId });
    else assertCan(who.actor, "family.data.delete", { learnerId: row.learnerId });
    if (row.kind !== "delete") throw new AppError("not_found", REQUEST_NOT_FOUND);
    if (row.status === "cancelled") return { row, who, changed: false, label: "" };
    if (row.status !== "requested" || row.undoUntil === null || row.undoUntil <= ctx.now) {
      throw new AppError("conflict", "It's too late to undo that: the 14 days have passed and the deletion has been carried out or is under way.");
    }
    // A parent cannot undo what an 18-year-old asked for about their own account.
    if (who.kind === "parent" && row.learnerId !== null && row.requestedBy === row.learnerId) throw new AppError("not_found", REQUEST_NOT_FOUND);

    let label = "your account";
    if (row.learnerId) {
      await reopenLearner(ctx, tx, row.learnerId);
      if (who.kind === "parent") {
        const [profile] = await tx.select({ nickname: learnerProfile.nickname }).from(learnerProfile).where(eq(learnerProfile.userId, row.learnerId)).limit(1);
        label = `${profile?.nickname ?? "your child"}'s account`;
      }
    } else if (row.familyId) {
      label = "your family account";
      const members = await tx
        .select({ userId: familyMember.userId })
        .from(familyMember)
        .innerJoin(user, eq(user.id, familyMember.userId))
        .where(and(eq(familyMember.familyId, row.familyId), eq(familyMember.role, "learner"), eq(user.status, "pending_deletion"), eq(user.statusReason, "family_deletion")));
      for (const member of members) await reopenLearner(ctx, tx, member.userId);
    }
    const [updated] = await tx.update(dataRequest).set({ status: "cancelled", cancelledAt: ctx.now, updatedAt: ctx.now }).where(eq(dataRequest.id, row.id)).returning();
    await audit(ctx, { action: "data.delete.cancel", targetType: row.learnerId ? "user" : "family", targetId: row.learnerId ?? row.familyId ?? row.id, meta: { requestId: row.id } }, tx);
    return { row: updated ?? row, who, changed: true, label };
  });

  if (result.changed) {
    await emailRequester(ctx, result.who.actor.userId, "data_delete_cancelled", { accountLabel: result.label, url: `${appUrl()}${privacyPath(result.who.kind)}` });
  }
  const nicknames = await nicknamesFor(ctx, result.row.learnerId ? [result.row.learnerId] : []);
  return toView(result.row, nicknames, ctx.now);
}

// ── Delete: carrying it out ─────────────────────────────────────────────────

/** Storage keys of everything we hold for a learner that is not under a safeguarding hold. */
async function learnerFileKeys(db: Db, learnerId: string): Promise<string[]> {
  const files = await db
    .select({ key: artefact.storageKey })
    .from(artefact)
    .where(and(eq(artefact.learnerId, learnerId), isNotNull(artefact.storageKey), isNull(artefact.deletedFromStorageAt), eq(artefact.quarantined, false)));
  const exports = await db.select({ key: dataRequest.exportStorageKey }).from(dataRequest).where(and(eq(dataRequest.learnerId, learnerId), isNotNull(dataRequest.exportStorageKey)));
  return [...files, ...exports].flatMap((row) => (row.key && !row.key.startsWith("quarantine/") ? [row.key] : []));
}

async function deleteFiles(keys: string[]): Promise<number> {
  const storage = getStorage("private");
  let removed = 0;
  for (const key of new Set(keys)) {
    await storage.delete(key);
    removed += 1;
  }
  return removed;
}

/** True when something about this learner must stay under the safeguarding schedule. */
async function hasSafeguardingHold(tx: Db, learnerId: string): Promise<boolean> {
  const [[cases], [files], [chats]] = await Promise.all([
    tx.select({ id: safeguardingCase.id }).from(safeguardingCase).where(eq(safeguardingCase.learnerId, learnerId)).limit(1),
    tx.select({ id: artefact.id }).from(artefact).where(and(eq(artefact.learnerId, learnerId), eq(artefact.quarantined, true))).limit(1),
    tx.select({ id: tutorConversation.id }).from(tutorConversation).where(and(eq(tutorConversation.learnerId, learnerId), or(eq(tutorConversation.flagged, true), isNotNull(tutorConversation.safeguardingCaseId)))).limit(1),
  ]);
  return Boolean(cases ?? files ?? chats);
}

export type EraseOutcome = "erased" | "anonymised";

/**
 * Removes one learner. Runs inside `withAppendOnlyMaintenance(…, "account_deletion")`.
 *
 * Usually the user row goes and every table that hangs off it goes with it by cascade. If there
 * is a safeguarding hold, the row stays as an anonymous shell (no name, username, profile, sign-in
 * or family) so the held records keep their owner, and everything else is deleted table by table.
 * Consent records and the audit log are never touched.
 */
async function eraseLearner(ctx: Pick<Ctx, "now">, tx: Db, learnerId: string): Promise<EraseOutcome | null> {
  const [target] = await tx.select({ id: user.id }).from(user).where(and(eq(user.id, learnerId), eq(user.kind, "learner"))).for("update");
  if (!target) return null;
  // A deleted learner's ledger is removed (see `append-only.ts`); it has no foreign key to follow.
  await tx.delete(creditLedger).where(eq(creditLedger.learnerId, learnerId));
  await tx.delete(rateLimitBucket).where(like(rateLimitBucket.key, `%:user:${learnerId}`));

  if (!(await hasSafeguardingHold(tx, learnerId))) {
    await tx.delete(user).where(and(eq(user.id, learnerId), eq(user.kind, "learner")));
    return "erased";
  }

  // Held files keep their row: detach them from the project so that deleting the project leaves them.
  const heldFiles = await tx.select({ enrolmentId: artefact.enrolmentId }).from(artefact).where(and(eq(artefact.learnerId, learnerId), eq(artefact.quarantined, true)));
  const heldEnrolments = [...new Set(heldFiles.map((row) => row.enrolmentId))];
  await tx.update(artefact).set({ projectId: null, projectVersionId: null, updatedAt: ctx.now }).where(and(eq(artefact.learnerId, learnerId), eq(artefact.quarantined, true)));
  await tx.delete(certificate).where(eq(certificate.learnerId, learnerId));
  await tx.delete(artefact).where(and(eq(artefact.learnerId, learnerId), eq(artefact.quarantined, false)));
  await tx.delete(project).where(eq(project.learnerId, learnerId));
  await tx.delete(stepProgress).where(eq(stepProgress.learnerId, learnerId));
  await tx.delete(quizAttempt).where(eq(quizAttempt.learnerId, learnerId));
  await tx.delete(reflection).where(eq(reflection.learnerId, learnerId));
  await tx.delete(enrolment).where(and(eq(enrolment.learnerId, learnerId), heldEnrolments.length > 0 ? notInArray(enrolment.id, heldEnrolments) : undefined));

  // Coach: flagged conversations and the requests a case points at stay; the rest goes.
  const keptChats = await tx.select({ id: tutorConversation.id }).from(tutorConversation).where(and(eq(tutorConversation.learnerId, learnerId), or(eq(tutorConversation.flagged, true), isNotNull(tutorConversation.safeguardingCaseId))));
  const keptChatIds = keptChats.map((row) => row.id);
  const caseRequests = await tx.select({ id: safeguardingCase.aiRequestId }).from(safeguardingCase).where(and(eq(safeguardingCase.learnerId, learnerId), isNotNull(safeguardingCase.aiRequestId)));
  const keptRequestIds = caseRequests.flatMap((row) => (row.id ? [row.id] : []));
  await tx
    .delete(aiRequest)
    .where(
      and(
        eq(aiRequest.userId, learnerId),
        keptRequestIds.length > 0 ? notInArray(aiRequest.id, keptRequestIds) : undefined,
        keptChatIds.length > 0 ? or(isNull(aiRequest.conversationId), notInArray(aiRequest.conversationId, keptChatIds)) : undefined,
      ),
    );
  await tx.delete(tutorConversation).where(and(eq(tutorConversation.learnerId, learnerId), keptChatIds.length > 0 ? notInArray(tutorConversation.id, keptChatIds) : undefined));
  await tx.delete(creditBalance).where(eq(creditBalance.learnerId, learnerId));

  // Moderation records tied to a case stay with it; ordinary ones go with the account.
  const keptItems = await tx.select({ id: moderationItem.id }).from(moderationItem).where(and(eq(moderationItem.learnerId, learnerId), isNotNull(moderationItem.safeguardingCaseId)));
  const keptItemIds = keptItems.map((row) => row.id);
  await tx.delete(moderationEvent).where(and(eq(moderationEvent.learnerId, learnerId), keptItemIds.length > 0 ? or(isNull(moderationEvent.moderationItemId), notInArray(moderationEvent.moderationItemId, keptItemIds)) : undefined));
  await tx.delete(moderationItem).where(and(eq(moderationItem.learnerId, learnerId), isNull(moderationItem.safeguardingCaseId)));
  await tx.update(report).set({ reporterId: null, updatedAt: ctx.now }).where(and(eq(report.reporterId, learnerId), isNull(report.safeguardingCaseId)));

  await tx.delete(wishlist).where(eq(wishlist.learnerId, learnerId));
  await tx.delete(unlockRequest).where(eq(unlockRequest.learnerId, learnerId));
  await tx.delete(toolApproval).where(eq(toolApproval.learnerId, learnerId));
  await tx.delete(usageDay).where(eq(usageDay.learnerId, learnerId));
  await tx.delete(parentControl).where(eq(parentControl.learnerId, learnerId));
  await tx.delete(inviteCode).where(eq(inviteCode.learnerId, learnerId));
  await tx.delete(parentLinkRequest).where(eq(parentLinkRequest.learnerId, learnerId));
  await tx.delete(notification).where(eq(notification.userId, learnerId));
  await tx.delete(session).where(eq(session.userId, learnerId));
  await tx.delete(account).where(eq(account.userId, learnerId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, learnerId));
  await tx.delete(familyMember).where(eq(familyMember.userId, learnerId));
  await tx.delete(learnerProfile).where(eq(learnerProfile.userId, learnerId));
  await tx
    .update(user)
    .set({ name: "Deleted learner", email: newLearnerPlaceholderEmail(), emailVerified: false, image: null, username: null, status: "deleted", statusReason: "data_request", lastActiveAt: null, lockedUntil: null, updatedAt: ctx.now })
    .where(eq(user.id, learnerId));
  return "anonymised";
}

/** An 18-year-old who runs their own account leaves a family that is closing, for a free family of their own. */
async function moveToOwnFamily(ctx: Pick<Ctx, "now">, tx: Db, learnerId: string): Promise<void> {
  const [created] = await tx.insert(family).values({ ownerUserId: learnerId, plan: "free", createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: family.id });
  if (!created) throw new Error("Family insert returned no row");
  await tx.update(familyMember).set({ familyId: created.id, addedBy: null, updatedAt: ctx.now }).where(eq(familyMember.userId, learnerId));
  await tx.delete(parentControl).where(eq(parentControl.learnerId, learnerId));
  await tx.update(user).set({ status: "active", statusReason: null, updatedAt: ctx.now }).where(and(eq(user.id, learnerId), eq(user.status, "paused"), eq(user.statusReason, PARENT_PAUSE_REASON)));
}

/** Removes a family and its adults. Children must already have been erased or moved out. */
async function eraseFamily(ctx: Pick<Ctx, "now">, tx: Db, familyId: string): Promise<{ adultsErased: number; ownerAnonymised: boolean }> {
  const [target] = await tx.select({ ownerUserId: family.ownerUserId, stripeCustomerId: family.stripeCustomerId }).from(family).where(eq(family.id, familyId)).for("update");
  if (!target) return { adultsErased: 0, ownerAnonymised: false };
  const adults = await tx.select({ userId: familyMember.userId }).from(familyMember).innerJoin(user, eq(user.id, familyMember.userId)).where(and(eq(familyMember.familyId, familyId), ne(user.kind, "learner")));
  const adultIds = [...new Set([target.ownerUserId, ...adults.map((row) => row.userId)])];
  const [paid] = await tx.select({ id: subscription.id }).from(subscription).where(eq(subscription.familyId, familyId)).limit(1);
  // Payment records must be kept for six years. Only a family that has some keeps its shell.
  const keepForBilling = target.stripeCustomerId !== null || paid !== undefined;

  let adultsErased = 0;
  for (const adultId of adultIds) {
    await tx.delete(rateLimitBucket).where(like(rateLimitBucket.key, `%:user:${adultId}`));
    if (adultId === target.ownerUserId) continue;
    await tx.delete(user).where(and(eq(user.id, adultId), eq(user.kind, "parent")));
    adultsErased += 1;
  }

  if (!keepForBilling) {
    await tx.delete(family).where(eq(family.id, familyId));
    await tx.delete(user).where(eq(user.id, target.ownerUserId));
    return { adultsErased: adultsErased + 1, ownerAnonymised: false };
  }
  // The owner is the name on the payment records. The row stays, with nothing in it that identifies them.
  await tx.delete(session).where(eq(session.userId, target.ownerUserId));
  await tx.delete(account).where(eq(account.userId, target.ownerUserId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, target.ownerUserId));
  await tx.delete(notification).where(eq(notification.userId, target.ownerUserId));
  await tx.delete(familyMember).where(eq(familyMember.familyId, familyId));
  await tx.delete(learnerProfile).where(eq(learnerProfile.userId, target.ownerUserId));
  await tx
    .update(user)
    .set({ name: "Deleted account", email: `deleted-${randomUUID()}@deleted.invalid`, emailVerified: false, image: null, username: null, status: "deleted", statusReason: "data_request", lastActiveAt: null, lockedUntil: null, twoFactorEnabled: false, updatedAt: ctx.now })
    .where(eq(user.id, target.ownerUserId));
  await tx.update(family).set({ plan: "free", updatedAt: ctx.now }).where(eq(family.id, familyId));
  return { adultsErased, ownerAnonymised: true };
}

type DeletionResult = { learnersErased: number; learnersAnonymised: number; adultsErased: number; filesRemoved: number; familyRemoved: boolean };

/** Carries out one deletion whose window has ended. The request row is already claimed (`processing`). */
async function carryOutDeletion(ctx: Ctx, row: RequestRow): Promise<DeletionResult> {
  const result: DeletionResult = { learnersErased: 0, learnersAnonymised: 0, adultsErased: 0, filesRemoved: 0, familyRemoved: false };
  const wholeFamily = row.learnerId === null;
  let learnerIds: string[] = [];
  let leaving: string[] = [];
  let ownsFamily = false;

  if (wholeFamily) {
    if (!row.familyId) return result;
    const members = await ctx.db
      .select({ userId: familyMember.userId, status: user.status })
      .from(familyMember)
      .innerJoin(user, eq(user.id, familyMember.userId))
      .where(and(eq(familyMember.familyId, row.familyId), eq(familyMember.role, "learner"), eq(user.kind, "learner")));
    for (const member of members) {
      // Decided again now, not when the request was made: someone may have turned 18 and taken over their account since.
      if (member.status !== "pending_deletion" && (await isIndependentLearner(ctx, member.userId))) leaving.push(member.userId);
      else learnerIds.push(member.userId);
    }
  } else {
    const [target] = await ctx.db.select({ status: user.status }).from(user).where(and(eq(user.id, row.learnerId ?? ""), eq(user.kind, "learner"))).limit(1);
    // Only an account that is still waiting to be deleted. Anything else means the request was overtaken.
    if (target?.status === "pending_deletion" && row.learnerId) learnerIds = [row.learnerId];
    else leaving = [];
    ownsFamily = row.familyId !== null && row.learnerId !== null && (await familyOwnerId(ctx.db, row.familyId)) === row.learnerId;
  }

  const closesFamily = (wholeFamily || ownsFamily) && row.familyId !== null && (wholeFamily || learnerIds.length > 0);
  // Stripe first: never delete an account that is still being charged. A failure here stops the run; the job tries again.
  if (closesFamily && row.familyId) await cancelFamilySubscriptions(ctx, { familyId: row.familyId, reason: "Account deleted at the owner's request" });

  // Files before rows: if this stops half-way, the rows that say where the files are still exist for the next run.
  const keys: string[] = [];
  for (const learnerId of learnerIds) keys.push(...(await learnerFileKeys(ctx.db, learnerId)));
  if (closesFamily && row.familyId) {
    const exports = await ctx.db.select({ key: dataRequest.exportStorageKey }).from(dataRequest).where(and(eq(dataRequest.familyId, row.familyId), isNotNull(dataRequest.exportStorageKey)));
    keys.push(...exports.flatMap((entry) => (entry.key ? [entry.key] : [])));
  }
  result.filesRemoved = await deleteFiles(keys);

  await withAppendOnlyMaintenance(ctx.db, "account_deletion", async (tx) => {
    for (const learnerId of leaving) await moveToOwnFamily(ctx, tx, learnerId);
    for (const learnerId of learnerIds) {
      // A learner who owns their family cannot be removed before the family row that points at them.
      if (ownsFamily && row.familyId) continue;
      const outcome = await eraseLearner(ctx, tx, learnerId);
      if (outcome === "erased") result.learnersErased += 1;
      if (outcome === "anonymised") result.learnersAnonymised += 1;
      await audit(ctx, { action: "data.delete.complete", targetType: "user", targetId: learnerId, meta: { requestId: row.id, outcome, familyId: row.familyId } }, tx);
    }
    if (ownsFamily && row.familyId && row.learnerId && learnerIds.length > 0) {
      const outcome = await eraseOwningLearner(ctx, tx, row.learnerId, row.familyId);
      if (outcome === "erased") result.learnersErased += 1;
      else result.learnersAnonymised += 1;
      result.familyRemoved = outcome === "erased";
      await audit(ctx, { action: "data.delete.complete", targetType: "user", targetId: row.learnerId, meta: { requestId: row.id, outcome, familyId: row.familyId } }, tx);
    }
    if (wholeFamily && row.familyId) {
      const family = await eraseFamily(ctx, tx, row.familyId);
      result.adultsErased = family.adultsErased;
      result.familyRemoved = !family.ownerAnonymised;
      await audit(ctx, { action: "data.delete.complete", targetType: "family", targetId: row.familyId, meta: { requestId: row.id, ...result } }, tx);
    }
    await tx.update(dataRequest).set({ exportStorageKey: null, updatedAt: ctx.now }).where(and(isNotNull(dataRequest.exportStorageKey), wholeFamily && row.familyId ? eq(dataRequest.familyId, row.familyId) : inArray(dataRequest.learnerId, learnerIds.length > 0 ? learnerIds : [row.id])));
  });
  return result;
}

/**
 * An 18-year-old who owns their own single-seat family. With no payment history, the family and
 * the account both go. With payment history, the family row stays for the six years and the
 * account is anonymised, exactly as for a parent.
 */
async function eraseOwningLearner(ctx: Pick<Ctx, "now">, tx: Db, learnerId: string, familyId: string): Promise<EraseOutcome> {
  const [target] = await tx.select({ stripeCustomerId: family.stripeCustomerId }).from(family).where(and(eq(family.id, familyId), eq(family.ownerUserId, learnerId))).for("update");
  const [paid] = await tx.select({ id: subscription.id }).from(subscription).where(eq(subscription.familyId, familyId)).limit(1);
  const keepForBilling = target !== undefined && (target.stripeCustomerId !== null || paid !== undefined);
  const hold = await hasSafeguardingHold(tx, learnerId);
  if (!keepForBilling && !hold) {
    await tx.delete(creditLedger).where(eq(creditLedger.learnerId, learnerId));
    await tx.delete(rateLimitBucket).where(like(rateLimitBucket.key, `%:user:${learnerId}`));
    await tx.delete(family).where(eq(family.id, familyId));
    await tx.delete(user).where(and(eq(user.id, learnerId), eq(user.kind, "learner")));
    return "erased";
  }
  if (!hold) {
    // Nothing held for safeguarding, so every learning record can go by cascade from the tables below.
    await tx.delete(enrolment).where(eq(enrolment.learnerId, learnerId));
    await tx.delete(tutorConversation).where(eq(tutorConversation.learnerId, learnerId));
    await tx.delete(aiRequest).where(eq(aiRequest.userId, learnerId));
    await tx.delete(moderationEvent).where(eq(moderationEvent.learnerId, learnerId));
    await tx.delete(moderationItem).where(eq(moderationItem.learnerId, learnerId));
  }
  // The shared path anonymises the row and clears everything else. It returns "anonymised" only when there was a hold.
  if (hold) await eraseLearner(ctx, tx, learnerId);
  else {
    await tx.delete(creditLedger).where(eq(creditLedger.learnerId, learnerId));
    await tx.delete(rateLimitBucket).where(like(rateLimitBucket.key, `%:user:${learnerId}`));
    for (const table of [wishlist, unlockRequest, toolApproval, usageDay, parentControl, inviteCode, parentLinkRequest, creditBalance] as const) {
      await tx.delete(table).where(eq(table.learnerId, learnerId));
    }
    await tx.delete(notification).where(eq(notification.userId, learnerId));
    await tx.delete(session).where(eq(session.userId, learnerId));
    await tx.delete(account).where(eq(account.userId, learnerId));
    await tx.delete(twoFactor).where(eq(twoFactor.userId, learnerId));
    await tx.delete(familyMember).where(eq(familyMember.userId, learnerId));
    await tx.delete(learnerProfile).where(eq(learnerProfile.userId, learnerId));
    await tx
      .update(user)
      .set({ name: "Deleted learner", email: newLearnerPlaceholderEmail(), emailVerified: false, image: null, username: null, status: "deleted", statusReason: "data_request", lastActiveAt: null, lockedUntil: null, updatedAt: ctx.now })
      .where(eq(user.id, learnerId));
  }
  if (keepForBilling) await tx.update(family).set({ plan: "free", updatedAt: ctx.now }).where(eq(family.id, familyId));
  else await tx.delete(family).where(and(eq(family.id, familyId), ne(family.ownerUserId, learnerId)));
  return "anonymised";
}

export type DeleteDueSummary = { due: number; completed: number; failed: number; learnersErased: number; learnersAnonymised: number; adultsErased: number; filesRemoved: number };

/** A run still marked `processing` after this long is assumed to have died and is picked up again. */
const STALE_PROCESSING_MS = 60 * 60 * 1000;

/**
 * The `data.delete_due` job: completes every deletion whose 14 days have passed. Idempotent: a
 * request is claimed before any work, and a run that is repeated finds nothing left to do.
 * One request failing does not stop the others; it is recorded and tried again next time.
 */
export async function completeDueDeletions(ctx: Ctx): Promise<DeleteDueSummary> {
  if (ctx.actor.type !== "system") throw new AppError("forbidden", "You don't have permission to do that.");
  const summary: DeleteDueSummary = { due: 0, completed: 0, failed: 0, learnersErased: 0, learnersAnonymised: 0, adultsErased: 0, filesRemoved: 0 };
  const due = await ctx.db
    .select({ id: dataRequest.id })
    .from(dataRequest)
    .where(
      and(
        eq(dataRequest.kind, "delete"),
        isNull(dataRequest.cancelledAt),
        lte(dataRequest.undoUntil, ctx.now),
        or(inArray(dataRequest.status, ["requested", "failed"]), and(eq(dataRequest.status, "processing"), lt(dataRequest.updatedAt, new Date(ctx.now.getTime() - STALE_PROCESSING_MS)))),
      ),
    )
    // One child at a time before a whole family, so a family's request finds its children already handled.
    .orderBy(sql`${dataRequest.learnerId} is null`, asc(dataRequest.undoUntil))
    .limit(100);
  summary.due = due.length;

  for (const { id } of due) {
    const [row] = await ctx.db
      .update(dataRequest)
      .set({ status: "processing", updatedAt: ctx.now })
      .where(and(eq(dataRequest.id, id), eq(dataRequest.kind, "delete"), isNull(dataRequest.cancelledAt), lte(dataRequest.undoUntil, ctx.now), ne(dataRequest.status, "completed"), ne(dataRequest.status, "cancelled")))
      .returning();
    if (!row) continue;

    // Who to tell must be looked up before their account is gone.
    const recipient = await emailOf(ctx, row.requestedBy);
    const selfRequest = row.learnerId !== null && row.requestedBy === row.learnerId;
    let label = row.learnerId === null ? "your family account and every child's account in it" : "your account";
    if (row.learnerId && !selfRequest) {
      const [profile] = await ctx.db.select({ nickname: learnerProfile.nickname }).from(learnerProfile).where(eq(learnerProfile.userId, row.learnerId)).limit(1);
      label = `${profile?.nickname ?? "your child"}'s account`;
    }
    const parentIds = row.learnerId && !selfRequest && row.familyId ? await listParentUserIds(ctx, row.familyId) : [];

    try {
      const done = await carryOutDeletion(ctx, row);
      await ctx.db.update(dataRequest).set({ status: "completed", processedAt: ctx.now, error: null, updatedAt: ctx.now }).where(eq(dataRequest.id, id));
      summary.completed += 1;
      summary.learnersErased += done.learnersErased;
      summary.learnersAnonymised += done.learnersAnonymised;
      summary.adultsErased += done.adultsErased;
      summary.filesRemoved += done.filesRemoved;
    } catch (error) {
      logError("data_delete.failed", error, { requestId: id });
      await ctx.db.update(dataRequest).set({ status: "failed", error: "The deletion could not be completed and will be tried again.", updatedAt: ctx.now }).where(eq(dataRequest.id, id));
      summary.failed += 1;
      continue;
    }

    // The requester's own account may be gone now, so this goes straight to the address, with no account attached.
    if (recipient) {
      try {
        await sendEmail(ctx, { to: recipient, template: "data_delete_completed", data: { accountLabel: label } });
      } catch (error) {
        logWarn("data_request.email_failed", { template: "data_delete_completed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const parentId of parentIds) {
      try {
        await notify(ctx, { userId: parentId, type: "data.delete_completed", title: "The deletion is complete", body: `We have permanently deleted ${label.replace(/^your child's/, "your child's")}.`, href: "/parent/privacy", channels: ["in_app"], dedupeKey: `data-delete-completed:${id}` });
      } catch (error) {
        logWarn("data_request.notify_failed", { requestId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return summary;
}
