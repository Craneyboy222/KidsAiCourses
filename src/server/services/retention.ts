/**
 * Retention (spec Section 9 "Retention defaults"): how long each kind of record is kept, and the
 * nightly sweep that deletes what is past its period.
 *
 * - The periods live in `retention_policy`, one row per key, editable in Studio. The defaults are
 *   `RETENTION_DEFAULTS` below, taken from the spec. `ensureRetentionPolicies` adds any row that is
 *   missing and never overwrites one that is there.
 * - A period the law decides, or that a lawyer or the safeguarding lead must confirm, is marked
 *   ⚖️ in its description. Those figures are placeholders until confirmed (spec Section 17, Q6).
 * - `runRetentionSweep` applies each policy in small batches. It deletes stored files as well as
 *   rows. `dryRun: true` counts what would go and changes nothing (Studio's "what would happen").
 * - Where another slice already owns the deleting (a pending teen, an account whose undo window
 *   has ended), the sweep calls that slice's function instead of doing it a second way.
 * - The append-only tables (`consent_record`, `credit_ledger`, `audit_log`) are never touched by
 *   the nightly sweep. Consent evidence is kept (⚖️). The audit log has a period in the spec
 *   (2 years, ⚖️): deleting from it is a separate, deliberate switch (`includeAuditLog`), off by
 *   default, so that nothing removes audit evidence before the period has been confirmed.
 * - Safeguarding cases are never deleted here: their period is the safeguarding lead's policy (⚖️).
 *
 * This module does not import `server-only`, so that the seed script can run it with tsx.
 */
import { and, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { revokeAllSessions } from "@/server/auth/accounts";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import {
  aiMessage,
  aiRequest,
  artefact,
  auditLog,
  dataRequest,
  familyMember,
  jobRun,
  moderationEvent,
  moderationItem,
  parentLinkRequest,
  retentionPolicy,
  safeguardingCase,
  stripeEvent,
  tutorConversation,
  user,
  withAppendOnlyMaintenance,
} from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { notify, notifyParentsOfLearner } from "@/server/notifications";
import { getStorage } from "@/server/storage";
import { completeDueDeletions } from "./data-request";
import { purgePendingTeens } from "./teen-signup";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionDefault = {
  key: string;
  /**
   * 0 means "not a number of days": kept for the life of the account, decided by a named policy,
   * or deleted at once. Those have no `retention_policy` row (the table only holds real periods:
   * `days > 0`) and cannot be changed in Studio; they are listed so the schedule is complete.
   */
  days: number;
  /** ⚖️ The period is set by law or needs a lawyer's or the safeguarding lead's confirmation. */
  legal: boolean;
  description: string;
  /** What enforces it, for the retention schedule document and Studio. */
  enforcedBy: string;
};

const LEGAL_MARK = "⚖️";

/**
 * Spec Section 9. Keys already read by other slices (Coach's `expires_at`, the parent's "what we
 * hold" page) are kept exactly: `tutor_conversation_default`, `tutor_conversation_extended`,
 * `flagged_content`, `account_inactive`, `ai_metadata`, `pending_teen` and the rest.
 */
export const RETENTION_DEFAULTS: readonly RetentionDefault[] = [
  { key: "account_inactive", days: 730, legal: true, description: "Account, profile and progress: deleted 24 months after the learner was last active, after a warning to the parent.", enforcedBy: "retention.sweep (warning, then a deletion request with the usual undo window)" },
  { key: "account_inactive_warning", days: 30, legal: false, description: "How long before an inactive account is deleted the parent is warned.", enforcedBy: "retention.sweep" },
  { key: "account_deletion_undo", days: 14, legal: true, description: "Undo window after a deletion request. When it ends the account is deleted.", enforcedBy: "data.delete_due (hourly) and retention.sweep" },
  { key: "pending_teen", days: 7, legal: false, description: "A sign-up a teenager started that no parent approved: everything about it is deleted.", enforcedBy: "accounts.purge_pending and retention.sweep" },
  { key: "tutor_conversation_default", days: 30, legal: false, description: "Coach messages: the words are deleted after this many days. Counts and topics remain.", enforcedBy: "retention.sweep (ai_message.expires_at)" },
  { key: "tutor_conversation_extended", days: 90, legal: false, description: "Coach messages when a parent has switched on chat history.", enforcedBy: "retention.sweep (ai_message.expires_at)" },
  { key: "flagged_content", days: 365, legal: true, description: "Flagged Coach conversations and moderation decisions: kept this long after the matter is resolved, under the safeguarding schedule.", enforcedBy: "retention.sweep (held while a linked safeguarding case is open)" },
  { key: "safeguarding_case", days: 0, legal: true, description: "Safeguarding cases: kept for as long as the safeguarding lead's policy says. Never deleted automatically.", enforcedBy: "the safeguarding lead (no automatic deletion)" },
  { key: "ai_metadata", days: 395, legal: false, description: "The record of each Coach request (dates, token counts, cost; never the words): deleted after 13 months. Daily totals remain.", enforcedBy: "retention.sweep" },
  { key: "artefacts", days: 0, legal: false, description: "Projects and the files and links sent in with them: kept for the life of the account.", enforcedBy: "account deletion" },
  { key: "rejected_upload", days: 0, legal: false, description: "An upload that failed our checks or was sent back: its file is deleted immediately. The hash and metadata are kept.", enforcedBy: "the submissions service at the moment of rejection; retention.sweep as a backstop" },
  { key: "consent_record", days: 0, legal: true, description: "The permissions a parent gave or withdrew: kept as evidence, after the account closes too. Append-only; never deleted by the sweep.", enforcedBy: "nothing automatic (append-only evidence)" },
  { key: "billing_records", days: 2190, legal: true, description: "Payment records (about the paying adult, never the child): 6 years.", enforcedBy: "retention.sweep (payment event log); invoices are held by Stripe" },
  { key: "audit_log", days: 730, legal: true, description: "The security and change log: 2 years. Append-only; removed only by the deliberate audit-log purge, never by the nightly sweep.", enforcedBy: "retention sweep with includeAuditLog (off by default)" },
  { key: "job_run_log", days: 90, legal: false, description: "The record of background job runs (counts and errors, no personal data).", enforcedBy: "retention.sweep" },
];

/** The description stored in `retention_policy`, with the ⚖️ mark where it applies. */
export const policyDescription = (policy: Pick<RetentionDefault, "legal" | "description">): string => (policy.legal ? `${LEGAL_MARK} ${policy.description}` : policy.description);

export type RetentionPolicyView = { key: string; days: number; description: string; legal: boolean; enforcedBy: string | null; isDefault: boolean };

function assertMayManage(ctx: Pick<Ctx, "actor">): void {
  assertCan(ctx.actor, "retention.manage");
}

/** Adds the default policies that are missing. A row that exists is never changed: its period may have been set by a person. */
export async function ensureRetentionPolicies(ctx: Ctx): Promise<{ inserted: string[]; existing: string[] }> {
  assertMayManage(ctx);
  const inserted = await ctx.db
    .insert(retentionPolicy)
    .values(RETENTION_DEFAULTS.filter((policy) => policy.days > 0).map((policy) => ({ key: policy.key, days: policy.days, description: policyDescription(policy), createdAt: ctx.now, updatedAt: ctx.now })))
    .onConflictDoNothing({ target: retentionPolicy.key })
    .returning({ key: retentionPolicy.key });
  const added = new Set(inserted.map((row) => row.key));
  if (added.size > 0) await audit(ctx, { action: "retention.policy.seed_defaults", targetType: "retention_policy", meta: { keys: [...added] } });
  return { inserted: [...added], existing: RETENTION_DEFAULTS.filter((policy) => policy.days > 0 && !added.has(policy.key)).map((policy) => policy.key) };
}

/** Every policy as configured, defaults filled in for any row that is missing. For Studio and the schedule document. */
export async function listRetentionPolicies(ctx: Ctx): Promise<RetentionPolicyView[]> {
  assertMayManage(ctx);
  const rows = await ctx.db.select().from(retentionPolicy);
  const stored = new Map(rows.map((row) => [row.key, row]));
  const known = RETENTION_DEFAULTS.map((policy) => {
    const row = stored.get(policy.key);
    return { key: policy.key, days: row?.days ?? policy.days, description: row?.description ?? policyDescription(policy), legal: policy.legal, enforcedBy: policy.enforcedBy, isDefault: !row || row.days === policy.days };
  });
  const extra = rows.filter((row) => !RETENTION_DEFAULTS.some((policy) => policy.key === row.key)).map((row) => ({ key: row.key, days: row.days, description: row.description, legal: row.description.startsWith(LEGAL_MARK), enforcedBy: null, isDefault: false }));
  return [...known, ...extra];
}

/** Changes one period (Studio). The ⚖️ mark stays on a policy that has one. Audited. */
export async function setRetentionDays(ctx: Ctx, key: string, days: number, reason?: string): Promise<void> {
  assertMayManage(ctx);
  const policy = RETENTION_DEFAULTS.find((candidate) => candidate.key === key);
  if (!policy) throw new AppError("not_found", "That retention policy doesn't exist.");
  if (policy.days === 0) throw new AppError("invalid_input", "That one isn't a number of days, so there is nothing to change here. It is set by a policy document or by the life of the account.");
  if (!Number.isInteger(days) || days < 1 || days > 36_500) throw new AppError("invalid_input", "A retention period is a whole number of days, from 1 to 36,500.");
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select({ days: retentionPolicy.days }).from(retentionPolicy).where(eq(retentionPolicy.key, key)).limit(1);
    await tx
      .insert(retentionPolicy)
      .values({ key, days, description: policyDescription(policy), updatedBy, createdAt: ctx.now, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: retentionPolicy.key, set: { days, updatedBy, updatedAt: ctx.now } });
    await audit(ctx, { action: "retention.policy.update", targetType: "retention_policy", targetId: key, reason, meta: { from: before?.days ?? policy.days, to: days } }, tx);
  });
}

/** The configured number of days for each known key (the default where there is no row). */
export async function loadRetentionDays(ctx: Pick<Ctx, "db">): Promise<Record<string, number>> {
  const rows = await ctx.db.select({ key: retentionPolicy.key, days: retentionPolicy.days }).from(retentionPolicy);
  const stored = new Map(rows.map((row) => [row.key, row.days]));
  return Object.fromEntries(RETENTION_DEFAULTS.map((policy) => [policy.key, stored.get(policy.key) ?? policy.days]));
}

// ───────────────────────────── The sweep ─────────────────────────────

export type SweepOptions = {
  /** Count what is due and change nothing. */
  dryRun?: boolean;
  /** Rows per batch. Default 500. */
  batchSize?: number;
  /** Batches per step in one run. What is left waits for the next run. Default 20. */
  maxBatches?: number;
  /** Also delete audit-log rows past the `audit_log` period. Off by default: see the file comment. */
  includeAuditLog?: boolean;
};

export type SweepSummary = {
  dryRun: boolean;
  /** Counts only: this is stored in `job_run.summary`. With `dryRun`, what WOULD be removed. */
  coachMessagesDeleted: number;
  coachConversationsCleared: number;
  aiRequestsDeleted: number;
  pendingTeensPurged: number;
  deletionsCompleted: number;
  inactiveWarningsSent: number;
  inactiveDeletionsScheduled: number;
  rejectedFilesDeleted: number;
  moderationItemsDeleted: number;
  paymentEventsDeleted: number;
  jobRunsDeleted: number;
  auditLogDeleted: number;
  /** True when a step stopped at its batch limit with more still to do. */
  moreToDo: boolean;
  /** Steps that threw. The others still ran. */
  failedSteps: string[];
};

type Sweep = { ctx: Ctx; dryRun: boolean; batchSize: number; maxBatches: number; days: Record<string, number>; summary: SweepSummary };

const cutoff = (sweep: Sweep, key: string): Date | null => {
  const days = sweep.days[key] ?? 0;
  return days > 0 ? new Date(sweep.ctx.now.getTime() - days * DAY_MS) : null;
};

/** Deletes in batches: `pick` returns the next ids that are due, `remove` deletes them. Returns how many went (or would go). */
async function inBatches(sweep: Sweep, pick: (limit: number) => Promise<string[]>, remove: (ids: string[]) => Promise<void>, countAll: () => Promise<number>): Promise<number> {
  if (sweep.dryRun) return countAll();
  let total = 0;
  for (let batch = 0; batch < sweep.maxBatches; batch += 1) {
    const ids = await pick(sweep.batchSize);
    if (ids.length === 0) return total;
    await remove(ids);
    total += ids.length;
    if (ids.length < sweep.batchSize) return total;
  }
  sweep.summary.moreToDo = true;
  return total;
}

const count = async (query: PromiseLike<Array<{ n: number }>>): Promise<number> => (await query)[0]?.n ?? 0;

/**
 * Coach messages past `expires_at`. A flagged message is held while its conversation's
 * safeguarding case is open, and then for the `flagged_content` period after the case closes.
 */
async function sweepCoachMessages(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const flaggedDays = sweep.days.flagged_content ?? 365;
  const heldUntil = new Date(ctx.now.getTime() - flaggedDays * DAY_MS);
  const held = sql`(${aiMessage.flagged} and exists (
    select 1 from ${tutorConversation} c
    join ${safeguardingCase} s on s.id = c.safeguarding_case_id
    where c.id = ${aiMessage.conversationId} and (s.closed_at is null or s.closed_at > ${heldUntil.toISOString()}::timestamptz)
  ))`;
  const due = and(lte(aiMessage.expiresAt, ctx.now), sql`not ${held}`);
  sweep.summary.coachMessagesDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: aiMessage.id }).from(aiMessage).where(due).limit(limit)).map((row) => row.id),
    async (ids) => void (await ctx.db.delete(aiMessage).where(inArray(aiMessage.id, ids))),
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(aiMessage).where(due)),
  );
  // A conversation with no words left keeps its counts and topics, and says when the words went.
  const emptied = and(isNull(tutorConversation.contentDeletedAt), sql`${tutorConversation.messageCount} > 0`, sql`not exists (select 1 from ${aiMessage} m where m.conversation_id = ${tutorConversation.id})`);
  if (sweep.dryRun) return;
  const cleared = await ctx.db.update(tutorConversation).set({ contentDeletedAt: ctx.now, updatedAt: ctx.now }).where(emptied).returning({ id: tutorConversation.id });
  sweep.summary.coachConversationsCleared = cleared.length;
}

/** Coach request metadata after 13 months. The daily totals in `spend_counter` stay. A request a safeguarding case points at is kept with the case. */
async function sweepAiMetadata(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const before = cutoff(sweep, "ai_metadata");
  if (!before) return;
  const due = and(lt(aiRequest.createdAt, before), sql`not exists (select 1 from ${safeguardingCase} s where s.ai_request_id = ${aiRequest.id})`);
  sweep.summary.aiRequestsDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: aiRequest.id }).from(aiRequest).where(due).limit(limit)).map((row) => row.id),
    async (ids) => void (await ctx.db.delete(aiRequest).where(inArray(aiRequest.id, ids))),
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(aiRequest).where(due)),
  );
}

/** Pending teen accounts nobody approved: the accounts slice owns the deleting. */
async function sweepPendingTeens(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  if (!sweep.dryRun) {
    sweep.summary.pendingTeensPurged = (await purgePendingTeens(ctx)).purged;
    return;
  }
  const days = sweep.days.pending_teen ?? 7;
  const rows = await ctx.db
    .select({ id: user.id })
    .from(user)
    .leftJoin(parentLinkRequest, eq(parentLinkRequest.learnerId, user.id))
    .where(and(eq(user.kind, "learner"), eq(user.status, "pending_parent"), or(lte(user.createdAt, new Date(ctx.now.getTime() - days * DAY_MS)), lte(parentLinkRequest.expiresAt, ctx.now))));
  sweep.summary.pendingTeensPurged = new Set(rows.map((row) => row.id)).size;
}

/** Accounts whose undo window has ended: the privacy slice owns the deleting (`data.delete_due` also runs it hourly). */
async function sweepDueDeletions(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  if (!sweep.dryRun) {
    if (ctx.actor.type !== "system") return; // `completeDueDeletions` is for the job alone; a member of staff uses the dry run
    sweep.summary.deletionsCompleted = (await completeDueDeletions(ctx)).completed;
    return;
  }
  sweep.summary.deletionsCompleted = await count(
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dataRequest)
      .where(and(eq(dataRequest.kind, "delete"), isNull(dataRequest.cancelledAt), lte(dataRequest.undoUntil, ctx.now), inArray(dataRequest.status, ["requested", "failed", "processing"]))),
  );
}

const INACTIVE_WARNING_ACTION = "retention.inactive_warning";

/**
 * Inactive accounts (spec: "24 months after last activity, with a 30-day warning to the parent").
 * Two passes over learners who have not been active for the period less the warning:
 *  1. no warning yet since they were last active → warn the parent (or the adult learner), and
 *     record that in the audit log;
 *  2. warned at least the warning period ago and still inactive past the full period → start a
 *     deletion request with the usual undo window. The account is closed now and deleted by the
 *     same code as any other deletion when the window ends.
 * Signing in again at any point moves `last_active_at` and the account drops out of both passes.
 */
async function sweepInactiveAccounts(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const fullDays = sweep.days.account_inactive ?? 0;
  if (fullDays <= 0) return;
  const warnDays = Math.min(Math.max(sweep.days.account_inactive_warning ?? 30, 1), fullDays);
  const undoDays = Math.max(sweep.days.account_deletion_undo ?? 14, 1);
  const warnFrom = new Date(ctx.now.getTime() - (fullDays - warnDays) * DAY_MS);
  const deleteFrom = new Date(ctx.now.getTime() - fullDays * DAY_MS);
  const warnedBefore = new Date(ctx.now.getTime() - warnDays * DAY_MS);
  // Read back as text by the driver (a raw SQL expression has no column type), hence `new Date(...)` below.
  const lastActive = sql<string>`coalesce(${user.lastActiveAt}, ${user.createdAt})`;

  const candidates = await ctx.db
    .select({ id: user.id, lastActive, familyId: familyMember.familyId })
    .from(user)
    .leftJoin(familyMember, eq(familyMember.userId, user.id))
    .where(and(eq(user.kind, "learner"), inArray(user.status, ["active", "paused"]), sql`${lastActive} < ${warnFrom.toISOString()}::timestamptz`))
    .orderBy(lastActive)
    .limit(sweep.batchSize);
  if (candidates.length === sweep.batchSize) sweep.summary.moreToDo = true;

  for (const learner of candidates) {
    const since = new Date(learner.lastActive);
    const [warning] = await ctx.db
      .select({ at: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.action, INACTIVE_WARNING_ACTION), eq(auditLog.targetId, learner.id), gte(auditLog.createdAt, since)))
      .orderBy(auditLog.createdAt)
      .limit(1);

    if (!warning) {
      sweep.summary.inactiveWarningsSent += 1;
      if (sweep.dryRun) continue;
      const deleteOn = new Date(Math.max(since.getTime() + fullDays * DAY_MS, ctx.now.getTime() + warnDays * DAY_MS));
      const notice = {
        type: "retention.inactive_warning",
        title: "An account that hasn't been used will be deleted",
        body: `Nobody has used this learner account for a long time. To keep it, sign in before ${deleteOn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}. After that we will delete the account and its work. You will have ${undoDays} days to undo that.`,
        href: "/parent/privacy",
        dedupeKey: `retention-inactive:${learner.id}:${since.toISOString().slice(0, 10)}`,
      };
      try {
        const sent = await notifyParentsOfLearner(ctx, learner.id, notice);
        // An 18-year-old who runs their own account has no parent to tell: tell them.
        if (sent.length === 0) await notify(ctx, { ...notice, userId: learner.id, href: "/settings" });
      } catch (error) {
        logWarn("retention.inactive_warning_failed", { learnerId: learner.id, error: error instanceof Error ? error.message : String(error) });
        continue; // no record of a warning, so it is tried again tomorrow and nothing is deleted
      }
      await audit(ctx, { action: INACTIVE_WARNING_ACTION, targetType: "user", targetId: learner.id, meta: { inactiveSince: since.toISOString(), deleteOn: deleteOn.toISOString() } });
      continue;
    }

    if (since >= deleteFrom || new Date(warning.at) > warnedBefore) continue; // warned, and the warning period is still running
    sweep.summary.inactiveDeletionsScheduled += 1;
    if (sweep.dryRun) continue;
    const undoUntil = new Date(ctx.now.getTime() + undoDays * DAY_MS);
    await ctx.db.transaction(async (tx) => {
      await tx.update(user).set({ status: "pending_deletion", statusReason: "inactive", updatedAt: ctx.now }).where(eq(user.id, learner.id));
      await revokeAllSessions(tx, learner.id);
      await tx.insert(dataRequest).values({ kind: "delete", status: "requested", familyId: learner.familyId, learnerId: learner.id, requestedBy: null, undoUntil, createdAt: ctx.now, updatedAt: ctx.now });
      await audit(ctx, { action: "retention.inactive_deletion_scheduled", targetType: "user", targetId: learner.id, reason: "No activity for the retention period, after a warning", meta: { inactiveSince: since.toISOString(), undoUntil: undoUntil.toISOString() } }, tx);
    });
    try {
      await notifyParentsOfLearner(ctx, learner.id, {
        type: "retention.inactive_deletion",
        title: "An unused account is set to be deleted",
        body: `A learner account that nobody has used for a long time will be deleted in ${undoDays} days. You can undo this from your Privacy page until then.`,
        href: "/parent/privacy",
        dedupeKey: `retention-inactive-deletion:${learner.id}:${undoUntil.toISOString().slice(0, 10)}`,
      });
    } catch (error) {
      logWarn("retention.inactive_deletion_notice_failed", { learnerId: learner.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/**
 * Rejected uploads. The submissions service deletes a rejected file at once; this is the backstop
 * for a file that survived (a crash between the decision and the delete). Quarantined files are
 * never touched: they are evidence in a safeguarding case (D3).
 */
async function sweepRejectedUploads(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const due = and(eq(artefact.moderationState, "blocked"), sql`${artefact.storageKey} is not null`, eq(artefact.quarantined, false));
  if (sweep.dryRun) {
    sweep.summary.rejectedFilesDeleted = await count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(artefact).where(due));
    return;
  }
  const storage = getStorage("private");
  for (let batch = 0; batch < sweep.maxBatches; batch += 1) {
    const rows = await ctx.db.select({ id: artefact.id, storageKey: artefact.storageKey }).from(artefact).where(due).limit(sweep.batchSize);
    for (const row of rows) {
      if (row.storageKey === null) continue;
      // The file first, then the row: if this stops half-way the row still points at it and the next run finishes the job.
      await storage.delete(row.storageKey);
      await ctx.db.update(artefact).set({ storageKey: null, deletedFromStorageAt: ctx.now, updatedAt: ctx.now }).where(eq(artefact.id, row.id));
      sweep.summary.rejectedFilesDeleted += 1;
    }
    if (rows.length < sweep.batchSize) return;
  }
  sweep.summary.moreToDo = true;
}

/** Decided moderation items (and their check records) after the flagged-content period. Open and escalated items are never touched. */
async function sweepModeration(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const before = cutoff(sweep, "flagged_content");
  if (!before) return;
  const due = and(inArray(moderationItem.state, ["approved", "blocked"]), lt(moderationItem.decidedAt, before));
  sweep.summary.moderationItemsDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: moderationItem.id }).from(moderationItem).where(due).limit(limit)).map((row) => row.id),
    async (ids) => {
      await ctx.db.delete(moderationEvent).where(inArray(moderationEvent.moderationItemId, ids));
      await ctx.db.delete(moderationItem).where(inArray(moderationItem.id, ids));
    },
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(moderationItem).where(due)),
  );
}

/** Our log of payment webhooks (ids and types, about the paying adult only) after the billing period. */
async function sweepPaymentEvents(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const before = cutoff(sweep, "billing_records");
  if (!before) return;
  const due = lt(stripeEvent.createdAt, before);
  sweep.summary.paymentEventsDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: stripeEvent.id }).from(stripeEvent).where(due).limit(limit)).map((row) => row.id),
    async (ids) => void (await ctx.db.delete(stripeEvent).where(inArray(stripeEvent.id, ids))),
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(stripeEvent).where(due)),
  );
}

/** Finished job runs after the log period. A run still marked `running` is left for the job runner to deal with. */
async function sweepJobRuns(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const before = cutoff(sweep, "job_run_log");
  if (!before) return;
  const due = and(lt(jobRun.startedAt, before), ne(jobRun.status, "running"));
  sweep.summary.jobRunsDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: jobRun.id }).from(jobRun).where(due).limit(limit)).map((row) => row.id),
    async (ids) => void (await ctx.db.delete(jobRun).where(inArray(jobRun.id, ids))),
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(jobRun).where(due)),
  );
}

/**
 * The audit log past its period. ONLY when asked for (`includeAuditLog`), through the one
 * sanctioned bypass of the append-only trigger. Safeguarding access and consent entries are kept
 * regardless: they are the evidence of who read a child's case and of what a parent agreed to.
 */
async function sweepAuditLog(sweep: Sweep): Promise<void> {
  const { ctx } = sweep;
  const before = cutoff(sweep, "audit_log");
  if (!before) return;
  const due = and(lt(auditLog.createdAt, before), sql`${auditLog.action} not like 'safeguarding.%'`, sql`${auditLog.action} not like 'consent.%'`, notInArray(auditLog.action, [INACTIVE_WARNING_ACTION]));
  sweep.summary.auditLogDeleted = await inBatches(
    sweep,
    async (limit) => (await ctx.db.select({ id: auditLog.id }).from(auditLog).where(due).limit(limit)).map((row) => row.id),
    async (ids) => withAppendOnlyMaintenance(ctx.db, "retention", async (tx) => void (await tx.delete(auditLog).where(inArray(auditLog.id, ids)))),
    () => count(ctx.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(due)),
  );
}

/**
 * Applies every policy once. The nightly job runs it as the system actor; an admin may run it
 * with `dryRun` from Studio (and a real run by a member of staff skips the two steps that belong
 * to jobs alone). One step failing does not stop the others: it is named in `failedSteps`.
 */
export async function runRetentionSweep(ctx: Ctx, options: SweepOptions = {}): Promise<SweepSummary> {
  assertMayManage(ctx);
  const summary: SweepSummary = {
    dryRun: options.dryRun === true,
    coachMessagesDeleted: 0,
    coachConversationsCleared: 0,
    aiRequestsDeleted: 0,
    pendingTeensPurged: 0,
    deletionsCompleted: 0,
    inactiveWarningsSent: 0,
    inactiveDeletionsScheduled: 0,
    rejectedFilesDeleted: 0,
    moderationItemsDeleted: 0,
    paymentEventsDeleted: 0,
    jobRunsDeleted: 0,
    auditLogDeleted: 0,
    moreToDo: false,
    failedSteps: [],
  };
  const sweep: Sweep = {
    ctx,
    dryRun: summary.dryRun,
    batchSize: Math.min(Math.max(Math.floor(options.batchSize ?? 500), 1), 5000),
    maxBatches: Math.min(Math.max(Math.floor(options.maxBatches ?? 20), 1), 1000),
    days: await loadRetentionDays(ctx),
    summary,
  };
  const steps: Array<[string, (sweep: Sweep) => Promise<void>]> = [
    ["coach_messages", sweepCoachMessages],
    ["ai_metadata", sweepAiMetadata],
    ["pending_teens", sweepPendingTeens],
    ["due_deletions", sweepDueDeletions],
    ["inactive_accounts", sweepInactiveAccounts],
    ["rejected_uploads", sweepRejectedUploads],
    ["moderation", sweepModeration],
    ["payment_events", sweepPaymentEvents],
    ["job_runs", sweepJobRuns],
    ...(options.includeAuditLog === true ? [["audit_log", sweepAuditLog] as [string, (sweep: Sweep) => Promise<void>]] : []),
  ];
  for (const [name, step] of steps) {
    try {
      await step(sweep);
    } catch (error) {
      summary.failedSteps.push(name);
      logWarn("retention.step_failed", { step: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!summary.dryRun) await audit(ctx, { action: "retention.sweep", meta: { ...summary } });
  return summary;
}
