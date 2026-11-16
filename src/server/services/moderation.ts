// CONTRACT — owner: tools and submissions slice (the Studio safety slice builds the queue screens on top). See _contract.ts.
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { audit } from "@/server/audit";
import { assertCan, systemActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { moderationEvent, moderationItem, report, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { notifyStaffWithRole } from "@/server/notifications";
import { getSettings } from "@/server/settings";
import { issueCertificateIfEligible } from "./certificate";
import { slaDueFor } from "./moderation-sla";
import { raiseSafeguarding } from "./safeguarding-bridge";
import { applyArtefactDecision, applySubmissionDecision, notifyDecision, type DecisionEffect } from "./submission";

export type ModerationSeverity = "critical" | "high" | "normal";
export type ModerationItemView = {
  id: string;
  subjectType: string; // "submission" | "artefact" | "report" | "coach_message" | "username" | …
  subjectId: string;
  learnerId: string | null;
  source: "auto" | "report" | "sample" | "submission";
  severity: ModerationSeverity;
  state: "pending" | "approved" | "blocked" | "escalated";
  reason: string;
  flags: Record<string, unknown>;
  dueAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
};

type ItemRow = typeof moderationItem.$inferSelect;
type DbSubject = ItemRow["subjectType"];

/** The names other slices use for a subject, and the stored value for each. */
const SUBJECT_TO_DB: Record<string, DbSubject> = {
  submission: "project_version",
  project_version: "project_version",
  artefact: "artefact",
  report: "report",
  coach_message: "ai_output",
  ai_output: "ai_output",
  ai_input: "ai_input",
  username: "username",
  nickname: "nickname",
  reflection: "reflection",
  step_note: "step_note",
};
const SUBJECT_FROM_DB: Partial<Record<DbSubject, string>> = { project_version: "submission" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_FOUND = "That item could not be found. It may have been removed.";

function toDbSubject(subjectType: string): DbSubject {
  const mapped = SUBJECT_TO_DB[subjectType];
  if (!mapped) throw new AppError("invalid_input", "That kind of item can't go in the moderation queue.", { detail: { subjectType } });
  return mapped;
}

async function flagsFor(db: Db, itemIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const flags = new Map<string, Record<string, unknown>>();
  if (itemIds.length === 0) return flags;
  const events = await db
    .select({ itemId: moderationEvent.moderationItemId, categories: moderationEvent.categories })
    .from(moderationEvent)
    .where(inArray(moderationEvent.moderationItemId, [...itemIds]))
    .orderBy(asc(moderationEvent.createdAt));
  for (const event of events) if (event.itemId) flags.set(event.itemId, { ...flags.get(event.itemId), ...event.categories });
  return flags;
}

function toView(row: ItemRow, flags: Record<string, unknown> | undefined): ModerationItemView {
  return {
    id: row.id,
    subjectType: SUBJECT_FROM_DB[row.subjectType] ?? row.subjectType,
    subjectId: row.subjectId ?? "",
    learnerId: row.learnerId,
    source: row.source,
    severity: row.severity,
    state: row.state,
    reason: row.summary ?? "",
    flags: flags ?? {},
    dueAt: row.dueAt ?? row.createdAt,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/**
 * Adds an item to the human queue with an SLA due time worked out from the admin-set targets and working window.
 *
 * `reason` is in staff words: never a learner's own text. `flags` are category labels and scores
 * from the automated checks, stored as a check result attached to the item. Adding the same
 * subject from the same source again while it is still waiting returns the item already there.
 * Critical and high items alert the moderators at once, with no personal detail in the alert.
 */
export async function enqueueModeration(ctx: Ctx, input: { subjectType: string; subjectId: string; learnerId?: string | null; source: ModerationItemView["source"]; severity: ModerationSeverity; reason: string; flags?: Record<string, unknown> }): Promise<ModerationItemView> {
  const subjectType = toDbSubject(input.subjectType);
  if (!UUID.test(input.subjectId)) throw new AppError("invalid_input", "That item can't go in the moderation queue.", { detail: { subjectId: "not a uuid" } });

  const [existing] = await ctx.db
    .select()
    .from(moderationItem)
    .where(and(eq(moderationItem.subjectType, subjectType), eq(moderationItem.subjectId, input.subjectId), eq(moderationItem.source, input.source), eq(moderationItem.state, "pending")))
    .limit(1);
  if (existing) return toView(existing, (await flagsFor(ctx.db, [existing.id])).get(existing.id));

  const settings = await getSettings(ctx, ["moderation.sla_hours", "moderation.sla_window"]);
  const dueAt = slaDueFor(ctx.now, input.severity, settings["moderation.sla_hours"], settings["moderation.sla_window"]);
  const [row] = await ctx.db
    .insert(moderationItem)
    .values({ state: "pending", severity: input.severity, source: input.source, subjectType, subjectId: input.subjectId, learnerId: input.learnerId ?? null, reportId: subjectType === "report" ? input.subjectId : null, summary: input.reason.slice(0, 500), dueAt, createdAt: ctx.now, updatedAt: ctx.now })
    .returning();
  if (!row) throw new AppError("internal", "We couldn't add that to the review queue. Try again in a moment.");
  const flags = input.flags ?? {};
  if (Object.keys(flags).length > 0) {
    await ctx.db.insert(moderationEvent).values({ subjectType, subjectId: input.subjectId, learnerId: input.learnerId ?? null, provider: "queue", verdict: "flagged", categories: flags, severity: input.severity, moderationItemId: row.id, createdAt: ctx.now });
  }

  if (input.severity !== "normal") {
    try {
      await notifyStaffWithRole(ctx, ["moderator", "dsl", "admin"], {
        type: "moderation.urgent_item",
        title: input.severity === "critical" ? "Critical item in the moderation queue" : "High-priority item in the moderation queue",
        body: "An item needs a decision. Open the queue to see it.",
        href: `/studio/moderation/${row.id}`,
        urgent: true,
        dedupeKey: `moderation-item:${row.id}`,
      });
    } catch (error) {
      // The item is in the queue either way; the alert is a courtesy on top of the SLA clock.
      logError("moderation.alert_failed", error, { itemId: row.id });
    }
  }
  return toView(row, flags);
}

export async function listModerationItems(ctx: Ctx, filters?: { state?: ModerationItemView["state"]; severity?: ModerationSeverity; subjectType?: string; limit?: number; offset?: number }): Promise<{ items: ModerationItemView[]; total: number }> {
  assertCan(ctx.actor, "moderation.read");
  const where: SQL[] = [];
  if (filters?.state) where.push(eq(moderationItem.state, filters.state));
  if (filters?.severity) where.push(eq(moderationItem.severity, filters.severity));
  if (filters?.subjectType) where.push(eq(moderationItem.subjectType, toDbSubject(filters.subjectType)));
  const condition = where.length > 0 ? and(...where) : undefined;
  const limit = Math.min(Math.max(Math.floor(filters?.limit ?? 50), 1), 200);
  const offset = Math.max(Math.floor(filters?.offset ?? 0), 0);
  // Soonest deadline first: that is the order the work must be done in.
  const rows = await ctx.db.select().from(moderationItem).where(condition).orderBy(asc(moderationItem.dueAt), desc(moderationItem.createdAt)).limit(limit).offset(offset);
  const [totals] = await ctx.db.select({ total: count() }).from(moderationItem).where(condition);
  const flags = await flagsFor(ctx.db, rows.map((row) => row.id));
  return { items: rows.map((row) => toView(row, flags.get(row.id))), total: totals?.total ?? 0 };
}

export async function getModerationItem(ctx: Ctx, itemId: string): Promise<ModerationItemView | null> {
  assertCan(ctx.actor, "moderation.read");
  if (!UUID.test(itemId)) return null;
  const [row] = await ctx.db.select().from(moderationItem).where(eq(moderationItem.id, itemId)).limit(1);
  return row ? toView(row, (await flagsFor(ctx.db, [row.id])).get(row.id)) : null;
}

const CASE_SEVERITY = { critical: "critical", high: "high", normal: "medium" } as const;

/**
 * A human decision (authz `moderation.decide`). Applies the outcome to the subject (e.g. accepts or rejects a submission). `escalate` opens a safeguarding case.
 *
 * - `approve` on a submission or upload accepts it: it appears in the portfolio and, if the course
 *   is complete, the certificate is issued.
 * - `block` on a submission or upload sends it back as "needs changes". `note` is REQUIRED and is
 *   shown to the learner, so write it to them: kind, specific, and about the work. The stored
 *   files are deleted at once; hashes and metadata are kept.
 * - `escalate` opens a safeguarding case, keeps the work held and puts its files out of reach.
 * - On a report: `approve` means nothing needed doing (dismissed), `block` means it was upheld
 *   (resolved), `escalate` passes it to the safeguarding lead.
 * Always a named person, never a job; always audited.
 */
export async function decideModeration(ctx: Ctx, itemId: string, decision: { verdict: "approve" | "block" | "escalate"; note?: string }): Promise<ModerationItemView> {
  assertCan(ctx.actor, "moderation.decide");
  if (ctx.actor.type !== "staff") throw new AppError("forbidden", "You don't have permission to do that.");
  const staffId = ctx.actor.userId;
  const note = decision.note?.trim() || null;
  const state = decision.verdict === "approve" ? "approved" : decision.verdict === "block" ? "blocked" : "escalated";
  const subjectVerdict = decision.verdict === "approve" ? "accept" : decision.verdict === "block" ? "reject" : "escalate";

  const done = await ctx.db.transaction(async (tx) => {
    const [item] = await tx.select().from(moderationItem).where(eq(moderationItem.id, itemId)).for("update");
    if (!item) throw new AppError("not_found", NOT_FOUND);
    // An escalated item can still be closed with a final decision once the safeguarding lead has looked.
    if (item.state !== "pending" && !(item.state === "escalated" && decision.verdict !== "escalate")) throw new AppError("conflict", "That item has already been decided.");
    const inTx: Ctx = { ...ctx, db: tx };

    let effect: DecisionEffect | null = null;
    if (item.subjectId) {
      if (item.subjectType === "project_version") effect = await applySubmissionDecision(inTx, item.subjectId, subjectVerdict, note);
      else if (item.subjectType === "artefact") effect = await applyArtefactDecision(inTx, item.subjectId, subjectVerdict, note);
      else if (item.subjectType === "report") {
        const status = decision.verdict === "approve" ? "dismissed" : decision.verdict === "block" ? "resolved" : "triaged";
        await tx.update(report).set({ status, resolvedBy: decision.verdict === "escalate" ? null : staffId, resolvedAt: decision.verdict === "escalate" ? null : ctx.now, resolutionNote: note, updatedAt: ctx.now }).where(eq(report.id, item.subjectId));
      }
    }

    await tx.update(moderationItem).set({ state, decidedBy: staffId, decidedAt: ctx.now, decisionNote: note, updatedAt: ctx.now }).where(eq(moderationItem.id, item.id));
    await audit(inTx, { action: `moderation.${decision.verdict}`, targetType: "moderation_item", targetId: item.id, meta: { subjectType: item.subjectType, subjectId: item.subjectId, severity: item.severity, source: item.source } }, tx);
    return { item, effect };
  });

  if (decision.verdict === "escalate") {
    const opened = await raiseSafeguarding(
      ctx,
      { learnerId: done.item.learnerId, severity: CASE_SEVERITY[done.item.severity], trigger: "moderator_escalation", summary: "A moderator escalated an item from the moderation queue.", sourceType: "moderation_item", sourceId: done.item.id, detail: note ?? undefined },
      { subjectType: done.item.subjectType, subjectId: done.item.subjectId ?? done.item.id },
    );
    if (opened.caseId) {
      await ctx.db.update(moderationItem).set({ safeguardingCaseId: opened.caseId, updatedAt: ctx.now }).where(eq(moderationItem.id, done.item.id)).catch((error: unknown) => logError("moderation.case_link_failed", error, { itemId: done.item.id }));
      if (done.item.subjectType === "report" && done.item.subjectId) {
        await ctx.db.update(report).set({ safeguardingCaseId: opened.caseId, updatedAt: ctx.now }).where(eq(report.id, done.item.subjectId)).catch((error: unknown) => logError("moderation.case_link_failed", error, { itemId: done.item.id }));
      }
    }
  } else if (done.effect) {
    try {
      // The decision stands whatever happens here: a failed notice or certificate can be retried.
      if (done.effect.accepted && done.effect.projectId && done.effect.enrolmentId) await issueCertificateIfEligible({ ...ctx, actor: systemActor("certificate.issue") }, done.effect.enrolmentId);
      await notifyDecision(ctx, done.effect, decision.verdict === "approve" ? "accept" : "reject");
    } catch (error) {
      logError("moderation.after_decision_failed", error, { itemId: done.item.id });
    }
  }

  const [row] = await ctx.db.select().from(moderationItem).where(eq(moderationItem.id, itemId)).limit(1);
  if (!row) throw new AppError("not_found", NOT_FOUND);
  return toView(row, (await flagsFor(ctx.db, [row.id])).get(row.id));
}
