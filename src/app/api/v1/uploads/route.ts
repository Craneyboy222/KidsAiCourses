import { z } from "zod";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { requestUpload } from "@/server/services/submission";
import { NO_STORE, learnerApiCtx } from "../_lib/learner";

/**
 * POST /api/v1/uploads `{ enrolmentId, stepId, kind, contentType, sizeBytes }` — a short-lived
 * signed link to PUT one file to. The type and size are checked now and again, against the real
 * bytes, when `/api/v1/uploads/:id/complete` is called. No file name is sent or kept.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ enrolmentId: z.uuid(), stepId: z.uuid(), kind: z.enum(["screenshot", "file", "video"]), contentType: z.string().max(200), sizeBytes: z.number().int().positive() });

export const POST = handle(async (req) => {
  const ctx = await learnerApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  await rateLimit(ctx, "evidence.upload", { limit: 40, windowSec: 3600 });
  const ticket = await requestUpload(ctx, input);
  return Response.json({ artefactId: ticket.artefactId, upload: ticket.upload }, { status: 201, ...NO_STORE });
});
