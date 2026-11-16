import { after } from "next/server";
import { z } from "zod";
import { SAFETY_BANDS } from "@/server/authz/actor";
import { resolveCtx } from "@/server/context";
import { getCoachProxy } from "@/server/ai/deps";
import { MAX_MESSAGE_CHARS } from "@/server/ai/proxy";
import { coachResponse } from "@/server/ai/wire";
import { handle } from "@/server/http";

/**
 * POST /api/v1/ai/chat — one message to Coach (spec Section 8).
 *
 * The whole pipeline runs on the server first: the model's output is buffered, moderated and
 * checked for leaked solutions, and only approved text is then streamed back as Server-Sent
 * Events (`meta`, `delta`…, `done`). The learner never sees unmoderated model text.
 * When Coach is not available the answer is a JSON error, `{ error: { code, message } }`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const bodySchema = z.strictObject({
  courseSlug: z.string().min(1).max(120),
  stepKey: z.string().min(1).max(80),
  message: z.string().trim().min(1, "Type a question for Coach first.").max(MAX_MESSAGE_CHARS, "That message is too long for Coach. Try a shorter one."),
  conversationId: z.uuid().optional(),
  preview: z.strictObject({ versionId: z.uuid(), asBand: z.enum(SAFETY_BANDS).optional(), turn: z.number().int().min(0).max(50).optional() }).optional(),
});

export const POST = handle(async (req) => {
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  const ctx = await resolveCtx(req.headers);
  const result = await getCoachProxy().chat(ctx, {
    ...input,
    feature: "tutor",
    idempotencyKey: req.headers.get("idempotency-key")?.slice(0, 100) || undefined,
  });
  // Opening a safeguarding case must never delay the crisis script: it finishes after the response.
  after(() => result.settled);
  return coachResponse(result);
});
