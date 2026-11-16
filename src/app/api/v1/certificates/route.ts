import { handle } from "@/server/http";
import { listCertificates } from "@/server/services/certificate";
import { learnerIdFor, sessionApiCtx } from "../_lib/actors";
import { NO_STORE } from "../_lib/learner";

/** GET /api/v1/certificates[?learnerId=] — a learner's certificates, for the learner, their parents and authorised staff. */
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const ctx = await sessionApiCtx(req);
  return Response.json({ certificates: await listCertificates(ctx, learnerIdFor(ctx, req)) }, NO_STORE);
});
