import { after } from "next/server";
import { z } from "zod";
import { SAFETY_BANDS } from "@/server/authz/actor";
import { resolveCtx } from "@/server/context";
import { getCoachProxy } from "@/server/ai/deps";
import { MAX_MESSAGE_CHARS } from "@/server/ai/proxy";
import { coachResponse } from "@/server/ai/wire";
import { handle } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";

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

/**
 * The pipeline, not this schema, enforces the real limit (`MAX_MESSAGE_CHARS`). A message that is
 * too long must still reach it, because the pipeline checks for a crisis disclosure before it
 * turns anyone away: a child who pours out a long message must get the support script, not
 * "that's too long". This cap only keeps absurd request bodies out.
 */
const HTTP_MESSAGE_LIMIT = MAX_MESSAGE_CHARS * 10;
const FLOOD_LIMIT_PER_MIN = 60;

const bodySchema = z.strictObject({
  courseSlug: z.string().min(1).max(120),
  stepKey: z.string().min(1).max(80),
  message: z.string().trim().min(1, "Type a question for Coach first.").max(HTTP_MESSAGE_LIMIT, "That message is too long for Coach. Try a shorter one — under 2,000 characters."),
  conversationId: z.uuid().optional(),
  preview: z.strictObject({ versionId: z.uuid(), asBand: z.enum(SAFETY_BANDS).optional(), turn: z.number().int().min(0).max(50).optional() }).optional(),
});

export const POST = handle(async (req) => {
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  const ctx = await resolveCtx(req.headers);
  // A flood guard only, far above anything a person can type (the pipeline's own limits are much
  // lower, and it checks for a disclosure before it applies them). Without it, requests that are
  // turned away before stage 3 — signed out, paused, AI break — would never be limited at all.
  await rateLimit(ctx, "coach.chat.flood", { limit: FLOOD_LIMIT_PER_MIN, windowSec: 60 });
  const result = await getCoachProxy().chat(ctx, {
    ...input,
    feature: "tutor",
    idempotencyKey: req.headers.get("idempotency-key")?.slice(0, 100) || undefined,
  });
  // Opening a safeguarding case must never delay the crisis script: it finishes after the response.
  after(() => result.settled);
  return coachResponse(result);
});
