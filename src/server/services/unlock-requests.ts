// CONTRACT — owner: payments slice. See _contract.ts.
import { and, desc, eq, inArray } from "drizzle-orm";
import { env } from "@/env";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, learnerProfile, unlockRequest, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { notify, notifyParentsOfLearner } from "@/server/notifications";
import { canAccessCourse } from "./entitlements";
import { getFamilyIdForLearner, listParentUserIds } from "./family";

export type UnlockRequestView = {
  id: string;
  learnerId: string;
  learnerNickname: string;
  kind: "paid_course" | "pro_course";
  courseId: string;
  courseTitle: string;
  status: "pending" | "approved" | "declined";
  createdAt: Date;
};

/**
 * "Ask a parent to unlock" (spec 3.7): the only thing a learner under 18 can do about a course
 * their plan does not cover, or a Pro course their parent wants to approve first. Nothing here
 * mentions a price, and nothing a learner does here grants access.
 */

/** After a parent says no, the same request is not sent again for this long: asking is not for pestering. */
export const UNLOCK_REASK_DAYS = 7;

/** Where a parent chooses a plan. Approving a paid-course request leads here. */
export const PLAN_CHOICE_PATH = "/parent/billing/plans";
const APPROVALS_PATH = "/parent/approvals";

const LIVE_STATUSES = ["published", "needs_review"] as const;

const viewColumns = {
  id: unlockRequest.id,
  learnerId: unlockRequest.learnerId,
  familyId: unlockRequest.familyId,
  learnerNickname: learnerProfile.nickname,
  kind: unlockRequest.kind,
  courseId: unlockRequest.courseId,
  courseTitle: course.title,
  status: unlockRequest.status,
  createdAt: unlockRequest.createdAt,
};

type Row = {
  id: string;
  learnerId: string;
  familyId: string;
  learnerNickname: string;
  kind: "paid_course" | "pro_course";
  courseId: string;
  courseTitle: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  createdAt: Date;
};

/** `cancelled` (the request was withdrawn, for example when the course was removed) reads as declined. */
function toView(row: Row): UnlockRequestView {
  return {
    id: row.id,
    learnerId: row.learnerId,
    learnerNickname: row.learnerNickname,
    kind: row.kind,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    status: row.status === "cancelled" ? "declined" : row.status,
    createdAt: row.createdAt,
  };
}

const selectRows = (db: Db) =>
  db.select(viewColumns).from(unlockRequest).innerJoin(course, eq(course.id, unlockRequest.courseId)).innerJoin(learnerProfile, eq(learnerProfile.userId, unlockRequest.learnerId));

async function loadRow(db: Db, requestId: string): Promise<Row | null> {
  const [row] = await selectRows(db).where(eq(unlockRequest.id, requestId)).limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 4 && typeof e === "object" && e !== null; depth += 1) {
    if ("code" in e && (e as { code: unknown }).code === "23505") return true;
    e = "cause" in e ? (e as { cause: unknown }).cause : null;
  }
  return false;
}

/** "Ask a parent to unlock": the only thing an under-18 can do about locked content. Notifies the parents. Idempotent while one is pending. */
export async function requestUnlock(ctx: Ctx, input: { learnerId: string; courseId: string; kind: "paid_course" | "pro_course" }): Promise<UnlockRequestView> {
  assertCan(ctx.actor, "learner.unlock.request", { learnerId: input.learnerId });

  const familyId = await getFamilyIdForLearner(ctx, input.learnerId);
  if (!familyId) {
    throw new AppError("parent_approval_required", "Your parent or carer needs to approve your account first. Once they have, you can ask them about this course.");
  }
  if ((await listParentUserIds(ctx, familyId)).length === 0) {
    // An 18-year-old with their own account has nobody to ask: they manage their own plan.
    throw new AppError("invalid_input", "There's no parent or carer linked to your account, so there's nobody to ask. You can manage your own plan from Settings.");
  }

  const [target] = await ctx.db
    .select({ id: course.id, title: course.title, isFree: course.isFree, difficulty: course.difficulty })
    .from(course)
    .where(and(eq(course.id, input.courseId), inArray(course.status, [...LIVE_STATUSES])))
    .limit(1);
  if (!target) throw new AppError("not_found", "We couldn't find that course. It may have been moved or removed.");
  if (input.kind === "pro_course" && target.difficulty !== "pro") {
    throw new AppError("invalid_input", "That course doesn't need a parent's OK. You can start it from its page.");
  }
  if (input.kind === "paid_course" && (await canAccessCourse(ctx, input.learnerId, { id: target.id, isFree: target.isFree }))) {
    throw new AppError("conflict", "Good news: this course is already unlocked for you. Open it from its page.");
  }

  const mine = and(eq(unlockRequest.learnerId, input.learnerId), eq(unlockRequest.courseId, input.courseId), eq(unlockRequest.kind, input.kind));
  const [latest] = await selectRows(ctx.db).where(mine).orderBy(desc(unlockRequest.createdAt)).limit(1);
  if (latest?.status === "pending") return toView(latest);
  if (latest?.status === "approved" && input.kind === "pro_course") return toView(latest);
  if (latest?.status === "declined") {
    const [decided] = await ctx.db.select({ decidedAt: unlockRequest.decidedAt }).from(unlockRequest).where(eq(unlockRequest.id, latest.id)).limit(1);
    const since = decided?.decidedAt ?? latest.createdAt;
    // Asked and answered recently: show the answer again rather than sending the parents another request.
    if (ctx.now.getTime() - since.getTime() < UNLOCK_REASK_DAYS * 24 * 60 * 60 * 1000) return toView(latest);
  }

  let createdId: string;
  try {
    const [created] = await ctx.db
      .insert(unlockRequest)
      .values({ learnerId: input.learnerId, familyId, courseId: input.courseId, kind: input.kind, status: "pending", createdAt: ctx.now, updatedAt: ctx.now })
      .returning({ id: unlockRequest.id });
    if (!created) throw new Error("requestUnlock: the insert returned nothing");
    createdId = created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Two taps at once: the other one made the request. Return it and do not notify twice.
    const [existing] = await selectRows(ctx.db).where(and(mine, eq(unlockRequest.status, "pending"))).limit(1);
    if (!existing) throw error;
    return toView(existing);
  }

  const row = await loadRow(ctx.db, createdId);
  if (!row) throw new Error("requestUnlock: the new request could not be read back");

  // Telling the parents must not undo the request if an email fails: they also see it in their approvals inbox.
  try {
    await notifyParentsOfLearner(ctx, input.learnerId, {
      type: "unlock.requested",
      title: `${row.learnerNickname} has asked to unlock a course`,
      body:
        input.kind === "pro_course"
          ? `${row.learnerNickname} would like to start "${row.courseTitle}", a Pro course. You asked to approve Pro courses first.`
          : `${row.learnerNickname} would like to take "${row.courseTitle}", which isn't included in what your family has at the moment.`,
      href: APPROVALS_PATH,
      emailTemplate: "unlock_request",
      emailData: { childName: row.learnerNickname, courseTitle: row.courseTitle, url: `${env.NEXT_PUBLIC_APP_URL}${APPROVALS_PATH}` },
      dedupeKey: `unlock:${row.id}`,
    });
  } catch (error) {
    logError("unlock.notify_failed", error, { requestId: row.id });
  }
  return toView(row);
}

export async function listUnlockRequests(ctx: Ctx, familyId: string, opts?: { status?: "pending" }): Promise<UnlockRequestView[]> {
  assertCan(ctx.actor, "family.read", { familyId });
  const rows = await selectRows(ctx.db)
    .where(and(eq(unlockRequest.familyId, familyId), opts?.status ? eq(unlockRequest.status, opts.status) : undefined))
    .orderBy(desc(unlockRequest.createdAt));
  return rows.map(toView);
}

/** Approving a paid-course request does not grant access by itself: it takes the parent to the plan choice. Approving a Pro-course request does. */
export async function decideUnlockRequest(ctx: Ctx, requestId: string, decision: "approve" | "decline"): Promise<UnlockRequestView> {
  const found = await loadRow(ctx.db, requestId);
  if (!found) throw new AppError("not_found", "That request could not be found. It may have been withdrawn.");
  assertCan(ctx.actor, "family.approval.decide", { familyId: found.familyId });

  const status = decision === "approve" ? "approved" : "declined";
  const outcome = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: unlockRequest.status }).from(unlockRequest).where(eq(unlockRequest.id, requestId)).limit(1).for("update");
    if (!locked) throw new AppError("not_found", "That request could not be found. It may have been withdrawn.");
    if (locked.status === status) return { changed: false };
    if (locked.status !== "pending") {
      throw new AppError("conflict", "That request has already been answered. Refresh the page to see where it stands.");
    }
    const decidedBy = ctx.actor.type === "parent" || ctx.actor.type === "staff" ? ctx.actor.userId : null;
    await tx.update(unlockRequest).set({ status, decidedAt: ctx.now, decidedBy, updatedAt: ctx.now }).where(eq(unlockRequest.id, requestId));
    // A Pro-course approval opens the course to the learner, so it is on the record like any other change to access.
    await audit(ctx, { action: "unlock.decide", targetType: "unlock_request", targetId: requestId, meta: { decision, kind: found.kind, learnerId: found.learnerId, courseId: found.courseId } }, tx);
    return { changed: true };
  });

  const view = toView({ ...found, status });
  if (outcome.changed) {
    try {
      await notifyLearnerOfDecision(ctx, view);
    } catch (error) {
      logError("unlock.notify_failed", error, { requestId });
    }
  }
  return view;
}

/**
 * What the learner hears. Never a price, and never "it's unlocked" until it really is: for a
 * paid course that happens when the plan changes (`resolvePaidUnlocksForFamily`).
 */
async function notifyLearnerOfDecision(ctx: Pick<Ctx, "db" | "now">, view: UnlockRequestView): Promise<void> {
  if (view.status === "declined") {
    await notify(ctx, {
      userId: view.learnerId,
      type: "unlock.declined",
      title: "Not this one for now",
      body: `Your parent or carer said no to "${view.courseTitle}" for now. There's plenty more to try.`,
      href: "/explore",
      dedupeKey: `unlock-decided:${view.id}`,
    });
    return;
  }
  if (view.kind === "pro_course") {
    await notify(ctx, {
      userId: view.learnerId,
      type: "unlock.approved",
      title: "You've got the OK",
      body: `Your parent or carer said yes to "${view.courseTitle}". You can start it now.`,
      href: "/explore",
      dedupeKey: `unlock-decided:${view.id}`,
    });
  }
}

/** For the parent's screens: where to go after a decision. Only an approved paid-course request leads anywhere. */
export function nextStepAfterDecision(view: Pick<UnlockRequestView, "kind" | "status">): { href: string } | null {
  return view.kind === "paid_course" && view.status === "approved" ? { href: PLAN_CHOICE_PATH } : null;
}

/**
 * Called by the Stripe webhook handler when a family's plan starts to cover the full catalogue:
 * every open paid-course request is settled as approved and each learner is told the course is
 * open. Runs as the system actor, inside the webhook's transaction.
 */
export async function resolvePaidUnlocksForFamily(ctx: Pick<Ctx, "db" | "now">, familyId: string): Promise<UnlockRequestView[]> {
  const open = await selectRows(ctx.db).where(and(eq(unlockRequest.familyId, familyId), eq(unlockRequest.kind, "paid_course"), eq(unlockRequest.status, "pending")));
  if (open.length === 0) return [];
  await ctx.db
    .update(unlockRequest)
    .set({ status: "approved", decidedAt: ctx.now, updatedAt: ctx.now })
    .where(
      inArray(
        unlockRequest.id,
        open.map((row) => row.id),
      ),
    );
  return open.map((row) => toView({ ...row, status: "approved" }));
}

/** Tells learners that a paid course they asked about is now open. Call after the plan change has been saved. */
export async function notifyPaidUnlocks(ctx: Pick<Ctx, "db" | "now">, views: UnlockRequestView[]): Promise<void> {
  for (const view of views) {
    await notify(ctx, {
      userId: view.learnerId,
      type: "unlock.approved",
      title: "It's unlocked",
      body: `"${view.courseTitle}" is now open for you. You can start it whenever you like.`,
      href: "/explore",
      dedupeKey: `unlock-open:${view.id}`,
    });
  }
}
