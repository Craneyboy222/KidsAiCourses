/**
 * `pnpm exec tsx scripts/import-pages.ts` — loads the site's own pages from `content/pages/**`
 * into `page` and `page_version` (spec Section 5: marketing, legal and help copy is editable in
 * admin, so it lives in the database).
 *
 *   content/pages/marketing/<slug>.md   the long text of Home, How it works, Safety, For parents, Pricing, Radar
 *   content/pages/help/<slug>.md        help centre articles
 *   content/pages/legal/<slug>.md       DRAFTS of the six legal pages (decision D16)
 *
 * Each file is Markdown with a small front-matter block (`src/lib/marketing/page-file.ts`). The
 * file name is the slug, and a slug is used once across all three folders.
 *
 * Marketing and help pages are published as they are imported. **Legal pages are imported as
 * drafts and are never published by this script**: they have not been reviewed by a lawyer, every
 * open decision in them is marked "⚖️ TO CONFIRM", and the launch-readiness gate stays shut until
 * a person publishes reviewed text in Studio. `--publish-drafts` publishes them with their draft
 * banner so they can be looked at; it works only where `APP_ENV` is `local` or `test`.
 *
 * Safe to run again: an unchanged file adds nothing, a changed file adds a new version, and a page
 * a person has edited or published in Studio is never overwritten. The seed script calls
 * `importPages(ctx, { publishDrafts })`. Loads `.env.local` unless `DOTENV_PATH` names another file.
 */
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { PAGE_FILE_KINDS, type PageFile } from "@/lib/marketing/page-file";
import { systemActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { closeDb, db } from "@/server/db/client";
import { readPageFiles, upsertPagesFromFiles, type ImportPagesOptions, type ImportPagesResult } from "@/server/services/pages";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads and checks every page file. Throws with the file name when one is wrong, or when two files share a slug. */
export function readAllPageFiles(root: string = REPO_ROOT): PageFile[] {
  const files = PAGE_FILE_KINDS.flatMap((kind) => readPageFiles(kind, root));
  const seen = new Map<string, string>();
  for (const file of files) {
    const other = seen.get(file.slug);
    // `page` is unique on slug and audience across every kind, so a slug is used once.
    if (other) throw new Error(`content/pages: the slug "${file.slug}" is used by both ${other} and ${file.kind}. Rename one of them.`);
    seen.set(file.slug, file.kind);
  }
  return files;
}

export type { ImportPagesOptions, ImportPagesResult };

/**
 * Imports every page file. Legal pages stay unpublished drafts unless `publishDrafts` is set,
 * which is refused outside local development and tests.
 */
export async function importPages(ctx: Ctx, options: ImportPagesOptions & { root?: string } = {}): Promise<ImportPagesResult> {
  return upsertPagesFromFiles(ctx, readAllPageFiles(options.root), { publishDrafts: options.publishDrafts });
}

export function formatImportPagesResult(result: ImportPagesResult): string {
  const list = (items: string[]) => (items.length > 0 ? items.join(", ") : "none");
  return [
    `Pages: ${result.created.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged.`,
    `  Now showing a new version: ${list(result.published)}`,
    `  Left alone because a person edited or published them in Studio: ${list(result.keptStudioVersion)}`,
    `  Legal drafts NOT published (publish reviewed text in Studio): ${list(result.legalDrafts)}`,
  ].join("\n");
}

async function main(): Promise<void> {
  // DOTENV_PATH only chooses which env file to load; every other variable is read through `@/env`.
  config({ path: process.env.DOTENV_PATH ?? ".env.local", quiet: true });
  try {
    const ctx: Ctx = { db, actor: systemActor("pages.import"), now: new Date(), requestId: `script:pages.import:${randomUUID()}` };
    const result = await importPages(ctx, { publishDrafts: process.argv.includes("--publish-drafts") });
    console.info(formatImportPagesResult(result));
  } finally {
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error("Page import failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
