import { handle } from "@/server/http";
import { listProjects } from "@/server/services/portfolio";
import { learnerIdFor, sessionApiCtx } from "../_lib/actors";
import { NO_STORE } from "../_lib/learner";

/**
 * GET /api/v1/projects[?learnerId=] — a learner's portfolio (spec 3.4). The learner sees their own
 * projects, including work still being checked; a parent or carer names their child and sees
 * accepted projects only. Private: there is no public or shared listing.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const ctx = await sessionApiCtx(req);
  return Response.json({ projects: await listProjects(ctx, learnerIdFor(ctx, req)) }, NO_STORE);
});
