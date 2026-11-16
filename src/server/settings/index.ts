import { sql } from "drizzle-orm";
import { assertCan } from "@/server/authz";
import { audit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import { siteSetting } from "@/server/db";
import { AppError } from "@/server/errors";
import { BUILT_IN_GUARDS } from "./guards";
import { SETTINGS, type SettingGroup, type SettingKey, type SettingValue } from "./registry";
import { getSetting } from "./store";

export * from "./registry";
export { getSetting, getSettings } from "./store";

/** Guards run before a setting is saved. Other modules register theirs with `registerSettingGuard`. */
type Guard = (ctx: Ctx, value: unknown) => Promise<void>;
const guards = new Map<SettingKey, Guard[]>();
export function registerSettingGuard<K extends SettingKey>(
  key: K,
  guard: (ctx: Ctx, value: SettingValue<K>) => Promise<void>,
): void {
  guards.set(key, [...(guards.get(key) ?? []), guard as Guard]);
}

/** Validates, authorises, saves and audits a setting change. */
export async function setSetting<K extends SettingKey>(
  ctx: Ctx,
  key: K,
  value: SettingValue<K>,
  reason?: string,
): Promise<void> {
  const definition = SETTINGS[key];
  if (!definition) throw new AppError("not_found", "That setting doesn't exist.");
  assertCan(
    ctx.actor,
    "ownerOnly" in definition && definition.ownerOnly ? "launch_readiness.manage" : "setting.manage",
  );
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      "invalid_input",
      `That value isn't valid for "${definition.label}". ${parsed.error.issues[0]?.message ?? ""}`.trim(),
    );
  }
  // Built-in guards first (launch readiness, deputy escalation, Radar weights), then any registered by other modules.
  const builtIn = BUILT_IN_GUARDS[key] as Guard | undefined;
  if (builtIn) await builtIn(ctx, parsed.data);
  for (const guard of guards.get(key) ?? []) await guard(ctx, parsed.data);
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  // A setting cleared to "none" is stored as JSON null. (A plain null would be SQL NULL, which the column refuses.)
  const stored: unknown = parsed.data === null ? sql`'null'::jsonb` : parsed.data;
  await ctx.db.transaction(async (tx) => {
    const previous = await getSetting({ db: tx }, key);
    await tx
      .insert(siteSetting)
      .values({ key, value: stored, updatedBy, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: siteSetting.key, set: { value: stored, updatedBy, updatedAt: ctx.now } });
    await audit(
      ctx,
      {
        action: "setting.update",
        targetType: "site_setting",
        targetId: key,
        reason,
        meta: { from: previous, to: parsed.data },
      },
      tx,
    );
  });
}

/** One row of the Studio settings screen. */
export type SettingListItem = {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  help: string;
  /** The value in force: the stored one, or the default when unset or no longer valid. */
  value: unknown;
  defaultValue: unknown;
  /** False when nothing is stored and the default applies. */
  isSet: boolean;
  /** Only the owner may change it. */
  ownerOnly: boolean;
  /** Needs legal or specialist confirmation before launch. */
  legal: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/** Every registry entry with its current value, for Studio → Settings. Staff with `setting.manage`. */
export async function listSettings(ctx: Ctx): Promise<SettingListItem[]> {
  assertCan(ctx.actor, "setting.manage");
  const rows = await ctx.db.select().from(siteSetting);
  const stored = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const definition = SETTINGS[key];
    const row = stored.get(key);
    const parsed = row ? definition.schema.safeParse(row.value) : undefined;
    const isSet = parsed?.success === true;
    return {
      key,
      group: definition.group,
      label: definition.label,
      help: definition.help,
      value: isSet ? parsed.data : definition.defaultValue,
      defaultValue: definition.defaultValue,
      isSet,
      ownerOnly: "ownerOnly" in definition && definition.ownerOnly === true,
      legal: "legal" in definition && definition.legal === true,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}
