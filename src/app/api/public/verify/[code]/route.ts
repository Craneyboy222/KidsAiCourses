import { resolveCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { verifyCertificate } from "@/server/services/certificate";

/**
 * GET /api/public/verify/:code — public certificate check (spec Section 13). Answers with the
 * name on the certificate (first name or nickname), the course, the date and whether it has been
 * revoked, and nothing else. An unknown code and a malformed one both answer 404. Rate limited by
 * address; never cached or indexed.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

export const GET = handle(async (req: Request, context: { params: Promise<{ code: string }> }) => {
  const ctx = await resolveCtx(req.headers);
  await rateLimit(ctx, "certificate.verify", { limit: 30, windowSec: 600 });
  const { code } = await context.params;
  const found = code.length <= 64 ? await verifyCertificate(ctx, code) : null;
  if (!found) throw new AppError("not_found", "We couldn't find a certificate with that code. Check it and try again.");
  return Response.json({ displayName: found.displayName, courseTitle: found.courseTitle, issuedAt: found.issuedAt.toISOString(), revoked: found.revoked }, { headers: HEADERS });
});
