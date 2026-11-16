import type { Ctx } from "@/server/context";
import { logError } from "@/server/log";
import { enqueueModeration } from "./moderation";
import { openSafeguardingCase } from "./safeguarding";

type CaseInput = Parameters<typeof openSafeguardingCase>[1];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Opens a safeguarding case and makes sure the alert is never lost. `openSafeguardingCase` is
 * designed not to throw; if it ever does, the item goes into the moderation queue as critical
 * instead, so a person is still told at once. The caller always gets an answer and carries on:
 * a child reporting danger must never be shown an error.
 */
export async function raiseSafeguarding(ctx: Ctx, input: CaseInput, fallback: { subjectType: string; subjectId: string }): Promise<{ caseId: string | null }> {
  try {
    const opened = await openSafeguardingCase(ctx, input);
    return { caseId: UUID.test(opened.caseId) ? opened.caseId : null };
  } catch (error) {
    logError("safeguarding.open_failed", error, { trigger: input.trigger, sourceType: input.sourceType, sourceId: input.sourceId });
    try {
      await enqueueModeration(ctx, {
        subjectType: fallback.subjectType,
        subjectId: fallback.subjectId,
        learnerId: input.learnerId ?? null,
        source: "auto",
        severity: "critical",
        reason: `A safeguarding case could not be opened automatically (${input.trigger}). Treat this as a safeguarding alert and tell the safeguarding lead now.`,
        flags: { safeguardingFallback: true, trigger: input.trigger },
      });
    } catch (queueError) {
      logError("safeguarding.fallback_failed", queueError, { trigger: input.trigger, sourceType: input.sourceType, sourceId: input.sourceId });
    }
    return { caseId: null };
  }
}
