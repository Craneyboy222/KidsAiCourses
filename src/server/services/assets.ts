/**
 * Licensed platform media (videos, captions, transcripts, templates, screenshots), keyed by the
 * asset id used in course JSON. Learner uploads are `artefact`, not this.
 *
 * This module does not import `server-only`, so that the import scripts can run it with tsx.
 */
import { and, asc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import type { ManifestAsset } from "@/content/asset-schema";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { asset } from "@/server/db";

export type AssetRow = typeof asset.$inferSelect;
export type AssetKind = AssetRow["kind"];

export interface AssetUpsertResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

function manifestFields(entry: ManifestAsset) {
  return {
    kind: entry.kind,
    storageKey: entry.storageKey,
    licence: entry.licence,
    attribution: entry.attribution ?? null,
    altText: entry.altText ?? null,
    durationSec: entry.durationSec === undefined ? null : Math.round(entry.durationSec),
  };
}

/**
 * Creates or updates `asset` rows from a parsed manifest (`content/assets/*.json`), matched on the
 * asset id (`asset.key`). An entry that already matches is left alone, so running it twice writes
 * nothing. Needs `asset.manage`.
 */
export async function upsertAssetsFromManifest(ctx: Ctx, manifest: readonly ManifestAsset[]): Promise<AssetUpsertResult> {
  assertCan(ctx.actor, "asset.manage");
  const result: AssetUpsertResult = { created: [], updated: [], unchanged: [] };
  if (manifest.length === 0) return result;
  const uploadedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  await ctx.db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(asset)
      .where(inArray(asset.key, manifest.map((entry) => entry.id)));
    const byKey = new Map(existing.map((row) => [row.key, row]));
    for (const entry of manifest) {
      const fields = manifestFields(entry);
      const row = byKey.get(entry.id);
      if (!row) {
        await tx.insert(asset).values({ key: entry.id, ...fields, uploadedBy });
        result.created.push(entry.id);
        continue;
      }
      const changed = (Object.keys(fields) as Array<keyof typeof fields>).some((key) => row[key] !== fields[key]);
      if (!changed) {
        result.unchanged.push(entry.id);
        continue;
      }
      await tx.update(asset).set(fields).where(eq(asset.id, row.id));
      result.updated.push(entry.id);
    }
    if (result.created.length > 0 || result.updated.length > 0) {
      await audit(
        ctx,
        { action: "asset.import", targetType: "asset", meta: { created: result.created, updated: result.updated } },
        tx,
      );
    }
  });
  return result;
}

/** Assets by id. Unknown ids are simply absent from the map. No authorisation check: assets are course media. */
export async function getAssetsByKeys(ctx: Pick<Ctx, "db">, keys: readonly string[]): Promise<Map<string, AssetRow>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const rows = await ctx.db.select().from(asset).where(inArray(asset.key, unique));
  return new Map(rows.map((row) => [row.key, row]));
}

/** The asset library for Studio (`asset.manage`). */
export async function listAssets(
  ctx: Ctx,
  filters: { kind?: AssetKind; search?: string; limit?: number; offset?: number } = {},
): Promise<AssetRow[]> {
  assertCan(ctx.actor, "asset.manage");
  const where: SQL[] = [];
  if (filters.kind !== undefined) where.push(eq(asset.kind, filters.kind));
  const term = filters.search?.trim();
  if (term) where.push(ilike(asset.key, `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`));
  return ctx.db
    .select()
    .from(asset)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(asset.key))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500))
    .offset(Math.max(filters.offset ?? 0, 0));
}
