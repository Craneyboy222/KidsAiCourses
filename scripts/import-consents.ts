/**
 * `pnpm exec tsx scripts/import-consents.ts` — loads the consent wording in `content/consents/*.json`
 * into `consent_definition` (spec 3.6: consent copy is plain English and versioned).
 *
 * One file per consent. To change wording, edit the file **and raise `version`**: a published
 * version is never rewritten, because people agreed to those exact words. A new version of a
 * required consent means every parent is asked to give it again.
 *
 * Safe to run again. The seed script calls `importConsents(ctx)`.
 * Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { z } from "zod";
import { SAFETY_BANDS, systemActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { closeDb, db } from "@/server/db/client";
import {
  upsertConsentDefinitions,
  type ConsentDefinitionInput,
  type UpsertDefinitionsResult,
} from "@/server/services/consent";

export const CONSENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "consents");

const bandDefaults = z
  .object(Object.fromEntries(SAFETY_BANDS.map((band) => [band, z.boolean()])) as Record<(typeof SAFETY_BANDS)[number], z.ZodBoolean>)
  .strict();

export const consentFileSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, "Use lower_snake_case"),
    version: z.number().int().min(1),
    required: z.boolean(),
    position: z.number().int().min(0),
    defaultByBand: bandDefaults,
    title: z.string().min(3).max(120),
    body: z.string().min(40).max(4000),
  })
  .strict()
  // Spec 3.6: optional consents are off by default for 13–15, and a required consent is never pre-selected.
  .refine((d) => d.defaultByBand.teen_13_15 === false, { message: "Consents must default to off for 13–15", path: ["defaultByBand"] })
  .refine((d) => !d.required || Object.values(d.defaultByBand).every((on) => on === false), {
    message: "A required consent can't be on by default: the adult must tick it themselves",
    path: ["defaultByBand"],
  });

/** Reads and checks every file. Throws with the file name when one is wrong. */
export function readConsentFiles(dir: string = CONSENTS_DIR): ConsentDefinitionInput[] {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const definitions = files.map((name) => {
    const parsed = consentFileSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`content/consents/${name}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "is not valid"}`.trim());
    }
    if (`${parsed.data.key}.json` !== name) throw new Error(`content/consents/${name}: the file name must match the key "${parsed.data.key}"`);
    return parsed.data;
  });
  return definitions;
}

export async function importConsents(ctx: Ctx, dir: string = CONSENTS_DIR): Promise<UpsertDefinitionsResult> {
  return upsertConsentDefinitions(ctx, readConsentFiles(dir));
}

async function main(): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  try {
    const ctx: Ctx = { db, actor: systemActor("consents.import"), now: new Date(), requestId: `script:consents.import:${randomUUID()}` };
    const result = await importConsents(ctx);
    console.info(
      `Consents: ${result.inserted.length} added (${result.inserted.join(", ") || "none"}), ${result.unchanged.length} unchanged, ${result.retired.length} older versions retired.`,
    );
  } finally {
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("Consent import failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
