import { asc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { aiProcessor } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * The register of outside providers that process data for us (decision D1, spec Section 8).
 *
 * A provider — a model provider, and likewise an email or storage provider — may only be used
 * once a named person has approved it and recorded where its data-processing agreement (DPA) is
 * kept. Approval and switching on are two separate steps, both audited. The database refuses an
 * enabled row without an approval and a DPA reference, whatever the code does.
 *
 * Secrets (API keys) are never stored here: they stay in environment variables.
 */
export type Processor = {
  providerKey: string;
  name: string;
  purpose: string;
  region: string | null;
  dpaReference: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  enabled: boolean;
  notes: string | null;
  /** Approved by a person, with a DPA reference on record. */
  approved: boolean;
};

type Row = typeof aiProcessor.$inferSelect;
const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;
const rowApproved = (row: Pick<Row, "approvedAt" | "dpaReference">) =>
  row.approvedAt !== null && hasText(row.dpaReference);

function toProcessor(row: Row): Processor {
  return {
    providerKey: row.providerKey,
    name: row.name,
    purpose: row.purpose,
    region: row.region,
    dpaReference: row.dpaReference,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    enabled: row.enabled,
    notes: row.notes,
    approved: rowApproved(row),
  };
}

async function findProcessor(ctx: Pick<Ctx, "db">, providerKey: string): Promise<Row | undefined> {
  const rows = await ctx.db
    .select()
    .from(aiProcessor)
    .where(eq(aiProcessor.providerKey, providerKey))
    .limit(1);
  return rows[0];
}

/** Has a person approved this provider and recorded its DPA? (Says nothing about whether it is switched on.) */
export async function isProcessorApproved(ctx: Pick<Ctx, "db">, providerKey: string): Promise<boolean> {
  const row = await findProcessor(ctx, providerKey);
  return row !== undefined && rowApproved(row);
}

/** May this provider be called right now? Approved, with a DPA, and switched on. */
export async function isProcessorEnabled(ctx: Pick<Ctx, "db">, providerKey: string): Promise<boolean> {
  const row = await findProcessor(ctx, providerKey);
  return row !== undefined && rowApproved(row) && row.enabled;
}

/** Throws `approval_required` unless the provider is approved with a DPA on record. */
export async function assertProcessorApproved(ctx: Pick<Ctx, "db">, providerKey: string): Promise<void> {
  if (await isProcessorApproved(ctx, providerKey)) return;
  throw new AppError(
    "approval_required",
    "That provider hasn't been approved yet. The owner needs to approve it and record its data-processing agreement first.",
    {
      detail: { providerKey },
    },
  );
}

/** For the code that actually calls a provider: throws `ai_unavailable` unless it is approved and switched on. */
export async function assertProcessorEnabled(ctx: Pick<Ctx, "db">, providerKey: string): Promise<void> {
  if (await isProcessorEnabled(ctx, providerKey)) return;
  throw new AppError(
    "ai_unavailable",
    "That isn't available right now. Everything else still works, so carry on and try this again later.",
    {
      detail: { providerKey, reason: "processor_not_enabled" },
    },
  );
}

export async function listProcessors(ctx: Ctx): Promise<Processor[]> {
  assertCan(ctx.actor, "ai.settings.manage");
  const rows = await ctx.db.select().from(aiProcessor).orderBy(asc(aiProcessor.providerKey));
  return rows.map(toProcessor);
}

export type ApproveProcessorInput = {
  /** Stable key, e.g. `anthropic`, `openai`, `email.resend`, `storage.s3`. */
  providerKey: string;
  name: string;
  /** What it is used for, e.g. "Coach replies". */
  purpose: string;
  /** Where the data is processed, e.g. "UK (London)" or "EU". */
  region: string;
  /** Where the signed DPA can be found: a document reference or link. Never the document itself. */
  dpaReference: string;
  notes?: string;
};

/**
 * Records a person's approval of a provider, with its DPA reference. Does not switch it on.
 * Staff with `ai.settings.manage` only: a background job can never approve a processor.
 */
export async function approveProcessor(ctx: Ctx, input: ApproveProcessorInput): Promise<Processor> {
  assertCan(ctx.actor, "ai.settings.manage");
  if (ctx.actor.type !== "staff")
    throw new AppError("forbidden", "A provider can only be approved by a named member of staff.");
  const providerKey = input.providerKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(providerKey)) {
    throw new AppError(
      "invalid_input",
      "Provider keys use lower-case letters, numbers, dots and dashes, for example email.resend.",
    );
  }
  const fields = {
    name: input.name.trim(),
    purpose: input.purpose.trim(),
    region: input.region.trim(),
    dpaReference: input.dpaReference.trim(),
  };
  const missing = Object.entries(fields).find(([, value]) => value.length === 0);
  if (missing) {
    throw new AppError(
      "invalid_input",
      "Fill in the name, purpose, region and DPA reference before approving a provider.",
      {
        fieldErrors: { [missing[0]]: ["This is needed before the provider can be approved."] },
      },
    );
  }
  const approvedBy = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    const change = {
      ...fields,
      notes: input.notes?.trim() || null,
      approvedBy,
      approvedAt: ctx.now,
      updatedAt: ctx.now,
    };
    const rows = await tx
      .insert(aiProcessor)
      .values({ providerKey, ...change })
      .onConflictDoUpdate({ target: aiProcessor.providerKey, set: change })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("Processor upsert returned no row");
    await audit(
      ctx,
      {
        action: "processor.approve",
        targetType: "ai_processor",
        targetId: providerKey,
        meta: { region: fields.region, dpaReference: fields.dpaReference, purpose: fields.purpose },
      },
      tx,
    );
    return toProcessor(row);
  });
}

/**
 * Switches a provider on or off. It cannot be switched on without an approval and a DPA
 * reference. Switching on needs a member of staff; switching off is also open to background
 * jobs, so a kill switch can act without waiting for a person.
 */
export async function setProcessorEnabled(
  ctx: Ctx,
  providerKey: string,
  enabled: boolean,
  reason?: string,
): Promise<Processor> {
  assertCan(ctx.actor, "ai.settings.manage");
  if (enabled && ctx.actor.type !== "staff")
    throw new AppError("forbidden", "A provider can only be switched on by a named member of staff.");
  return ctx.db.transaction(async (tx) => {
    const existing = await findProcessor({ db: tx }, providerKey);
    if (!existing)
      throw new AppError("not_found", "That provider isn't in the register yet. Approve it first.");
    if (enabled && !rowApproved(existing)) {
      throw new AppError(
        "approval_required",
        "This provider can't be switched on until it has been approved and its DPA reference is recorded.",
        { detail: { providerKey } },
      );
    }
    const rows = await tx
      .update(aiProcessor)
      .set({ enabled, updatedAt: ctx.now })
      .where(eq(aiProcessor.providerKey, providerKey))
      .returning();
    const row = rows[0];
    if (!row) throw new Error("Processor update returned no row");
    await audit(
      ctx,
      {
        action: enabled ? "processor.enable" : "processor.disable",
        targetType: "ai_processor",
        targetId: providerKey,
        reason,
        meta: { from: existing.enabled, to: enabled },
      },
      tx,
    );
    return toProcessor(row);
  });
}
