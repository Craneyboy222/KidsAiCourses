// CONTRACT — owner: accounts slice. See _contract.ts.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { revokeAllSessions } from "@/server/auth/accounts";
import { audit } from "@/server/audit";
import { actorUserId, assertCan, type SafetyBand, type UserStatus } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { consentDefinition, consentRecord, parentControl, user, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { notify } from "@/server/notifications";
import { getLearnerSummary, isIndependentLearner } from "./family";

/**
 * The consent centre (spec 3.6).
 *
 * - Wording is data: `consent_definition` rows, one per key and version, imported from
 *   `content/consents/*.json`. The current wording for a key is its highest active version.
 * - Every grant and every withdrawal appends a `consent_record` (who, when, how, which version).
 *   Nothing is ever updated: the state of a consent is its newest record.
 * - A consent counts as given only if the newest record is a grant **for the current version**.
 *   So publishing a new version of a required consent means it must be given again.
 * - Withdrawing a required consent pauses the learner and signs them out. Giving it again lifts
 *   that pause, unless something else (a parent's own pause) is also holding the account.
 * - Until every required consent has been given, a new child's account is held (`paused`, reason
 *   `consent_required`): that is how "the parent completes the consent centre, and only then is
 *   the account active" is enforced.
 */

/** Spec 3.6. Keys stay open text in the database; these are the launch set. */
export const REQUIRED_CONSENT_KEYS = ["account_learning_data", "ai_processing", "third_party_tools"] as const;
export const OPTIONAL_CONSENT_KEYS = ["tutor_history_retention", "product_improvement_analytics"] as const;
export type ConsentKey = (typeof REQUIRED_CONSENT_KEYS)[number] | (typeof OPTIONAL_CONSENT_KEYS)[number];

/** `user.status_reason` values written here. Other slices can read them to explain a pause. */
export const CONSENT_HOLD = {
  /** A new child, or an approved teen, whose parent has not finished the consent centre yet. */
  required: "consent_required",
  /** A required consent was withdrawn. */
  revoked: "consent_revoked",
} as const;
const HOLD_REASONS: ReadonlySet<string> = new Set(Object.values(CONSENT_HOLD));

export type ConsentMethod = "consent_centre" | "signup" | "teen_approval" | "independence";

export type ConsentDefinition = {
  key: string;
  version: number;
  title: string;
  body: string;
  required: boolean;
  defaultByBand: Record<string, boolean>;
  position: number;
};

export type ConsentItem = ConsentDefinition & {
  /** Given, at the current version. */
  granted: boolean;
  /** Given before, but for older wording: it must be given again. */
  needsReconsent: boolean;
  /** How the switch should start for this learner's age group when no choice has been made. */
  defaultOn: boolean;
  /** When the newest choice was recorded, if any. */
  decidedAt: Date | null;
};

export type ConsentCentre = {
  learnerId: string;
  items: ConsentItem[];
  missingRequired: string[];
  /** True when every required consent is given at the current version. */
  complete: boolean;
};

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * The starting position of a consent switch for an age group. Required consents are never
 * pre-selected: a tick must be the adult's own act. Optional ones follow `defaultByBand`, and are
 * off for anything not listed, so the safe answer is the default.
 */
export function consentDefaultForBand(
  definition: Pick<ConsentDefinition, "required" | "defaultByBand">,
  band: SafetyBand,
): boolean {
  if (definition.required) return false;
  return definition.defaultByBand[band] === true;
}

/** The current wording for each key: the highest active version. Sorted by position, then key. */
export function currentDefinitions<T extends { key: string; version: number; active: boolean; position: number }>(
  rows: readonly T[],
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!row.active) continue;
    const seen = latest.get(row.key);
    if (!seen || row.version > seen.version) latest.set(row.key, row);
  }
  return [...latest.values()].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

type LatestRecord = { action: "granted" | "revoked"; consentVersion: number; createdAt: Date } | undefined;

/** Whether a consent is given, from its newest record and the current version of its wording. */
export function consentState(
  currentVersion: number,
  latest: LatestRecord,
): { granted: boolean; needsReconsent: boolean } {
  if (!latest || latest.action !== "granted") return { granted: false, needsReconsent: false };
  if (latest.consentVersion === currentVersion) return { granted: true, needsReconsent: false };
  return { granted: false, needsReconsent: true };
}

// ── Reading ─────────────────────────────────────────────────────────────────

type ReadCtx = Pick<Ctx, "db">;

export async function listConsentDefinitions(ctx: ReadCtx, db: Db = ctx.db): Promise<ConsentDefinition[]> {
  const rows = await db
    .select({
      key: consentDefinition.key,
      version: consentDefinition.version,
      title: consentDefinition.title,
      body: consentDefinition.body,
      required: consentDefinition.required,
      defaultByBand: consentDefinition.defaultByBand,
      position: consentDefinition.position,
      active: consentDefinition.active,
    })
    .from(consentDefinition)
    .where(eq(consentDefinition.active, true))
    .orderBy(asc(consentDefinition.position));
  return currentDefinitions(rows).map(({ active: _active, ...definition }) => definition);
}

async function latestRecords(db: Db, learnerId: string, keys?: string[]): Promise<Map<string, NonNullable<LatestRecord>>> {
  const rows = await db
    .select({
      key: consentRecord.consentKey,
      action: consentRecord.action,
      consentVersion: consentRecord.consentVersion,
      createdAt: consentRecord.createdAt,
      id: consentRecord.id,
    })
    .from(consentRecord)
    .where(
      keys && keys.length > 0
        ? and(eq(consentRecord.learnerId, learnerId), inArray(consentRecord.consentKey, keys))
        : eq(consentRecord.learnerId, learnerId),
    )
    // Newest first. The id breaks a tie between two records written in the same instant.
    .orderBy(desc(consentRecord.createdAt), desc(consentRecord.id));
  const latest = new Map<string, NonNullable<LatestRecord>>();
  for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
  return latest;
}

/**
 * Required consents that are not currently given. A launch-set key with no published wording
 * counts as missing: with nothing to agree to, nobody can have agreed.
 */
function missingFrom(definitions: ConsentDefinition[], latest: Map<string, NonNullable<LatestRecord>>): string[] {
  const missing: string[] = [];
  const known = new Set(definitions.map((d) => d.key));
  for (const key of REQUIRED_CONSENT_KEYS) if (!known.has(key)) missing.push(key);
  for (const definition of definitions) {
    if (!definition.required) continue;
    if (!consentState(definition.version, latest.get(definition.key)).granted) missing.push(definition.key);
  }
  return missing;
}

/** True when the latest record for this learner and key (at the current definition version) is a grant. */
export async function hasConsent(ctx: ReadCtx, learnerId: string, key: ConsentKey): Promise<boolean> {
  const definition = (await listConsentDefinitions(ctx)).find((d) => d.key === key);
  if (!definition) return false;
  const latest = await latestRecords(ctx.db, learnerId, [key]);
  return consentState(definition.version, latest.get(key)).granted;
}

/** Required consents that are not currently granted. Empty means the learner may use the product. */
export async function missingRequiredConsents(ctx: ReadCtx, learnerId: string): Promise<ConsentKey[]> {
  const definitions = await listConsentDefinitions(ctx);
  const latest = await latestRecords(ctx.db, learnerId);
  return missingFrom(definitions, latest) as ConsentKey[];
}

/** Who may look at or change a learner's consents: their family's parents, or the learner at 18. */
async function authorise(ctx: Ctx, learnerId: string, mode: "read" | "update"): Promise<{ familyId: string | null; band: SafetyBand; status: UserStatus }> {
  const learner = await getLearnerSummary(ctx, learnerId);
  const independent = await isIndependentLearner(ctx, learnerId);
  if (ctx.actor.type === "learner") {
    assertCan(ctx.actor, "learner.consent.update", { learnerId });
    if (!independent) {
      throw new AppError("forbidden", "Your parent or carer looks after these choices. Ask them if you'd like something changed.");
    }
  } else {
    assertCan(ctx.actor, mode === "read" ? "family.consent.read" : "family.consent.update", {
      learnerId,
      familyId: learner.familyId,
    });
    if (mode === "update" && independent && ctx.actor.type === "parent") {
      throw new AppError("forbidden", `${learner.nickname} is 18 and runs their own account now, so these choices are theirs to make.`);
    }
  }
  return { familyId: learner.familyId, band: learner.safetyBand, status: learner.status };
}

/** Everything the consent screen needs for one learner. */
export async function getConsentCentre(ctx: Ctx, learnerId: string): Promise<ConsentCentre> {
  const { band } = await authorise(ctx, learnerId, "read");
  const definitions = await listConsentDefinitions(ctx);
  const latest = await latestRecords(ctx.db, learnerId);
  const items = definitions.map((definition): ConsentItem => {
    const record = latest.get(definition.key);
    return {
      ...definition,
      ...consentState(definition.version, record),
      defaultOn: consentDefaultForBand(definition, band),
      decidedAt: record?.createdAt ?? null,
    };
  });
  const missingRequired = missingFrom(definitions, latest);
  return { learnerId, items, missingRequired, complete: missingRequired.length === 0 };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export type SaveConsentsInput = {
  /** The wanted state of each consent, by key. Keys left out are not changed. */
  choices: Record<string, boolean>;
  method?: ConsentMethod;
  /** Must be true to withdraw a required consent from an account that is in use. */
  confirmPause?: boolean;
};

export type SaveConsentsResult = {
  changed: Array<{ key: string; action: "granted" | "revoked"; version: number }>;
  missingRequired: string[];
  status: UserStatus;
  /** This save paused the account. */
  paused: boolean;
  /** This save made the account active. */
  activated: boolean;
};

type ApplyOptions = {
  learnerId: string;
  familyId: string | null;
  actorUserId: string;
  choices: Record<string, boolean>;
  method: ConsentMethod;
  confirmPause: boolean;
  /**
   * Record a fresh grant even where one already stands. Used when an 18-year-old takes over
   * their account: the consent a parent gave for them becomes their own.
   */
  reaffirm?: boolean;
};

/**
 * Appends the records for a set of choices and moves the account between held and active.
 * No authorisation here: `saveConsents`, sign-up and independence check that first. Runs in the
 * caller's transaction.
 */
export async function applyConsentChoices(ctx: Ctx, tx: Db, options: ApplyOptions): Promise<SaveConsentsResult> {
  const definitions = await listConsentDefinitions(ctx, tx);
  const before = await latestRecords(tx, options.learnerId);
  const targetRows = await tx
    .select({ status: user.status, statusReason: user.statusReason })
    .from(user)
    .where(eq(user.id, options.learnerId))
    .limit(1);
  const target = targetRows[0];
  if (!target) throw new AppError("not_found", "That learner could not be found. They may have been removed.");

  const changed: SaveConsentsResult["changed"] = [];
  let withdrawsRequired = false;
  for (const definition of definitions) {
    const wanted = options.choices[definition.key];
    if (wanted === undefined) continue;
    const record = before.get(definition.key);
    const state = consentState(definition.version, record);
    if (wanted && (!state.granted || options.reaffirm === true)) {
      changed.push({ key: definition.key, action: "granted", version: definition.version });
    } else if (!wanted && record?.action === "granted") {
      changed.push({ key: definition.key, action: "revoked", version: definition.version });
      if (definition.required && state.granted) withdrawsRequired = true;
    }
  }

  if (withdrawsRequired && target.status === "active" && !options.confirmPause) {
    throw new AppError(
      "invalid_input",
      "Withdrawing a required consent pauses the account and signs the learner out straight away. If that is what you want, tick the box to confirm and save again.",
      { fieldErrors: { confirmPause: ["Tick this box to confirm that the account should be paused."] } },
    );
  }

  if (changed.length > 0) {
    await tx.insert(consentRecord).values(
      changed.map((change) => ({
        learnerId: options.learnerId,
        familyId: options.familyId,
        consentKey: change.key,
        consentVersion: change.version,
        action: change.action,
        actorUserId: options.actorUserId,
        method: options.method,
        ip: ctx.ip ?? null,
        requestId: ctx.requestId,
        createdAt: ctx.now,
      })),
    );
    for (const change of changed) {
      await audit(
        ctx,
        {
          action: change.action === "granted" ? "consent.grant" : "consent.revoke",
          targetType: "user",
          targetId: options.learnerId,
          meta: { key: change.key, version: change.version, method: options.method },
        },
        tx,
      );
    }
  }

  const after = new Map(before);
  for (const change of changed) {
    after.set(change.key, { action: change.action, consentVersion: change.version, createdAt: ctx.now });
  }
  const missingRequired = missingFrom(definitions, after);

  let status = target.status;
  let paused = false;
  let activated = false;
  if (missingRequired.length > 0 && target.status === "active") {
    await tx
      .update(user)
      .set({ status: "paused", statusReason: CONSENT_HOLD.revoked, updatedAt: ctx.now })
      .where(eq(user.id, options.learnerId));
    await revokeAllSessions(tx, options.learnerId);
    status = "paused";
    paused = true;
  } else if (missingRequired.length === 0 && target.status === "paused" && HOLD_REASONS.has(target.statusReason ?? "")) {
    // Consent was the reason for the hold. Lift it, unless a parent has also paused the account.
    const controls = await tx
      .select({ paused: parentControl.paused })
      .from(parentControl)
      .where(eq(parentControl.learnerId, options.learnerId))
      .limit(1);
    if (controls[0]?.paused === true) {
      await tx.update(user).set({ statusReason: null, updatedAt: ctx.now }).where(eq(user.id, options.learnerId));
    } else {
      await tx
        .update(user)
        .set({ status: "active", statusReason: null, updatedAt: ctx.now })
        .where(eq(user.id, options.learnerId));
      status = "active";
      activated = true;
    }
  }
  return { changed, missingRequired, status, paused, activated };
}

/** Tells the learner, in the app, that their account was paused or is ready. Never fails the save. */
async function tellLearner(ctx: Ctx, learnerId: string, result: SaveConsentsResult): Promise<void> {
  if (!result.paused && !result.activated) return;
  try {
    await notify(ctx, {
      userId: learnerId,
      type: result.paused ? "account.paused_consent" : "account.ready",
      title: result.paused ? "Your account is paused" : "You're good to go",
      body: result.paused
        ? "A parent or carer has changed one of the permissions your account needs, so it's paused for now. Your work is safe. Talk to them about switching it back on."
        : "Your parent or carer has finished setting up your account. Everything is unlocked.",
      href: "/home",
      channels: ["in_app"],
    });
  } catch (error) {
    logWarn("consent.notify_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Saves a parent's (or an independent 18-year-old's) choices for one learner.
 * Withdrawing a required consent from an account in use needs `confirmPause`.
 */
export async function saveConsents(ctx: Ctx, learnerId: string, input: SaveConsentsInput): Promise<SaveConsentsResult> {
  const { familyId } = await authorise(ctx, learnerId, "update");
  const actorId = actorUserId(ctx.actor);
  if (!actorId) throw new AppError("unauthenticated", "Please sign in to carry on.");
  const result = await ctx.db.transaction((tx) =>
    applyConsentChoices(ctx, tx, {
      learnerId,
      familyId,
      actorUserId: actorId,
      choices: input.choices,
      method: input.method ?? "consent_centre",
      confirmPause: input.confirmPause === true,
    }),
  );
  await tellLearner(ctx, learnerId, result);
  return result;
}

// ── Definitions as data ─────────────────────────────────────────────────────

export type ConsentDefinitionInput = {
  key: string;
  version: number;
  title: string;
  body: string;
  required: boolean;
  defaultByBand: Record<string, boolean>;
  position: number;
};

export type UpsertDefinitionsResult = { inserted: string[]; unchanged: string[]; retired: string[] };

/**
 * Loads consent wording. Safe to run again. A version that already exists is never rewritten:
 * people agreed to those exact words, so changed wording must come as a new version number.
 * Adding a new version retires the older versions of the same key.
 */
export async function upsertConsentDefinitions(ctx: Ctx, definitions: ConsentDefinitionInput[]): Promise<UpsertDefinitionsResult> {
  const result: UpsertDefinitionsResult = { inserted: [], unchanged: [], retired: [] };
  await ctx.db.transaction(async (tx) => {
    for (const definition of [...definitions].sort((a, b) => a.key.localeCompare(b.key) || a.version - b.version)) {
      const label = `${definition.key}@${definition.version}`;
      const existing = await tx
        .select()
        .from(consentDefinition)
        .where(and(eq(consentDefinition.key, definition.key), eq(consentDefinition.version, definition.version)))
        .limit(1);
      const row = existing[0];
      if (row) {
        if (row.title !== definition.title || row.body !== definition.body || row.required !== definition.required) {
          throw new AppError(
            "conflict",
            `Consent "${definition.key}" version ${definition.version} is already published with different wording. Give the new wording a higher version number.`,
          );
        }
        if (row.position !== definition.position || JSON.stringify(row.defaultByBand) !== JSON.stringify(definition.defaultByBand)) {
          await tx
            .update(consentDefinition)
            .set({ position: definition.position, defaultByBand: definition.defaultByBand, updatedAt: ctx.now })
            .where(eq(consentDefinition.id, row.id));
        }
        result.unchanged.push(label);
        continue;
      }
      await tx.insert(consentDefinition).values({
        ...definition,
        active: true,
        publishedAt: ctx.now,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      result.inserted.push(label);
      await audit(ctx, { action: "consent.definition.publish", targetType: "consent_definition", targetId: label }, tx);
    }
    // Only the highest version of each key stays active.
    const all = await tx
      .select({ id: consentDefinition.id, key: consentDefinition.key, version: consentDefinition.version, active: consentDefinition.active })
      .from(consentDefinition);
    const highest = new Map<string, number>();
    for (const row of all) highest.set(row.key, Math.max(highest.get(row.key) ?? 0, row.version));
    for (const row of all) {
      if (row.active && row.version < (highest.get(row.key) ?? 0)) {
        await tx.update(consentDefinition).set({ active: false, updatedAt: ctx.now }).where(eq(consentDefinition.id, row.id));
        result.retired.push(`${row.key}@${row.version}`);
      }
    }
  });
  return result;
}
