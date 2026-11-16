import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { getProject } from "@/server/services/portfolio";
import { sessionApiCtx } from "../../_lib/actors";
import { NO_STORE } from "../../_lib/learner";

/** GET /api/v1/projects/:id — one project with its brief, evidence, rubric self-check and status. 404 for anything the caller may not see. */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await sessionApiCtx(req);
  const project = await getProject(ctx, (await context.params).id);
  if (!project) throw new AppError("not_found", "That project could not be found.");
  return Response.json({ project }, NO_STORE);
});
