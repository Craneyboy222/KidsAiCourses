import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { decideToolApproval, revokeToolApproval } from "@/server/services/tool-approval";
import { parentApiCtx } from "../../_lib/actors";
import { NO_STORE } from "../../_lib/learner";

/**
 * PATCH /api/v1/tool-approvals/:id `{ action: "approve" | "decline" | "revoke", parentWillOperate? }`
 * — a parent decides, or removes an approval. For a parent-operated tool, approving needs
 * `parentWillOperate: true`. Another family's request answers 404.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ action: z.enum(["approve", "decline", "revoke"]), parentWillOperate: z.boolean().optional() });

export const PATCH = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await parentApiCtx(req);
  const id = z.uuid().parse((await context.params).id);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "tool_approval.decide", { limit: 60, windowSec: 3600 });
  const approval = input.action === "revoke" ? await revokeToolApproval(ctx, id) : await decideToolApproval(ctx, id, input.action, { parentWillOperate: input.parentWillOperate });
  return Response.json({ approval }, NO_STORE);
});
