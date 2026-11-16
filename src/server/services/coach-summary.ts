// CONTRACT — owner: Coach slice (read by the parent dashboard). See _contract.ts.
import { TZDate } from "@date-fns/tz";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DISPLAY_TZ } from "@/lib/dates";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { aiRequest, familyMember, tutorConversation } from "@/server/db";

/** What a parent may see of Coach use: a count and topics, never transcripts (spec 3.6). */
export type CoachSummary = { messagesThisWeek: number; messagesTotal: number; topics: string[]; lastUsedAt: Date | null };

/** Turns that count as "a message to Coach": everything that reached Coach, whatever the answer. */
const COUNTED_OUTCOMES = ["ok", "refused", "blocked_input", "blocked_output", "crisis"] as const;
const MAX_TOPICS = 8;

/** Monday 00:00 in UK time for the week that `now` falls in. */
export function startOfLondonWeek(now: Date): Date {
  const local = new TZDate(now.getTime(), DISPLAY_TZ);
  const daysSinceMonday = (local.getDay() + 6) % 7;
  return new Date(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - daysSinceMonday, DISPLAY_TZ).getTime());
}

/**
 * Counts and topics only. Everything here comes from metadata: `ai_request` rows for the counts,
 * and the course and step titles saved on each conversation for the topics. Message text is never
 * read, decrypted or summarised, so nothing a learner typed can reach a parent this way.
 * Safety notices are a separate count (`countSafetyNoticesForLearner`).
 */
export async function getCoachSummaryForParent(ctx: Ctx, learnerId: string): Promise<CoachSummary> {
  const [membership] = await ctx.db.select({ familyId: familyMember.familyId }).from(familyMember).where(eq(familyMember.userId, learnerId)).limit(1);
  assertCan(ctx.actor, "learner.coach.summary.read", { learnerId, familyId: membership?.familyId ?? null });

  const counted = and(eq(aiRequest.userId, learnerId), eq(aiRequest.feature, "tutor"), eq(aiRequest.isPreview, false), inArray(aiRequest.outcome, [...COUNTED_OUTCOMES]));
  const [[total], [week], conversations] = await Promise.all([
    ctx.db.select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${aiRequest.createdAt})` }).from(aiRequest).where(counted),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(aiRequest).where(and(counted, gte(aiRequest.createdAt, startOfLondonWeek(ctx.now)))),
    ctx.db
      .select({ topics: tutorConversation.topics })
      .from(tutorConversation)
      .where(eq(tutorConversation.learnerId, learnerId))
      .orderBy(desc(sql`coalesce(${tutorConversation.lastMessageAt}, ${tutorConversation.createdAt})`))
      .limit(50),
  ]);

  const topics: string[] = [];
  for (const conversation of conversations) {
    for (const topic of conversation.topics) {
      if (!topics.includes(topic) && topics.length < MAX_TOPICS) topics.push(topic);
    }
  }
  const last = total?.last ?? null;
  return { messagesThisWeek: week?.n ?? 0, messagesTotal: total?.n ?? 0, topics, lastUsedAt: last === null ? null : new Date(last) };
}
