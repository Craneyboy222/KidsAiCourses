import { appErrorCode } from "@/lib/parents/error-code";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { listNotifications, markRead, unreadCount, type NotificationItem } from "@/server/notifications";
import { listApprovals, type ApprovalItem } from "./approvals";
import { listCertificates, type CertificateView } from "./certificate";
import { getCoachSummaryForParent, type CoachSummary } from "./coach-summary";
import { missingRequiredConsents } from "./consent";
import { getLearnerSummary, isIndependentLearner, listChildren, type LearnerSummary } from "./family";
import { getControls, type ParentControls } from "./parent-controls";
import { listProjects, type ProjectView } from "./portfolio";
import { getProgressSummary, type ProgressSummary } from "./progress-summary";
import { countSafetyNoticesForLearner } from "./safeguarding";
import { getUsageByDay } from "./usage";

/**
 * What a parent sees (spec 3.6): per child, courses in progress and finished, time this week,
 * projects, certificates, Coach use as a count and topics, safety notices and outstanding
 * approvals. Everything here is read through the services that own the data, each of which checks
 * the family again; this file adds nothing a parent could not already ask those services for.
 *
 * Never returned from here: Coach messages, notes, reflections, ethics answers, quiz answers,
 * work that has not been accepted, or anything about a safeguarding case beyond a count.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHILD_NOT_FOUND = "That child could not be found in your family.";

/**
 * The number of open safety notices for a child. The safeguarding service is another slice's and
 * may be unavailable: a dashboard that cannot load is worse than one that shows no count, and the
 * notices themselves still reach the parent by email and on the Notices page. Zero on failure.
 */
export async function safetyNoticeCount(ctx: Ctx, learnerId: string): Promise<number> {
  try {
    const count = await countSafetyNoticesForLearner(ctx, learnerId);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch (error) {
    logWarn("parent_dashboard.safety_count_unavailable", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

export type ChildOverview = {
  learner: LearnerSummary;
  /** An 18-year-old who runs their own account: shown, but not managed from here. */
  independent: boolean;
  /** The account is inside its 14-day deletion window. */
  closing: boolean;
  /** Required permissions are still to be given, so the account cannot be used yet. */
  needsConsent: boolean;
  progress: ProgressSummary;
  completedProjects: number;
  certificates: number;
  coach: CoachSummary;
  safetyNotices: number;
  pendingApprovals: number;
  controls: ParentControls;
};

export type ParentDashboard = {
  familyId: string;
  children: ChildOverview[];
  pendingApprovals: ApprovalItem[];
  unreadNotices: number;
};

async function overviewFor(ctx: Ctx, learner: LearnerSummary, pending: ApprovalItem[]): Promise<ChildOverview> {
  const { learnerId } = learner;
  const [progress, projects, certificates, coach, safetyNotices, controls, independent, missing] = await Promise.all([
    getProgressSummary(ctx, learnerId),
    listProjects(ctx, learnerId),
    listCertificates(ctx, learnerId),
    getCoachSummaryForParent(ctx, learnerId),
    safetyNoticeCount(ctx, learnerId),
    getControls(ctx, learnerId),
    isIndependentLearner(ctx, learnerId),
    missingRequiredConsents(ctx, learnerId),
  ]);
  return {
    learner,
    independent,
    closing: learner.status === "pending_deletion",
    needsConsent: missing.length > 0,
    progress,
    completedProjects: projects.filter((entry) => entry.status === "accepted").length,
    certificates: certificates.filter((entry) => entry.revokedAt === null).length,
    coach,
    safetyNotices,
    pendingApprovals: pending.filter((item) => item.learnerId === learnerId).length,
    controls,
  };
}

/** The dashboard for the signed-in parent's own family. The family comes from the session and nowhere else. */
export async function getParentDashboard(ctx: Ctx): Promise<ParentDashboard> {
  if (ctx.actor.type !== "parent") {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("forbidden", "That page is for parent and carer accounts.");
  }
  const { familyId, userId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });
  const [learners, pendingApprovals, unreadNotices] = await Promise.all([listChildren(ctx, familyId), listApprovals(ctx, familyId, { status: "pending" }), unreadCount(ctx, userId)]);
  const children: ChildOverview[] = [];
  for (const learner of learners) children.push(await overviewFor(ctx, learner, pendingApprovals));
  return { familyId, children, pendingApprovals, unreadNotices };
}

/**
 * A child of the signed-in parent's family, or "not found". Used at the top of every child page
 * and action: an id from the URL is only ever a way of choosing among the parent's own children.
 */
export async function requireOwnChild(ctx: Ctx, learnerId: string): Promise<LearnerSummary & { familyId: string }> {
  if (ctx.actor.type !== "parent") {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("forbidden", "That page is for parent and carer accounts.");
  }
  if (!UUID.test(learnerId)) throw new AppError("not_found", CHILD_NOT_FOUND);
  let learner: LearnerSummary;
  try {
    learner = await getLearnerSummary(ctx, learnerId);
  } catch (error) {
    if (appErrorCode(error) === "not_found") throw new AppError("not_found", CHILD_NOT_FOUND);
    throw error;
  }
  // Another family's child and nobody's child get the same answer, so nothing is confirmed.
  if (learner.familyId === null || learner.familyId !== ctx.actor.familyId) throw new AppError("not_found", CHILD_NOT_FOUND);
  assertCan(ctx.actor, "learner.profile.read", { learnerId, familyId: learner.familyId });
  return { ...learner, familyId: learner.familyId };
}

export type ChildDetail = ChildOverview & {
  /** The last seven UK days, oldest first. */
  usage: { date: string; seconds: number }[];
  /** Accepted projects only: work that is waiting, or was sent back, is the learner's alone. */
  projects: ProjectView[];
  certificateList: CertificateView[];
  /** Every tool and unlock request this child has made, pending first. */
  approvals: ApprovalItem[];
};

/** One child in full: progress, portfolio, Coach summary, limits and that child's requests. */
export async function getChildDetail(ctx: Ctx, learnerId: string): Promise<ChildDetail> {
  const learner = await requireOwnChild(ctx, learnerId);
  const approvals = await listApprovals(ctx, learner.familyId, { learnerId });
  const [overview, usage, projects, certificateList] = await Promise.all([
    overviewFor(ctx, learner, approvals.filter((item) => item.status === "pending")),
    getUsageByDay(ctx, learnerId, 7),
    listProjects(ctx, learnerId),
    listCertificates(ctx, learnerId),
  ]);
  return { ...overview, usage, projects: projects.filter((entry) => entry.status === "accepted"), certificateList, approvals };
}

// ── Notices ─────────────────────────────────────────────────────────────────

export type ParentNotice = NotificationItem & {
  /** `safety` for safety notices; everything else is about the account. */
  category: "safety" | "account";
  /** A link is kept only when it stays inside the parent's own area. */
  href: string | null;
};

const isSafety = (type: string) => type === "safety_notice" || type.startsWith("safety_notice.") || type.startsWith("safeguarding.");

/**
 * The signed-in parent's own notices, newest first (the notification service orders them), with
 * read state. A safety notice is shown exactly as the safeguarding team wrote it for parents: a
 * short summary and what to do. It never carries case detail, and its link can only lead to a
 * parent page, never to a case.
 */
export async function listParentNotices(ctx: Ctx, options: { limit?: number } = {}): Promise<{ notices: ParentNotice[]; unread: number }> {
  if (ctx.actor.type !== "parent") {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("forbidden", "That page is for parent and carer accounts.");
  }
  assertCan(ctx.actor, "family.notice.read", { familyId: ctx.actor.familyId });
  const [items, unread] = await Promise.all([listNotifications(ctx, ctx.actor.userId, { limit: options.limit ?? 100 }), unreadCount(ctx, ctx.actor.userId)]);
  const notices = items.map((item): ParentNotice => {
    const insideParentArea = item.href !== null && (item.href === "/parent" || item.href.startsWith("/parent/") || item.href.startsWith("/parent?") || item.href.startsWith("/parent#"));
    return { ...item, category: isSafety(item.type) ? "safety" : "account", href: insideParentArea ? item.href : null };
  });
  return { notices, unread };
}

/** Marks some of the parent's own notices, or all of them, as read. Returns how many changed. */
export async function markParentNoticesRead(ctx: Ctx, ids: string[] | "all"): Promise<number> {
  if (ctx.actor.type !== "parent") throw new AppError("forbidden", "That page is for parent and carer accounts.");
  assertCan(ctx.actor, "family.notice.read", { familyId: ctx.actor.familyId });
  if (ids !== "all" && ids.some((id) => !UUID.test(id))) throw new AppError("invalid_input", "That notice could not be found.");
  // `markRead` only ever touches rows that belong to this user, whatever ids are passed.
  return markRead(ctx, ctx.actor.userId, ids);
}
