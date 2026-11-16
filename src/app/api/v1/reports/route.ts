import { z } from "zod";
import { tDefault } from "@/server/copy";
import { handle } from "@/server/http";
import { checkRateLimit, rateLimit } from "@/server/ratelimit";
import { createReport, listOwnReports, MAX_REPORT_NOTE, REPORT_REASONS, REPORT_TARGET_TYPES } from "@/server/services/reports";
import { sessionApiCtx } from "../_lib/actors";
import { NO_STORE } from "../_lib/learner";

/**
 * GET /api/v1/reports — the caller's own reports and where each has got to.
 * POST /api/v1/reports `{ reason, target, note? }` — send a report (spec 3.10). The answer says
 * whether to show the crisis signposting; for "someone_in_danger" it always does, and the words
 * to show come back with it.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  reason: z.enum(REPORT_REASONS as [(typeof REPORT_REASONS)[number], ...(typeof REPORT_REASONS)[number][]]),
  target: z.strictObject({
    type: z.enum(REPORT_TARGET_TYPES as [(typeof REPORT_TARGET_TYPES)[number], ...(typeof REPORT_TARGET_TYPES)[number][]]),
    id: z.string().min(1).max(100),
    courseId: z.string().max(64).optional(),
    stepKey: z.string().max(64).optional(),
    toolSlug: z.string().max(80).optional(),
  }),
  note: z.string().max(MAX_REPORT_NOTE).optional(),
});

export const GET = handle(async (req) => {
  const ctx = await sessionApiCtx(req);
  return Response.json({ reports: await listOwnReports(ctx, ctx.actor.userId) }, NO_STORE);
});

export const POST = handle(async (req) => {
  const ctx = await sessionApiCtx(req);
  const input = bodySchema.parse(await req.json().catch(() => ({})));
  const help = tDefault("report.danger.help");
  if (input.reason === "someone_in_danger") {
    // A limit must never be the last thing a frightened child reads: the help text comes back either way.
    const limit = await checkRateLimit(ctx, "report.danger", { limit: 30, windowSec: 3600 });
    if (!limit.allowed) return Response.json({ error: { code: "rate_limited", message: `You've sent a lot of reports in a short time, so this one wasn't sent. ${help}` } }, { status: 429, ...NO_STORE });
  } else {
    await rateLimit(ctx, "report.create", { limit: 15, windowSec: 3600 });
  }
  const created = await createReport(ctx, input);
  return Response.json({ ...created, ...(created.showCrisisScript ? { crisisHelp: help } : {}) }, { status: 201, ...NO_STORE });
});
