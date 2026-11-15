// CONTRACT — owner: tools and submissions slice (the Studio safety slice builds the queue screens on top). See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type ModerationSeverity = "critical" | "high" | "normal";
export type ModerationItemView = {
  id: string;
  subjectType: string; // "submission" | "artefact" | "report" | "coach_message" | "username" | …
  subjectId: string;
  learnerId: string | null;
  source: "auto" | "report" | "sample" | "submission";
  severity: ModerationSeverity;
  state: "pending" | "approved" | "blocked" | "escalated";
  reason: string;
  flags: Record<string, unknown>;
  dueAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Adds an item to the human queue with an SLA due time worked out from the admin-set targets and working window. */
export async function enqueueModeration(_ctx: Ctx, _input: { subjectType: string; subjectId: string; learnerId?: string | null; source: ModerationItemView["source"]; severity: ModerationSeverity; reason: string; flags?: Record<string, unknown> }): Promise<ModerationItemView> {
  return notImplemented("moderation.enqueueModeration");
}
export async function listModerationItems(_ctx: Ctx, _filters?: { state?: ModerationItemView["state"]; severity?: ModerationSeverity; subjectType?: string; limit?: number; offset?: number }): Promise<{ items: ModerationItemView[]; total: number }> {
  return notImplemented("moderation.listModerationItems");
}
export async function getModerationItem(_ctx: Ctx, _itemId: string): Promise<ModerationItemView | null> {
  return notImplemented("moderation.getModerationItem");
}
/** A human decision (authz `moderation.decide`). Applies the outcome to the subject (e.g. accepts or rejects a submission). `escalate` opens a safeguarding case. */
export async function decideModeration(_ctx: Ctx, _itemId: string, _decision: { verdict: "approve" | "block" | "escalate"; note?: string }): Promise<ModerationItemView> {
  return notImplemented("moderation.decideModeration");
}
