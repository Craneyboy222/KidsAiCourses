import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { logWarn } from "@/server/log";
import { listNotifications, type NotificationItem } from "@/server/notifications";
import { catalogueCoursesForLearner, listCatalogue, recommendForLearner, type CatalogueCourse } from "./catalogue";
import { listEnrolmentItems, type EnrolmentListItem } from "./enrolment";
import { listSaved } from "./wishlist";

export type HomeEnrolment = EnrolmentListItem & { percent: number; tagline: string; category: string; estimatedMinutes: number };

export type LearnerHome = {
  /** Courses in progress, most recently active first. */
  continueLearning: HomeEnrolment[];
  finished: HomeEnrolment[];
  /** Interest-based picks the learner has not started. */
  madeForYou: CatalogueCourse[];
  /** Published in the last seven days; when there are none, the newest few instead (`newIsThisWeek` false). */
  newCourses: CatalogueCourse[];
  newIsThisWeek: boolean;
  /** Free courses not yet started. */
  freeCourses: CatalogueCourse[];
  saved: CatalogueCourse[];
  /** Unread notices: a parent's answer about a tool or a locked course, a take-down, and so on. */
  notices: NotificationItem[];
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The learner home (spec 3.2): continue, made for you, new, free, saved and notices.
 *
 * Every course list comes from the catalogue service, so nothing above the learner's age, blocked
 * by a parent or taken down can appear, including a course they started before it was hidden.
 * There are no streaks, scores or comparisons with anyone else here, on purpose.
 */
export async function getLearnerHome(ctx: Ctx, learnerId: string): Promise<LearnerHome> {
  assertCan(ctx.actor, "learner.progress.read", { learnerId });

  const [enrolments, madeForYou, thisWeek, saved, free] = await Promise.all([
    listEnrolmentItems(ctx, learnerId),
    recommendForLearner(ctx, learnerId, 4),
    catalogueCoursesForLearner(ctx, learnerId, { publishedSince: new Date(ctx.now.getTime() - WEEK_MS), limit: 4 }),
    listSaved(ctx, learnerId),
    listCatalogue(ctx, { kind: "learner", learnerId }, { free: true, sort: "for_you", limit: 8 }),
  ]);

  const visible = new Map((await catalogueCoursesForLearner(ctx, learnerId, { ids: enrolments.map((item) => item.courseId) })).map((item) => [item.id, item]));
  const mine: HomeEnrolment[] = [];
  for (const item of enrolments) {
    const card = visible.get(item.courseId);
    if (!card || item.status === "withdrawn") continue;
    mine.push({
      ...item,
      percent: item.totalSteps === 0 ? 0 : Math.round((item.completedSteps / item.totalSteps) * 100),
      tagline: card.tagline,
      category: card.category,
      estimatedMinutes: card.estimatedMinutes,
    });
  }

  const newIsThisWeek = thisWeek.length > 0;
  const newCourses = newIsThisWeek ? thisWeek : await catalogueCoursesForLearner(ctx, learnerId, { sort: "new", limit: 4 });

  // Notices are a convenience on this page. If they cannot be read, the rest of home still works.
  let notices: NotificationItem[] = [];
  try {
    notices = await listNotifications(ctx, learnerId, { unreadOnly: true, limit: 5 });
  } catch (error) {
    logWarn("learner_home.notices_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }

  return {
    continueLearning: mine.filter((item) => item.status === "active"),
    finished: mine.filter((item) => item.status === "completed"),
    madeForYou,
    newCourses,
    newIsThisWeek,
    freeCourses: free.items.filter((item) => !item.enrolled).slice(0, 4),
    saved,
    notices,
  };
}
