import { auditLog } from "@/server/db";
import type { Db } from "@/server/db";
import type { Actor } from "@/server/authz";
import type { Ctx } from "@/server/context";

export type AuditEntry = {
  /** `area.verb`, e.g. `course.publish`, `setting.update`, `safeguarding.notes.read`. */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Required by callers for destructive actions and for break-glass access. */
  reason?: string;
  /** Small, structured detail. Never learner free text, message content or secrets. */
  meta?: Record<string, unknown>;
};

function describe(actor: Actor): { actorType: "anonymous" | "system" | "learner" | "parent" | "staff"; actorId: string | null; actorLabel: string | null } {
  switch (actor.type) {
    case "anonymous":
      return { actorType: "anonymous", actorId: null, actorLabel: null };
    case "system":
      return { actorType: "system", actorId: null, actorLabel: actor.job };
    case "staff":
      return { actorType: "staff", actorId: actor.userId, actorLabel: actor.roles.join(",") };
    default:
      return { actorType: actor.type, actorId: actor.userId, actorLabel: null };
  }
}

/**
 * Appends to the audit log. Call it inside the same transaction as the change it records
 * (pass the transaction as `ctx.db`, or as `db`), so a change can never exist without its entry.
 */
export async function audit(ctx: Ctx, entry: AuditEntry, db: Db = ctx.db): Promise<void> {
  await db.insert(auditLog).values({
    ...describe(ctx.actor),
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    meta: entry.meta ?? {},
    ip: ctx.ip ?? null,
    requestId: ctx.requestId,
    createdAt: ctx.now,
  });
}
