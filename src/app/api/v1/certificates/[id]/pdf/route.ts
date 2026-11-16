import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getCertificatePdf } from "@/server/services/certificate";
import { sessionApiCtx } from "../../../_lib/actors";

/**
 * GET /api/v1/certificates/:id/pdf — the certificate as a PDF: name as the learner chose it,
 * course, date and the public check link. A withdrawn certificate cannot be downloaded.
 */
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await sessionApiCtx(req);
  await rateLimit(ctx, "certificate.pdf", { limit: 30, windowSec: 600 });
  const pdf = await getCertificatePdf(ctx, (await context.params).id);
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.fileName}"`,
      "Content-Length": String(pdf.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
});
