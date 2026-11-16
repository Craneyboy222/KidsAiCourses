// CONTRACT — owner: learning slice (read by the parent dashboard). See _contract.ts.
import { TZDate } from "@date-fns/tz";
import { DISPLAY_TZ, londonDateKey } from "@/lib/dates";
import type { Ctx } from "@/server/context";
import { listEnrolmentItems } from "./enrolment";
import { assertLearnerAccess } from "./learning-access";
import { getUsageByDay } from "./usage";

export type ProgressSummary = {
  inProgress: { courseId: string; courseSlug: string; title: string; percent: number; lastActiveAt: Date | null }[];
  completed: { courseId: string; courseSlug: string; title: string; completedAt: Date }[];
  minutesThisWeek: number;
  minutesToday: number;
};

/** The UK date of the Monday of the week `now` falls in, as `yyyy-MM-dd`. */
export function londonWeekStartKey(now: Date): string {
  const local = new TZDate(now.getTime(), DISPLAY_TZ);
  const daysSinceMonday = (local.getDay() + 6) % 7;
  return londonDateKey(new Date(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - daysSinceMonday, 12, 0, 0, DISPLAY_TZ).getTime()));
}

/**
 * What a parent sees of their child's learning (spec 3.6): courses in progress and finished, and
 * time today and this week (Monday to now, UK time). Titles, percentages and minutes only: never
 * notes, reflections or quiz answers.
 */
export async function getProgressSummary(ctx: Ctx, learnerId: string): Promise<ProgressSummary> {
  await assertLearnerAccess(ctx, "learner.progress.read", learnerId);
  const [enrolments, usage] = await Promise.all([listEnrolmentItems(ctx, learnerId), getUsageByDay(ctx, learnerId, 7)]);
  const today = londonDateKey(ctx.now);
  const weekStart = londonWeekStartKey(ctx.now);
  const secondsThisWeek = usage.filter((day) => day.date >= weekStart).reduce((sum, day) => sum + day.seconds, 0);
  const secondsToday = usage.find((day) => day.date === today)?.seconds ?? 0;

  return {
    inProgress: enrolments
      .filter((item) => item.status === "active")
      .map((item) => ({
        courseId: item.courseId,
        courseSlug: item.courseSlug,
        title: item.courseTitle,
        percent: item.totalSteps === 0 ? 0 : Math.round((item.completedSteps / item.totalSteps) * 100),
        lastActiveAt: item.lastActivityAt,
      })),
    completed: enrolments
      .filter((item): item is typeof item & { completedAt: Date } => item.status === "completed" && item.completedAt !== null)
      .map((item) => ({ courseId: item.courseId, courseSlug: item.courseSlug, title: item.courseTitle, completedAt: item.completedAt })),
    minutesThisWeek: Math.floor(secondsThisWeek / 60),
    minutesToday: Math.floor(secondsToday / 60),
  };
}
