import { eq } from "drizzle-orm";
import type { Ctx } from "@/server/context";
import { siteSetting } from "@/server/db";
import { SETTINGS, type SettingKey, type SettingValue } from "./registry";

/**
 * Reading settings. Kept apart from `index.ts` (which also saves and guards them) so that the
 * guards themselves can read a setting without importing the module that runs them.
 */

/**
 * Reads a setting, falling back to the registry default when it has never been set
 * or when the stored value no longer matches the schema.
 */
export async function getSetting<K extends SettingKey>(
  ctx: Pick<Ctx, "db">,
  key: K,
): Promise<SettingValue<K>> {
  const [row] = await ctx.db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, key))
    .limit(1);
  const definition = SETTINGS[key];
  if (!row) return definition.defaultValue as SettingValue<K>;
  const parsed = definition.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : definition.defaultValue) as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(
  ctx: Pick<Ctx, "db">,
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(ctx, k)] as const));
  return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
}
