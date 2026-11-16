import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { actorUserId, assertCan, type SafetyBand } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { featureFlag } from "@/server/db";
import { AppError } from "@/server/errors";

/**
 * Feature flags, targetable by safety band, plan or family (spec 3.8).
 *
 * A flag is `enabled` plus `rules`. With no rules an enabled flag is on for everyone. With rules,
 * it is on for a target that matches ANY rule; inside one rule EVERY condition must match.
 *
 * The rule shape is deliberately open (spec Section 12): `rules` is stored as given. A rule that
 * carries a condition this code does not know yet matches nobody, so a flag aimed at a future
 * audience can never switch on for everyone by accident.
 */
export type FlagRule = {
  safetyBands?: string[];
  plans?: string[];
  familyIds?: string[];
  /** 0–100. A stable share of families (or users), chosen by hashing the flag key with the id. */
  percentage?: number;
  [future: string]: unknown;
};

export type FlagTarget = { safetyBand?: SafetyBand | string; plan?: string; familyId?: string; userId?: string };

export type Flag = {
  key: string;
  enabled: boolean;
  rules: FlagRule[];
  description: string | null;
  updatedBy: string | null;
  updatedAt: Date;
};

const strings = z.array(z.string().min(1)).max(500);
/** Known conditions are validated; unknown keys are kept as they are. */
const ruleSchema = z.looseObject({
  safetyBands: strings.optional(),
  plans: strings.optional(),
  familyIds: strings.optional(),
  percentage: z.number().min(0).max(100).optional(),
});
const rulesSchema = z.union([ruleSchema, z.array(ruleSchema).max(50)]);

const KNOWN_CONDITIONS = new Set(["safetyBands", "plans", "familyIds", "percentage"]);

/** Accepts one rule object or a list, as stored. Anything else is treated as "no rules". */
export function normaliseRules(raw: unknown): FlagRule[] {
  if (Array.isArray(raw)) return raw.filter((r): r is FlagRule => typeof r === "object" && r !== null && !Array.isArray(r));
  if (typeof raw === "object" && raw !== null) return Object.keys(raw).length === 0 ? [] : [raw as FlagRule];
  return [];
}

/** 0–99, the same every time for the same flag and id. */
export function percentageBucket(flagKey: string, id: string): number {
  const digest = createHash("sha256").update(`${flagKey}:${id}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function inList(list: unknown, value: string | undefined): boolean {
  return Array.isArray(list) && value !== undefined && list.includes(value);
}

/** Pure: does one rule match this target? */
export function ruleMatches(flagKey: string, rule: FlagRule, target: FlagTarget): boolean {
  for (const [condition, expected] of Object.entries(rule)) {
    if (expected === undefined) continue;
    if (!KNOWN_CONDITIONS.has(condition)) return false;
    if (condition === "safetyBands" && !inList(expected, target.safetyBand)) return false;
    if (condition === "plans" && !inList(expected, target.plan)) return false;
    if (condition === "familyIds" && !inList(expected, target.familyId)) return false;
    if (condition === "percentage") {
      if (typeof expected !== "number" || !Number.isFinite(expected)) return false;
      if (expected >= 100) continue;
      // A family stays together: every child in it sees the same thing.
      const id = target.familyId ?? target.userId;
      if (!id || percentageBucket(flagKey, id) >= expected) return false;
    }
  }
  return true;
}

/** Pure: the whole decision for one flag. */
export function evaluateFlag(flag: { key: string; enabled: boolean; rules: unknown } | null | undefined, target: FlagTarget = {}): boolean {
  if (!flag || !flag.enabled) return false;
  const rules = normaliseRules(flag.rules);
  if (rules.length === 0) return true;
  return rules.some((rule) => ruleMatches(flag.key, rule, target));
}

// ── Cache ───────────────────────────────────────────────────────────────────

export const FLAG_CACHE_MS = 15_000;
type CacheEntry = { at: number; flag: { key: string; enabled: boolean; rules: unknown } | null };
const globalForFlags = globalThis as typeof globalThis & { __platformFlagCache?: Map<string, CacheEntry> };
const cache = (globalForFlags.__platformFlagCache ??= new Map<string, CacheEntry>());

/** Test helper, and called after every `setFlag`. */
export function clearFlagCache(): void {
  cache.clear();
}

async function loadFlag(ctx: Pick<Ctx, "db" | "now">, key: string): Promise<CacheEntry["flag"]> {
  const nowMs = ctx.now.getTime();
  const hit = cache.get(key);
  if (hit && Math.abs(nowMs - hit.at) < FLAG_CACHE_MS) return hit.flag;
  const [row] = await ctx.db
    .select({ key: featureFlag.key, enabled: featureFlag.enabled, rules: featureFlag.rules })
    .from(featureFlag)
    .where(eq(featureFlag.key, key))
    .limit(1);
  const flag = row ?? null;
  cache.set(key, { at: nowMs, flag });
  return flag;
}

function targetFromActor(ctx: Pick<Ctx, "actor">, given: FlagTarget | undefined): FlagTarget {
  const { actor } = ctx;
  const fromActor: FlagTarget = {};
  const userId = actorUserId(actor);
  if (userId) fromActor.userId = userId;
  if (actor.type === "learner") {
    fromActor.safetyBand = actor.safetyBand;
    if (actor.familyId) fromActor.familyId = actor.familyId;
  }
  if (actor.type === "parent") fromActor.familyId = actor.familyId;
  return { ...fromActor, ...given };
}

/**
 * Is the flag on for this request? Unknown flag → false. The safety band and family come from
 * the actor unless `target` overrides them; the plan must be passed in by the caller.
 */
export async function isEnabled(ctx: Pick<Ctx, "db" | "now" | "actor">, key: string, target?: FlagTarget): Promise<boolean> {
  return evaluateFlag(await loadFlag(ctx, key), targetFromActor(ctx, target));
}

export async function listFlags(ctx: Ctx): Promise<Flag[]> {
  assertCan(ctx.actor, "flag.manage");
  const rows = await ctx.db.select().from(featureFlag).orderBy(asc(featureFlag.key));
  return rows.map((r) => ({
    key: r.key,
    enabled: r.enabled,
    rules: normaliseRules(r.rules),
    description: r.description,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
}

export type SetFlagInput = {
  key: string;
  enabled: boolean;
  /** One rule or a list. Omit to leave the stored rules alone (or none, for a new flag). */
  rules?: FlagRule | FlagRule[];
  description?: string | null;
};

/** Creates or changes a flag. Staff with `flag.manage`; audited. */
export async function setFlag(ctx: Ctx, input: SetFlagInput): Promise<void> {
  assertCan(ctx.actor, "flag.manage");
  const key = input.key.trim();
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(key)) {
    throw new AppError("invalid_input", "Flag keys use lower-case letters, numbers, dots, dashes and underscores, for example coach.voice_input.");
  }
  let rules: FlagRule[] | undefined;
  if (input.rules !== undefined) {
    const parsed = rulesSchema.safeParse(input.rules);
    if (!parsed.success) {
      throw new AppError("invalid_input", `Those targeting rules aren't valid. ${parsed.error.issues[0]?.message ?? ""}`.trim());
    }
    rules = normaliseRules(parsed.data);
  }
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  await ctx.db.transaction(async (tx) => {
    const [previous] = await tx.select().from(featureFlag).where(eq(featureFlag.key, key)).limit(1);
    const change = {
      enabled: input.enabled,
      ...(rules !== undefined ? { rules: rules as unknown[] } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedBy,
      updatedAt: ctx.now,
    };
    await tx
      .insert(featureFlag)
      .values({ key, ...change })
      .onConflictDoUpdate({ target: featureFlag.key, set: change });
    await audit(
      ctx,
      {
        action: previous ? "flag.update" : "flag.create",
        targetType: "feature_flag",
        targetId: key,
        meta: {
          from: previous ? { enabled: previous.enabled, rules: previous.rules } : null,
          to: { enabled: input.enabled, rules: rules ?? previous?.rules ?? [] },
        },
      },
      tx,
    );
  });
  clearFlagCache();
}
