import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getArtefactDownload } from "@/server/services/portfolio";
import { sessionApiCtx } from "../../../_lib/actors";

/**
 * GET /api/v1/artefacts/:id/download[?inline=1] — redirects to a signed link that works for two
 * minutes. Only for the learner who uploaded the file, a parent or carer in their family (accepted
 * work only) and staff who moderate. Everything else, including a file that was rejected and
 * deleted, answers 404.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await sessionApiCtx(req);
  await rateLimit(ctx, "artefact.download", { limit: 120, windowSec: 600 });
  const { url } = await getArtefactDownload(ctx, (await context.params).id, { inline: new URL(req.url).searchParams.get("inline") === "1" });
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
