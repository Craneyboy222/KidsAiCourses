import { resolveCtx } from "@/server/context";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getExportDownload } from "@/server/services/data-request";

/**
 * GET /api/v1/data-requests/:id/download — hands a finished data export to the person it belongs
 * to: a signed-in parent or carer of the same family, or the 18-year-old who asked for their own.
 * Redirects to a signed storage link that works for two minutes. The seven days a download stays
 * available are checked here on every request, and every download is written to the audit log.
 *
 * Someone who is not signed in is sent to sign in, then to their Privacy page: the emailed link
 * never carries the file or a key to it. Any other request, including one from another family,
 * answers 404.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await resolveCtx(req.headers);
  if (ctx.actor.type === "anonymous") {
    return new Response(null, { status: 303, headers: { Location: "/signin?as=parent&next=%2Fparent%2Fprivacy", "Cache-Control": "no-store" } });
  }
  await rateLimit(ctx, "data.export.download", { limit: 20, windowSec: 600 });
  const { url } = await getExportDownload(ctx, (await context.params).id);
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
});
