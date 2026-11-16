/**
 * Where the Coach pipeline writes (stage 10, spec Section 8): `ai_request` metadata for every
 * turn, and message content only where retention allows.
 *
 * - `ai_request` never holds message text: ids, counts, costs, category scores.
 * - Message content is encrypted with the content key before it is stored, and every row carries
 *   an `expires_at` for the nightly retention sweep: 30 days by default, 90 with the parent's
 *   "resume chat" consent. Flagged content (a crisis turn) follows the safeguarding schedule and
 *   is for the DSL only: it is never fed back into a prompt or shown to the learner again.
 * - Staff preview writes metadata with `is_preview = true` and nothing else.
 */
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { decrypt, encrypt } from "@/server/crypto";
import { aiMessage, aiRequest, retentionPolicy, tutorConversation } from "@/server/db";
import { AppError } from "@/server/errors";
import type { ChatMessage, CoachStore, TurnRecord } from "./types";

export const RETENTION_KEYS = {
  default: "tutor_conversation_default",
  extended: "tutor_conversation_extended",
  flagged: "flagged_content",
} as const;
/** Spec Section 9 defaults, used when `retention_policy` has no row for the key. */
export const RETENTION_DEFAULT_DAYS: Record<keyof typeof RETENTION_KEYS, number> = { default: 30, extended: 90, flagged: 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function retentionDays(ctx: Pick<Ctx, "db">, kind: keyof typeof RETENTION_KEYS): Promise<number> {
  const [row] = await ctx.db.select({ days: retentionPolicy.days }).from(retentionPolicy).where(eq(retentionPolicy.key, RETENTION_KEYS[kind])).limit(1);
  return row && row.days > 0 ? row.days : RETENTION_DEFAULT_DAYS[kind];
}

/** When stored content for this turn must be gone by. */
export async function expiryFor(ctx: Pick<Ctx, "db" | "now">, turn: Pick<TurnRecord, "flagged" | "extendedRetention">): Promise<Date> {
  const kind = turn.flagged ? "flagged" : turn.extendedRetention ? "extended" : "default";
  return new Date(ctx.now.getTime() + (await retentionDays(ctx, kind)) * DAY_MS);
}

/** Coarse topic labels for the parent summary: course and step titles only, never message text. */
export function topicsFor(step: TurnRecord["step"]): string[] {
  if (!step) return [];
  return [...new Set([step.courseTitle, step.stepTitle].map((t) => t.trim()).filter((t) => t.length > 0))];
}

export const dbCoachStore: CoachStore = {
  async findConversation(ctx, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await ctx.db
      .select({ id: tutorConversation.id, learnerId: tutorConversation.learnerId, flagged: tutorConversation.flagged, messageCount: tutorConversation.messageCount })
      .from(tutorConversation)
      .where(eq(tutorConversation.id, id))
      .limit(1);
    return row ? { id: row.id, learnerId: row.learnerId, flagged: row.flagged, learnerTurns: Math.ceil(row.messageCount / 2) } : null;
  },

  async history(ctx, conversationId, limit) {
    const rows = await ctx.db
      .select({ role: aiMessage.role, content: aiMessage.contentEncrypted })
      .from(aiMessage)
      .innerJoin(tutorConversation, eq(tutorConversation.id, aiMessage.conversationId))
      .where(
        and(
          eq(aiMessage.conversationId, conversationId),
          eq(aiMessage.flagged, false),
          eq(tutorConversation.flagged, false),
          isNull(tutorConversation.contentDeletedAt),
          gt(aiMessage.expiresAt, ctx.now),
        ),
      )
      .orderBy(desc(aiMessage.createdAt), desc(aiMessage.role))
      .limit(limit);
    const messages: ChatMessage[] = [];
    for (const row of rows.reverse()) {
      try {
        messages.push({ role: row.role, content: decrypt(row.content, "content") });
      } catch {
        // A message that cannot be read (for example after a key change) is left out of the context.
      }
    }
    // Context must start with the learner speaking.
    while (messages[0]?.role === "assistant") messages.shift();
    return messages;
  },

  async record(ctx, turn) {
    const topics = topicsFor(turn.step);
    await ctx.db.transaction(async (tx) => {
      let conversationId: string | null = null;
      if (turn.conversation && !turn.isPreview) {
        conversationId = turn.conversation.id;
        if (turn.conversation.isNew) {
          await tx.insert(tutorConversation).values({
            id: conversationId,
            learnerId: turn.userId,
            enrolmentId: turn.step?.enrolmentId ?? null,
            courseId: turn.step?.courseId ?? null,
            stepId: turn.step?.stepId ?? null,
            topics,
            flagged: turn.flagged,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          });
        }
      }

      await tx.insert(aiRequest).values({
        id: turn.aiRequestId,
        userId: turn.userId,
        familyId: turn.familyId,
        feature: "tutor",
        conversationId,
        courseId: turn.step?.courseId ?? null,
        stepId: turn.step?.stepId ?? null,
        routeAlias: turn.routeAlias,
        providerKey: turn.providerKey,
        model: turn.model,
        promptVersion: turn.promptVersion,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        costMillipence: turn.costMillipence,
        creditsCharged: turn.creditsCharged,
        outcome: turn.outcome,
        moderation: turn.moderation,
        isPreview: turn.isPreview,
        latencyMs: turn.latencyMs,
        errorCode: turn.errorCode,
        requestId: ctx.requestId,
        createdAt: ctx.now,
      });

      if (!turn.content || !conversationId || turn.isPreview) return;
      const expiresAt = await expiryFor({ db: tx, now: ctx.now }, turn);
      const base = { conversationId, learnerId: turn.userId, aiRequestId: turn.aiRequestId, flagged: turn.flagged, expiresAt };
      const rows: Array<typeof aiMessage.$inferInsert> = [{ ...base, role: "user" as const, contentEncrypted: encrypt(turn.content.user, "content"), redacted: turn.content.userRedacted, createdAt: ctx.now }];
      if (turn.content.assistant !== null) {
        // One millisecond later, so that the pair always reads back in order.
        rows.push({ ...base, role: "assistant" as const, contentEncrypted: encrypt(turn.content.assistant, "content"), redacted: false, createdAt: new Date(ctx.now.getTime() + 1) });
      }
      await tx.insert(aiMessage).values(rows);
      await tx
        .update(tutorConversation)
        .set({
          messageCount: sql`${tutorConversation.messageCount} + ${rows.length}`,
          lastMessageAt: ctx.now,
          updatedAt: ctx.now,
          ...(turn.flagged ? { flagged: true } : {}),
          ...(topics.length > 0
            ? { topics: sql`(select coalesce(array_agg(distinct t), '{}') from unnest(${tutorConversation.topics} || ${sql.param(topics)}::text[]) as t)` }
            : {}),
        })
        .where(eq(tutorConversation.id, conversationId));
      if (turn.flagged) {
        // Once a conversation is flagged, everything in it follows the safeguarding schedule.
        await tx.update(aiMessage).set({ flagged: true, expiresAt: sql`greatest(${aiMessage.expiresAt}, ${expiresAt.toISOString()}::timestamptz)` }).where(eq(aiMessage.conversationId, conversationId));
      }
    });
  },

  async linkCase(ctx, conversationId, caseId) {
    await ctx.db.update(tutorConversation).set({ safeguardingCaseId: caseId, flagged: true, updatedAt: ctx.now }).where(eq(tutorConversation.id, conversationId));
  },
};

/**
 * The messages of a flagged conversation, for the Designated Safeguarding Lead only (spec
 * Section 8, "flagged conversations … DSL access only"). Break-glass: a reason is required and
 * every read is written to the audit log.
 */
export async function readFlaggedConversation(ctx: Ctx, conversationId: string, reason: string): Promise<Array<{ role: "user" | "assistant"; content: string; createdAt: Date }>> {
  assertCan(ctx.actor, "safeguarding.case.read_notes");
  if (reason.trim().length < 5) throw new AppError("invalid_input", "Say why you need to read this conversation.");
  const [conversation] = await ctx.db.select({ id: tutorConversation.id, flagged: tutorConversation.flagged, learnerId: tutorConversation.learnerId }).from(tutorConversation).where(eq(tutorConversation.id, conversationId)).limit(1);
  if (!conversation || !conversation.flagged) throw new AppError("not_found", "That conversation could not be found, or it is not flagged.");
  await audit(ctx, { action: "safeguarding.conversation.read", targetType: "tutor_conversation", targetId: conversationId, reason: reason.trim().slice(0, 500), meta: { learnerId: conversation.learnerId } });
  const rows = await ctx.db.select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId)).orderBy(asc(aiMessage.createdAt));
  return rows.map((row) => ({ role: row.role, content: decrypt(row.contentEncrypted, "content"), createdAt: row.createdAt }));
}
