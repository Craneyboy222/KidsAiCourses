import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { addLinkEvidence } from "@/server/services/submission";
import { NO_STORE, learnerApiCtx } from "../../_lib/learner";

/**
 * POST /api/v1/evidence/links `{ enrolmentId, stepId, url, declaredNoPeople }` — add a link as
 * evidence. The link must be https and on the public internet; `declaredNoPeople` must be true.
 * The link is never fetched.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ enrolmentId: z.uuid(), stepId: z.uuid(), url: z.string().max(2100), declaredNoPeople: z.boolean() });

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "evidence.add", { limit: 60, windowSec: 3600 });
  return Response.json({ item: await addLinkEvidence(ctx, input) }, { status: 201, ...NO_STORE });
});
