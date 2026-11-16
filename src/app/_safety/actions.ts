"use server";

import { z } from "zod";
import { runAction } from "@/server/action";
import { requireSession } from "@/server/context";
import { tDefault } from "@/server/copy";
import { checkRateLimit, rateLimit } from "@/server/ratelimit";
import { createReport, MAX_REPORT_NOTE, REPORT_REASONS, REPORT_TARGET_TYPES } from "@/server/services/reports";

const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS as [string, ...string[]]),
  target: z.object({
    type: z.enum(REPORT_TARGET_TYPES as [string, ...string[]]),
    id: z.string().min(1).max(100),
    courseId: z.string().max(64).optional(),
    stepKey: z.string().max(64).optional(),
    toolSlug: z.string().max(80).optional(),
  }),
  note: z.string().max(MAX_REPORT_NOTE).optional(),
});

export type SendReportResult = { ok: true; showCrisisScript: boolean } | { ok: false; message: string };

/**
 * Sends a report from the Report control (spec 3.10). Lives outside the route groups because the
 * control sits on learner, parent and staff screens alike.
 *
 * "Someone is in danger" has its own, much higher limit, and if even that is reached the reporter
 * is still told where to get help: a limit must never be the last thing a frightened child reads.
 */
export async function sendReportAction(input: { reason: string; target: { type: string; id: string; courseId?: string; stepKey?: string; toolSlug?: string }; note?: string }): Promise<SendReportResult> {
  const danger = input.reason === "someone_in_danger";
  const result = await runAction(async () => {
    const parsed = reportSchema.parse(input);
    const ctx = await requireSession();
    if (danger) {
      const limit = await checkRateLimit(ctx, "report.danger", { limit: 30, windowSec: 3600 });
      if (!limit.allowed) return { limited: true as const };
    } else {
      await rateLimit(ctx, "report.create", { limit: 15, windowSec: 3600 });
    }
    const reason = REPORT_REASONS.find((entry) => entry === parsed.reason);
    const type = REPORT_TARGET_TYPES.find((entry) => entry === parsed.target.type);
    if (!reason || !type) throw new z.ZodError([]);
    const created = await createReport(ctx, { reason, target: { ...parsed.target, type }, note: parsed.note });
    return { limited: false as const, showCrisisScript: created.showCrisisScript };
  });
  if (!result.ok) return { ok: false, message: danger ? `${result.error.message} ${tDefault("report.danger.help")}` : result.error.message };
  if (result.data.limited) return { ok: false, message: `You've sent a lot of reports in a short time, so this one wasn't sent. ${tDefault("report.danger.help")}` };
  return { ok: true, showCrisisScript: result.data.showCrisisScript };
}
