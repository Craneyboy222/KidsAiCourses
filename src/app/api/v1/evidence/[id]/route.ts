import { z } from "zod";
import { handle } from "@/server/http";
import { removeEvidence } from "@/server/services/submission";
import { NO_STORE, learnerApiCtx } from "../../_lib/learner";

/** DELETE /api/v1/evidence/:id — take something out of a draft. Evidence that has been sent in cannot be removed. */
export const dynamic = "force-dynamic";

export const DELETE = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await learnerApiCtx(req);
  await removeEvidence(ctx, { artefactId: z.uuid().parse((await context.params).id) });
  return Response.json({ ok: true }, NO_STORE);
});
