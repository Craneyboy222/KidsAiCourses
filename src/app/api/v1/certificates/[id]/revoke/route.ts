import { z } from "zod";
import { handle } from "@/server/http";
import { revokeCertificate } from "@/server/services/certificate";
import { staffApiCtx } from "../../../_lib/actors";
import { NO_STORE } from "../../../_lib/learner";

/** POST /api/v1/certificates/:id/revoke `{ reason }` — staff withdraw a certificate. The reason is required and audited. */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ reason: z.string().min(5).max(500) });

export const POST = handle(async (req: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await staffApiCtx(req);
  const id = z.uuid().parse((await context.params).id);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  return Response.json({ certificate: await revokeCertificate(ctx, id, input.reason) }, NO_STORE);
});
