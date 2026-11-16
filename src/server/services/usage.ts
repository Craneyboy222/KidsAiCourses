// CONTRACT — owner: learning slice. See _contract.ts.
import { and, eq, gte, sql } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { DISPLAY_TZ, londonDateKey } from "@/lib/dates";
import { capReached, creditableSeconds, inQuietHours, minutesLeftToday, minutesToClock } from "@/lib/learning/time-rules";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { usageDay, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { missingRequiredConsents } from "./consent";
import { assertLearnerAccess, familyIdOf } from "./learning-access";
import { getControls, type ParentControls } from "./parent-controls";

export type LearningAllowed =
  | { allowed: true; minutesLeftToday: number | null }
  | { allowed: false; reason: "paused" | "time_cap" | "quiet_hours" | "consent" | "not_active"; message: string };

type Blocked = Extract<LearningAllowed, { allowed: false }>;

const MESSAGES = {
  not_active: "Your account isn't switched on at the moment, so learning is on hold. A parent or carer can sort it out from their dashboard.",
  paused: "Your account is paused at the moment. Everything you've done is saved. A parent or carer can switch it back on from their dashboard.",
  consent: "A parent or carer needs to finish the permissions for your account before you can carry on. Everything you've done is saved.",
  time_cap: "That's your learning time for today. Everything is saved, and it will all be here tomorrow.",
} as const;

const blocked = (reason: Blocked["reason"], message: string): Blocked => ({ allowed: false, reason, message });

/**
 * Who may ask whether a learner can learn right now: the learner (even while paused: that is the
 * answer they need), a parent in the same family, staff, and background jobs.
 */
async function assertMayAsk(ctx: Ctx, learnerId: string): Promise<void> {
  const { actor } = ctx;
  if (actor.type === "system") return;
  if (actor.type === "learner" && actor.userId === learnerId) return;
  if (actor.type === "staff" && actor.twoFactorVerified) return;
  if (actor.type === "parent" && (await familyIdOf(ctx, learnerId)) === actor.familyId) return;
  if (actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  throw new AppError("forbidden", "You don't have permission to do that.");
}

async function secondsToday(ctx: Pick<Ctx, "db" | "now">, learnerId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ seconds: usageDay.seconds })
    .from(usageDay)
    .where(and(eq(usageDay.learnerId, learnerId), eq(usageDay.day, londonDateKey(ctx.now))))
    .limit(1);
  return row?.seconds ?? 0;
}

type Evaluation = { result: LearningAllowed; controls: ParentControls | null; usedSeconds: number };

/** Account state, consent, pause, quiet hours and the cap, in that order. Stops at the first reason. */
async function evaluate(ctx: Ctx, learnerId: string): Promise<Evaluation> {
  const [account] = await ctx.db.select({ kind: user.kind, status: user.status, statusReason: user.statusReason }).from(user).where(eq(user.id, learnerId)).limit(1);
  if (!account || account.kind !== "learner") return { result: blocked("not_active", MESSAGES.not_active), controls: null, usedSeconds: 0 };
  if (account.status === "paused") {
    const consentHold = (account.statusReason ?? "").startsWith("consent");
    return { result: consentHold ? blocked("consent", MESSAGES.consent) : blocked("paused", MESSAGES.paused), controls: null, usedSeconds: 0 };
  }
  if (account.status !== "active") return { result: blocked("not_active", MESSAGES.not_active), controls: null, usedSeconds: 0 };

  if ((await missingRequiredConsents(ctx, learnerId)).length > 0) return { result: blocked("consent", MESSAGES.consent), controls: null, usedSeconds: 0 };

  const controls = await getControls(ctx, learnerId);
  if (controls.paused) return { result: blocked("paused", MESSAGES.paused), controls, usedSeconds: 0 };

  if (inQuietHours(ctx.now, controls)) {
    const until = minutesToClock(controls.quietEndMin);
    return {
      result: blocked("quiet_hours", `It's quiet hours until ${until}. Everything you've done is saved, so pick it up after that.`),
      controls,
      usedSeconds: 0,
    };
  }

  const usedSeconds = await secondsToday(ctx, learnerId);
  if (capReached(controls.dailyMinutesCap, usedSeconds)) return { result: blocked("time_cap", MESSAGES.time_cap), controls, usedSeconds };
  return { result: { allowed: true, minutesLeftToday: minutesLeftToday(controls.dailyMinutesCap, usedSeconds) }, controls, usedSeconds };
}

/**
 * The single check for "may this learner learn right now?": account active, required consents
 * granted, not paused, inside the daily cap, outside quiet hours (spec 3.2, 3.6).
 * Used by the player, autosave, Coach and submissions. The cap is a hard stop, but work is saved first.
 */
export async function checkLearningAllowed(ctx: Ctx, learnerId: string): Promise<LearningAllowed> {
  await assertMayAsk(ctx, learnerId);
  return (await evaluate(ctx, learnerId)).result;
}

/**
 * Adds active seconds to today's total (UK date). Returns the same shape as checkLearningAllowed
 * after adding. Nothing is added while learning is not allowed, and the total never passes the cap.
 * See `creditableSeconds` for how the browser's number is bounded.
 */
export async function recordHeartbeat(ctx: Ctx, learnerId: string, seconds: number): Promise<LearningAllowed> {
  assertCan(ctx.actor, "learner.usage.heartbeat", { learnerId });
  const before = await evaluate(ctx, learnerId);
  if (!before.result.allowed || !before.controls) return before.result;
  const cap = before.controls.dailyMinutesCap;
  const day = londonDateKey(ctx.now);

  const total = await ctx.db.transaction(async (tx) => {
    await tx.insert(usageDay).values({ learnerId, day, seconds: 0, createdAt: ctx.now, updatedAt: ctx.now }).onConflictDoNothing({ target: [usageDay.learnerId, usageDay.day] });
    // Locked, so two tabs beating at once are counted one after the other.
    const [row] = await tx.select().from(usageDay).where(and(eq(usageDay.learnerId, learnerId), eq(usageDay.day, day))).for("update");
    const used = row?.seconds ?? 0;
    const last = row?.lastHeartbeatAt ?? null;
    const add = creditableSeconds({
      claimed: seconds,
      secondsSinceLast: last ? (ctx.now.getTime() - last.getTime()) / 1000 : null,
      capMinutes: cap,
      usedSeconds: used,
    });
    await tx
      .update(usageDay)
      .set({ seconds: used + add, lastHeartbeatAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(usageDay.learnerId, learnerId), eq(usageDay.day, day)));
    return used + add;
  });

  // `last_active_at` is what the retention job reads; once a minute is plenty.
  await ctx.db
    .update(user)
    .set({ lastActiveAt: ctx.now })
    .where(and(eq(user.id, learnerId), sql`(${user.lastActiveAt} is null or ${user.lastActiveAt} < ${new Date(ctx.now.getTime() - 60_000).toISOString()}::timestamptz)`));

  if (capReached(cap, total)) return blocked("time_cap", MESSAGES.time_cap);
  return { allowed: true, minutesLeftToday: minutesLeftToday(cap, total) };
}

/** The UK calendar date `daysAgo` days before `now`, as `yyyy-MM-dd`. */
function londonDayOffset(now: Date, daysAgo: number): string {
  const local = new TZDate(now.getTime(), DISPLAY_TZ);
  return londonDateKey(new Date(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - daysAgo, 12, 0, 0, DISPLAY_TZ).getTime()));
}

/** The last `days` UK days, oldest first, ending today. Days with no activity are included as 0. */
export async function getUsageByDay(ctx: Ctx, learnerId: string, days: number): Promise<{ date: string; seconds: number }[]> {
  await assertLearnerAccess(ctx, "learner.progress.read", learnerId);
  const count = Math.min(Math.max(Math.floor(days) || 1, 1), 90);
  const dates = Array.from({ length: count }, (_, index) => londonDayOffset(ctx.now, count - 1 - index));
  const first = dates[0] ?? londonDateKey(ctx.now);
  const rows = await ctx.db
    .select({ day: usageDay.day, seconds: usageDay.seconds })
    .from(usageDay)
    .where(and(eq(usageDay.learnerId, learnerId), gte(usageDay.day, first)));
  const byDay = new Map(rows.map((row) => [row.day, row.seconds]));
  return dates.map((date) => ({ date, seconds: byDay.get(date) ?? 0 }));
}
