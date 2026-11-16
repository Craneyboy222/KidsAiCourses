// CONTRACT — owner: parents slice. See _contract.ts.
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import type { SetupGuide } from "@/content/schema";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { course, toolApproval, unlockRequest, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { resolveCourseMedia, type CourseMedia } from "./course-page";
import { loadVersionContent } from "./course-store";
import { courseVersionFor, loadCourseTools } from "./course-tools";
import { decideToolApproval, listToolApprovals, revokeToolApproval, type ToolApprovalView } from "./tool-approval";
import { getToolsBySlugs, isUrlAllowedForTool, type ToolRow } from "./tools";
import { decideUnlockRequest, listUnlockRequests, nextStepAfterDecision, type UnlockRequestView } from "./unlock-requests";

/**
 * The approvals inbox (spec 3.6): tool consents, parent-operated account confirmations and unlock
 * requests in one list. Nothing is decided here: each decision goes to the service that owns the
 * record (`tool-approval.ts`, `unlock-requests.ts`), which checks the family, writes the audit
 * entry and tells the child in the app.
 */

/** Children whose accounts are gone or going do not have anything left to approve. */
const CLOSED_STATUSES = ["deleted", "pending_deletion"] as const;

/**
 * Everything waiting for a parent's decision: tool consents, parent-operated account
 * confirmations and unlock requests (spec 3.6). Used for the badge in the parent shell.
 */
export async function countPendingApprovals(ctx: Ctx, familyId: string): Promise<number> {
  assertCan(ctx.actor, "family.read", { familyId });
  const [[tools], [unlocks]] = await Promise.all([
    ctx.db
      .select({ n: count() })
      .from(toolApproval)
      .innerJoin(user, eq(user.id, toolApproval.learnerId))
      .where(and(eq(toolApproval.familyId, familyId), eq(toolApproval.status, "pending"), notInArray(user.status, [...CLOSED_STATUSES]))),
    ctx.db
      .select({ n: count() })
      .from(unlockRequest)
      .innerJoin(user, eq(user.id, unlockRequest.learnerId))
      .where(and(eq(unlockRequest.familyId, familyId), eq(unlockRequest.status, "pending"), notInArray(user.status, [...CLOSED_STATUSES]))),
  ]);
  return Number(tools?.n ?? 0) + Number(unlocks?.n ?? 0);
}

export type ApprovalKind = "tool_consent" | "parent_operated" | "paid_course" | "pro_course";
export type ApprovalSource = "tool" | "unlock";

/** What the Tool Register says about a tool, for the parent to read before deciding. Never the staff notes. */
export type ApprovalToolFacts = {
  slug: string;
  name: string;
  vendorDomain: string | null;
  /** The official link, only when it is on the tool's allow-list. */
  officialUrl: string | null;
  cost: string | null;
  freeTier: string | null;
  /** The youngest age the vendor's own terms allow. */
  minAge: number | null;
  /** What the vendor's terms say about consent for younger users, as recorded by our reviewer. */
  consentRule: string | null;
  lastCheckedAt: Date | null;
  /** False when the tool has been withdrawn since the request was made: it can be declined but not approved. */
  available: boolean;
};

export type ApprovalItem = {
  /** `tool:<id>` or `unlock:<id>`: unique across both sources. */
  key: string;
  source: ApprovalSource;
  id: string;
  kind: ApprovalKind;
  learnerId: string;
  learnerNickname: string;
  courseId: string;
  courseTitle: string;
  status: "pending" | "approved" | "declined" | "revoked";
  requestedAt: Date;
  decidedAt: Date | null;
  /** Present for the two tool kinds. */
  tool: ApprovalToolFacts | null;
  /** Where the setup guide for this tool can be read. Present for the two tool kinds. */
  guideHref: string | null;
};

export const approvalGuideHref = (approvalId: string): string => `/parent/approvals/${approvalId}/guide`;

function toolFacts(row: ToolRow | undefined, view: ToolApprovalView): ApprovalToolFacts {
  if (!row) {
    return { slug: view.toolSlug, name: view.toolName, vendorDomain: null, officialUrl: null, cost: null, freeTier: null, minAge: null, consentRule: null, lastCheckedAt: null, available: false };
  }
  const usable = row.status === "approved" && (row.under18Policy === "parent_consent_required" || row.under18Policy === "parent_operated");
  return {
    slug: row.slug,
    name: row.name,
    vendorDomain: row.vendorDomain,
    officialUrl: row.officialUrl !== null && isUrlAllowedForTool(row, row.officialUrl) ? row.officialUrl : null,
    cost: row.cost,
    freeTier: row.freeTier,
    minAge: row.minAge,
    consentRule: row.consentRule,
    lastCheckedAt: row.lastCheckedAt,
    available: usable,
  };
}

function fromTool(view: ToolApprovalView, row: ToolRow | undefined): ApprovalItem {
  return {
    key: `tool:${view.id}`,
    source: "tool",
    id: view.id,
    kind: view.policy === "parent_operated" ? "parent_operated" : "tool_consent",
    learnerId: view.learnerId,
    learnerNickname: view.learnerNickname,
    courseId: view.courseId,
    courseTitle: view.courseTitle,
    status: view.status,
    requestedAt: view.requestedAt,
    decidedAt: view.decidedAt,
    tool: toolFacts(row, view),
    guideHref: approvalGuideHref(view.id),
  };
}

function fromUnlock(view: UnlockRequestView): ApprovalItem {
  return {
    key: `unlock:${view.id}`,
    source: "unlock",
    id: view.id,
    kind: view.kind,
    learnerId: view.learnerId,
    learnerNickname: view.learnerNickname,
    courseId: view.courseId,
    courseTitle: view.courseTitle,
    status: view.status,
    requestedAt: view.createdAt,
    decidedAt: null,
    tool: null,
    guideHref: null,
  };
}

/**
 * Both kinds of request for one family, newest first, pending ones before answered ones.
 * `learnerId` narrows the list to one child. Requests from children whose accounts are being
 * deleted are left out.
 */
export async function listApprovals(ctx: Ctx, familyId: string, opts: { status?: "pending"; learnerId?: string } = {}): Promise<ApprovalItem[]> {
  assertCan(ctx.actor, "family.read", { familyId });
  const filter = opts.status ? { status: opts.status } : undefined;
  const [tools, unlocks] = await Promise.all([listToolApprovals(ctx, familyId, filter), listUnlockRequests(ctx, familyId, filter)]);

  const learnerIds = [...new Set([...tools.map((view) => view.learnerId), ...unlocks.map((view) => view.learnerId)])];
  const closed = new Set<string>();
  if (learnerIds.length > 0) {
    const rows = await ctx.db.select({ id: user.id }).from(user).where(and(inArray(user.id, learnerIds), inArray(user.status, [...CLOSED_STATUSES])));
    for (const row of rows) closed.add(row.id);
  }
  const wanted = (learnerId: string) => !closed.has(learnerId) && (opts.learnerId === undefined || opts.learnerId === learnerId);

  const register = await getToolsBySlugs(ctx, tools.map((view) => view.toolSlug));
  const items = [...tools.filter((view) => wanted(view.learnerId)).map((view) => fromTool(view, register.get(view.toolSlug))), ...unlocks.filter((view) => wanted(view.learnerId)).map(fromUnlock)];
  return items.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.requestedAt.getTime() - a.requestedAt.getTime());
}

export type ApprovalDecisionInput = { source: ApprovalSource; id: string; decision: "approve" | "decline"; parentWillOperate?: boolean };
export type ApprovalDecisionResult = { source: ApprovalSource; id: string; status: ApprovalItem["status"]; learnerNickname: string; courseTitle: string; toolName: string | null; nextHref: string | null };

/**
 * One door for a parent's decision on either kind of request. The owning service makes the family
 * check (another family's request answers "not found"), records it and notifies the child in-app.
 */
export async function decideApproval(ctx: Ctx, input: ApprovalDecisionInput): Promise<ApprovalDecisionResult> {
  if (input.source === "tool") {
    const view = await decideToolApproval(ctx, input.id, input.decision, { parentWillOperate: input.parentWillOperate });
    return { source: "tool", id: view.id, status: view.status, learnerNickname: view.learnerNickname, courseTitle: view.courseTitle, toolName: view.toolName, nextHref: null };
  }
  // An unlock request is found by id, so it is checked against the family before anything else:
  // another family's request must look exactly like one that does not exist.
  const [row] = await ctx.db.select({ familyId: unlockRequest.familyId }).from(unlockRequest).where(eq(unlockRequest.id, input.id)).limit(1);
  if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
  if (!row || (ctx.actor.type === "parent" && ctx.actor.familyId !== row.familyId)) {
    throw new AppError("not_found", "That request could not be found. It may have been withdrawn.");
  }
  const view = await decideUnlockRequest(ctx, input.id, input.decision);
  return { source: "unlock", id: view.id, status: view.status, learnerNickname: view.learnerNickname, courseTitle: view.courseTitle, toolName: null, nextHref: nextStepAfterDecision(view)?.href ?? null };
}

/** Removes an approval a parent gave earlier. The child is told, and further setup steps are blocked (spec 3.3). */
export async function revokeApproval(ctx: Ctx, approvalId: string): Promise<ApprovalDecisionResult> {
  const view = await revokeToolApproval(ctx, approvalId);
  return { source: "tool", id: view.id, status: view.status, learnerNickname: view.learnerNickname, courseTitle: view.courseTitle, toolName: view.toolName, nextHref: null };
}

export type ToolGuideForParent = {
  approval: ApprovalItem;
  /** What the course uses the tool for, in the course author's words. */
  purpose: string | null;
  /** The setup guide from the published course, steps in order. Null when the course has none for this tool. */
  guide: (Pick<SetupGuide, "id" | "title" | "lastVerifiedAt"> & { steps: SetupGuide["steps"] }) | null;
  /** Signed links for the guide's screenshots. */
  media: CourseMedia;
};

/**
 * The setup guide for the tool a parent is asked to approve or to run themselves (spec 3.3:
 * "`parent_operated` guides are written for the parent"). Read from the published version the
 * child is on, so the parent sees exactly the steps the child will be shown. Found through the
 * approval, so a parent can only ever open guides for requests in their own family.
 */
export async function getToolGuideForParent(ctx: Ctx, approvalId: string): Promise<ToolGuideForParent> {
  if (ctx.actor.type !== "parent") {
    if (ctx.actor.type === "anonymous") throw new AppError("unauthenticated", "Please sign in to carry on.");
    throw new AppError("forbidden", "That page is for parent and carer accounts.");
  }
  const { familyId } = ctx.actor;
  const notFound = new AppError("not_found", "That request could not be found. It may have been removed.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId)) throw notFound;
  const [row] = await ctx.db.select({ familyId: toolApproval.familyId }).from(toolApproval).where(eq(toolApproval.id, approvalId)).limit(1);
  if (!row || row.familyId !== familyId) throw notFound;
  const approval = (await listApprovals(ctx, familyId)).find((item) => item.source === "tool" && item.id === approvalId);
  if (!approval || !approval.tool) throw notFound;

  const [target] = await ctx.db.select({ id: course.id, publishedVersionId: course.publishedVersionId }).from(course).where(eq(course.id, approval.courseId)).limit(1);
  const versionId = target ? await courseVersionFor(ctx, approval.learnerId, target) : null;
  if (!versionId) return { approval, purpose: null, guide: null, media: {} };

  let purpose: string | null = null;
  let guide: ToolGuideForParent["guide"] = null;
  let media: CourseMedia = {};
  try {
    const entries = await loadCourseTools(ctx, versionId);
    purpose = entries.find((entry) => entry.tool.slug === approval.tool?.slug || entry.fallback?.slug === approval.tool?.slug)?.purpose ?? null;
    const content = await loadVersionContent(ctx, versionId);
    const found = content.setupGuides.find((entry) => entry.toolSlug === approval.tool?.slug);
    if (found) {
      const steps = [...found.steps].sort((a, b) => a.order - b.order);
      guide = { id: found.id, title: found.title, lastVerifiedAt: found.lastVerifiedAt, steps };
      media = await resolveCourseMedia(ctx, steps.flatMap((step) => step.screenshotAssetIds ?? []));
    }
  } catch (error) {
    // The decision screen still works without the guide; the page says it could not be shown.
    logWarn("approvals.guide_unavailable", { approvalId, error: error instanceof Error ? error.message : String(error) });
  }
  return { approval, purpose, guide, media };
}
