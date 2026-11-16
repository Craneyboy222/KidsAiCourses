/**
 * `pnpm exec tsx scripts/import-plans.ts` — loads the plans in `content/plans/*.json` into the
 * `plan` table (spec 3.7 and Section 11: plans are data, never code).
 *
 * One file per plan, named `<key>.json`. Money is whole pence. `"placeholder": true` marks prices
 * the owner has not confirmed yet (spec Section 17, question 10): edit the figure and set it to
 * `false` once a price is final. `family.json` holds the monthly and annual prices, the
 * founding-family prices (`founding.open` puts the offer on sale, `lockMonths` is how long the
 * price is held) and the price of an extra place. Which courses are free is set on each course
 * (`isFree`), not here.
 *
 * Stripe price ids are not kept in these files: set `STRIPE_PRICE_*` in the environment, or save
 * the ids on the plan in Studio. The local fake driver needs neither.
 *
 * Safe to run again: names, descriptions, seats, allowances and prices are updated from the
 * files, and a Stripe id already saved on a plan is never cleared. The seed script calls
 * `importPlans(ctx)`. Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { systemActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { closeDb, db } from "@/server/db/client";
import { planInputSchema, upsertPlans, type PlanInput, type UpsertPlansResult } from "@/server/services/plans";

export const PLANS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "plans");

/** Reads and checks every file. Throws with the file name when one is wrong. */
export function readPlanFiles(dir: string = PLANS_DIR): PlanInput[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const plans = files.map((name) => {
    const parsed = planInputSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`content/plans/${name}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "is not valid"}`.trim());
    }
    if (`${parsed.data.key}.json` !== name) throw new Error(`content/plans/${name}: the file name must match the key "${parsed.data.key}"`);
    return parsed.data;
  });
  if (!plans.some((plan) => plan.key === "free")) throw new Error("content/plans: there must be a free.json. A family with no subscription is on Free.");
  return plans;
}

export async function importPlans(ctx: Ctx, dir: string = PLANS_DIR): Promise<UpsertPlansResult> {
  return upsertPlans(ctx, readPlanFiles(dir));
}

async function main(): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  try {
    const ctx: Ctx = { db, actor: systemActor("plans.import"), now: new Date(), requestId: `script:plans.import:${randomUUID()}` };
    const result = await importPlans(ctx);
    console.info(`Plans: ${result.inserted.length} added (${result.inserted.join(", ") || "none"}), ${result.updated.length} updated (${result.updated.join(", ") || "none"}).`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error("Plan import failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
