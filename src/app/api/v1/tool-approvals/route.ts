import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { listToolApprovals, requestToolApproval } from "@/server/services/tool-approval";
import { parentApiCtx } from "../_lib/actors";
import { NO_STORE, learnerApiCtx } from "../_lib/learner";

/**
 * GET /api/v1/tool-approvals[?status=pending] — a parent's own family's tool approvals.
 * POST /api/v1/tool-approvals `{ courseId, toolSlug }` — a learner asks a parent to approve a tool
 * for a course (spec 3.3). Asking again while a request is pending changes nothing.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ courseId: z.uuid(), toolSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/) });

export const GET = handle(async (req) => {
  const ctx = await parentApiCtx(req);
  const pending = new URL(req.url).searchParams.get("status") === "pending";
  return Response.json({ approvals: await listToolApprovals(ctx, ctx.actor.familyId, pending ? { status: "pending" } : undefined) }, NO_STORE);
});

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "tool_approval.request", { limit: 10, windowSec: 3600 });
  return Response.json({ approval: await requestToolApproval(ctx, { learnerId: ctx.actor.userId, ...input }) }, NO_STORE);
});
