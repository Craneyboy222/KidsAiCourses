import { and, eq } from "drizzle-orm";
import { EN_GB, type CopyKey } from "@/content/copy/en-GB";
import { env } from "@/env";
import type { Ctx } from "@/server/context";
import { page, pageVersion } from "@/server/db";
import { logWarn } from "@/server/log";

export { EN_GB, type CopyKey };

/**
 * Short in-app copy that Studio can edit without a deploy (spec 3.8: "copy is data, not code").
 *
 *   const title = await t(ctx, "unlock.ask_parent.title");
 *   const body = await t(ctx, "controls.time_cap.body", { minutes: 45 });
 *
 * Defaults live in `src/content/copy/en-GB.ts`. A published `page` of kind `snippet` whose slug
 * is the key replaces the default. A snippet may be written for one audience (`teen` or `adult`);
 * that version wins for that audience, and the `everyone` version covers the rest.
 *
 * Overrides are read in one query and cached for 30 seconds. The result is plain text: render it
 * as text (React escapes it), never as HTML.
 */
export type CopyVars = Record<string, string | number>;
type Audience = "everyone" | "adult" | "teen";

export const COPY_CACHE_MS = 30_000;
type Overrides = Map<string, Partial<Record<Audience, string>>>;
const globalForCopy = globalThis as typeof globalThis & {
  __platformCopyCache?: { at: number; overrides: Overrides } | null;
};

/** Forget cached overrides. Call after publishing a snippet, and in tests. */
export function clearCopyCache(): void {
  globalForCopy.__platformCopyCache = null;
}

async function loadOverrides(ctx: Pick<Ctx, "db" | "now">): Promise<Overrides> {
  const nowMs = ctx.now.getTime();
  const cached = globalForCopy.__platformCopyCache;
  if (cached && Math.abs(nowMs - cached.at) < COPY_CACHE_MS) return cached.overrides;
  const rows = await ctx.db
    .select({ slug: page.slug, audience: page.audience, body: pageVersion.body })
    .from(page)
    .innerJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
    .where(and(eq(page.kind, "snippet"), eq(pageVersion.status, "published")));
  const overrides: Overrides = new Map();
  for (const row of rows) {
    const body = row.body.trim();
    if (body === "") continue;
    overrides.set(row.slug, { ...overrides.get(row.slug), [row.audience]: body });
  }
  globalForCopy.__platformCopyCache = { at: nowMs, overrides };
  return overrides;
}

function audienceOf(ctx: Pick<Ctx, "actor">): Audience {
  const { actor } = ctx;
  if (actor.type === "learner") return actor.safetyBand === "adult_18" ? "adult" : "teen";
  if (actor.type === "parent" || actor.type === "staff") return "adult";
  return "everyone";
}

/** Fills `{{name}}` placeholders. `{{brandName}}` is always available. Unknown names are left out. */
export function fillCopy(template: string, vars: CopyVars = {}): string {
  const all: CopyVars = { brandName: env.NEXT_PUBLIC_BRAND_NAME, ...vars };
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) =>
    name in all ? String(all[name]) : "",
  );
}

/** The built-in wording, with no database look-up. For places with no request context. */
export function tDefault(key: CopyKey, vars?: CopyVars): string {
  return fillCopy(EN_GB[key], vars);
}

function pick(overrides: Overrides, key: CopyKey, audience: Audience): string {
  const found = overrides.get(key);
  return found?.[audience] ?? found?.everyone ?? EN_GB[key];
}

/** One piece of copy, using the Studio override when there is one. */
export async function t(
  ctx: Pick<Ctx, "db" | "now" | "actor">,
  key: CopyKey,
  vars?: CopyVars,
): Promise<string> {
  return (await tMany(ctx, [key], vars))[key];
}

/** Several at once, with a single look-up: `const copy = await tMany(ctx, ["save.saving", "save.saved"])`. */
export async function tMany<K extends CopyKey>(
  ctx: Pick<Ctx, "db" | "now" | "actor">,
  keys: readonly K[],
  vars?: CopyVars,
): Promise<Record<K, string>> {
  let overrides: Overrides;
  try {
    overrides = await loadOverrides(ctx);
  } catch (error) {
    // Copy must never take a page down: fall back to the built-in wording.
    logWarn("copy.overrides_unavailable", { error: error instanceof Error ? error.message : String(error) });
    overrides = new Map();
  }
  const audience = audienceOf(ctx);
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = fillCopy(pick(overrides, key, audience), vars);
  return out;
}
