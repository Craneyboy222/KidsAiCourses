import { eq } from "drizzle-orm";
import { siteSetting } from "@/server/db";
import type { Ctx } from "@/server/context";
import { assertCan } from "@/server/authz";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { SETTINGS, type SettingKey, type SettingValue } from "./registry";

export * from "./registry";

/**
 * Reads a setting, falling back to the registry default when it has never been set
 * or when the stored value no longer matches the schema.
 */
export async function getSetting<K extends SettingKey>(ctx: Pick<Ctx, "db">, key: K): Promise<SettingValue<K>> {
  const [row] = await ctx.db.select({ value: siteSetting.value }).from(siteSetting).where(eq(siteSetting.key, key)).limit(1);
  const definition = SETTINGS[key];
  if (!row) return definition.defaultValue as SettingValue<K>;
  const parsed = definition.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : definition.defaultValue) as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(ctx: Pick<Ctx, "db">, keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(ctx, k)] as const));
  return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
}

/** Guards run before a setting is saved. Other modules register theirs with `registerSettingGuard`. */
type Guard = (ctx: Ctx, value: unknown) => Promise<void>;
const guards = new Map<SettingKey, Guard[]>();
export function registerSettingGuard<K extends SettingKey>(key: K, guard: (ctx: Ctx, value: SettingValue<K>) => Promise<void>): void {
  guards.set(key, [...(guards.get(key) ?? []), guard as Guard]);
}

/** Validates, authorises, saves and audits a setting change. */
export async function setSetting<K extends SettingKey>(ctx: Ctx, key: K, value: SettingValue<K>, reason?: string): Promise<void> {
  const definition = SETTINGS[key];
  if (!definition) throw new AppError("not_found", "That setting doesn't exist.");
  assertCan(ctx.actor, "ownerOnly" in definition && definition.ownerOnly ? "launch_readiness.manage" : "setting.manage");
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("invalid_input", `That value isn't valid for "${definition.label}". ${parsed.error.issues[0]?.message ?? ""}`.trim());
  }
  for (const guard of guards.get(key) ?? []) await guard(ctx, parsed.data);
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  await ctx.db.transaction(async (tx) => {
    const previous = await getSetting({ db: tx }, key);
    await tx
      .insert(siteSetting)
      .values({ key, value: parsed.data as unknown, updatedBy, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: siteSetting.key, set: { value: parsed.data as unknown, updatedBy, updatedAt: ctx.now } });
    await audit(ctx, { action: "setting.update", targetType: "site_setting", targetId: key, reason, meta: { from: previous, to: parsed.data } }, tx);
  });
}
