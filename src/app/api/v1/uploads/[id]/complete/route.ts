import { z } from "zod";
import { handle } from "@/server/http";
import { completeUpload } from "@/server/services/submission";
import { NO_STORE, learnerApiCtx } from "../../../_lib/learner";

/**
 * POST /api/v1/uploads/:id/complete — the browser says its upload has finished. This is what
 * triggers the checks: real file type against the declared type, size, hash, metadata removal and
 * people screening. A file that fails is deleted and the answer says kindly what to send instead.
 */
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await learnerApiCtx(req);
  return Response.json({ item: await completeUpload(ctx, { artefactId: z.uuid().parse((await context.params).id) }) }, NO_STORE);
});
