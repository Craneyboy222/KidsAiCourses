import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { env } from "@/env";
import {
  fromStoredBody,
  isUnreviewedLegalText,
  parsePageFile,
  toStoredBody,
  type HelpTopic,
  type PageFile,
  type PageFileAudience,
  type PageFileKind,
} from "@/lib/marketing/page-file";
import { LEGAL_SLUGS, isLegalSlug, type LegalSlug } from "@/lib/marketing/site";
import { audit } from "@/server/audit";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { sha256 } from "@/server/crypto";
import { page, pageVersion } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";

/**
 * The site's own pages (spec Section 5: "All marketing, legal and help copy is editable in admin").
 *
 * Where the words come from:
 * - **Marketing and help.** A `page` row wins: its published version is shown, and a row with
 *   nothing published is hidden. A page with no row at all falls back to the file shipped in
 *   `content/pages/<kind>/<slug>.md`, so a database that has not been seeded still has a working
 *   Safety page and help centre. Once `scripts/import-pages.ts` has run, every page has a row and
 *   Studio is in charge.
 * - **Legal.** Only a published row is ever shown. There is no fallback to the files: they are
 *   unreviewed drafts, and publishing one is a person's decision (launch-readiness item
 *   `legal_pages_published`, decision D2).
 *
 * Reading is open to everyone. Writing is `page.manage`.
 */
export type SitePage = {
  slug: string;
  kind: PageFileKind;
  audience: PageFileAudience;
  title: string;
  summary: string | null;
  topic: HelpTopic | null;
  position: number;
  /** Markdown with no front matter. */
  body: string;
  /** When the shown version was published. `null` for a page read from its file. */
  updatedAt: Date | null;
  source: "database" | "file";
};

type ReadCtx = Pick<Ctx, "db">;

// ── The files shipped with the code ─────────────────────────────────────────

/**
 * Three literal joins, not one built from a variable, so that the build's file tracer can see
 * which folders are read at run time (the same approach as `src/server/ai/prompt-files.ts`).
 */
function pagesDir(kind: PageFileKind, root: string = process.cwd()): string {
  switch (kind) {
    case "marketing":
      return join(root, "content", "pages", "marketing");
    case "help":
      return join(root, "content", "pages", "help");
    case "legal":
      return join(root, "content", "pages", "legal");
  }
}

/** Reads and checks every page file of one kind. Throws, naming the file, when one is wrong. */
export function readPageFiles(kind: PageFileKind, root?: string): PageFile[] {
  const dir = pagesDir(kind, root);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => parsePageFile(readFileSync(join(dir, name), "utf8"), { kind, slug: name.slice(0, -3) }));
}

const fileCache = new Map<PageFileKind, PageFile[]>();

/**
 * The shipped files of one kind, for the fallback. Never throws: a missing folder or a broken
 * file means "no fallback", and the page says it is unavailable rather than failing.
 */
function bundledPages(kind: Exclude<PageFileKind, "legal">): PageFile[] {
  const cached = fileCache.get(kind);
  if (cached) return cached;
  let files: PageFile[] = [];
  try {
    files = readPageFiles(kind);
  } catch (error) {
    logWarn("pages.bundled_unavailable", { kind, error: error instanceof Error ? error.message : String(error) });
  }
  // Files do not change while a production server runs. In development they are re-read each time.
  if (env.APP_ENV === "production" || env.APP_ENV === "preview") fileCache.set(kind, files);
  return files;
}

const fromFile = (file: PageFile): SitePage => ({ ...file, updatedAt: null, source: "file" });

// ── Reading ─────────────────────────────────────────────────────────────────

type PublishedRow = {
  slug: string;
  audience: PageFileAudience;
  position: number;
  title: string;
  body: string;
  publishedAt: Date | null;
};

function fromRow(kind: PageFileKind, row: PublishedRow): SitePage {
  const stored = fromStoredBody(row.body);
  return {
    slug: row.slug,
    kind,
    audience: row.audience,
    title: row.title,
    summary: stored.summary,
    topic: stored.topic,
    position: row.position,
    body: stored.body,
    updatedAt: row.publishedAt,
    source: "database",
  };
}

const publishedColumns = {
  slug: page.slug,
  audience: page.audience,
  position: page.position,
  title: pageVersion.title,
  body: pageVersion.body,
  publishedAt: pageVersion.publishedAt,
};

/** One marketing or help page, or `null` when there is nothing to show. */
export async function getSitePage(ctx: ReadCtx, kind: Exclude<PageFileKind, "legal">, slug: string): Promise<SitePage | null> {
  const rows = await ctx.db
    .select({ ...publishedColumns, status: pageVersion.status })
    .from(page)
    .leftJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
    .where(and(eq(page.kind, kind), eq(page.slug, slug)))
    .orderBy(asc(page.createdAt));
  if (rows.length > 0) {
    // The row is in charge, even when it has nothing published: Studio can take a page down.
    const live = rows.find((row) => row.status === "published" && row.title !== null && row.body !== null);
    return live ? fromRow(kind, { ...live, title: live.title ?? "", body: live.body ?? "" }) : null;
  }
  const file = bundledPages(kind).find((candidate) => candidate.slug === slug);
  return file ? fromFile(file) : null;
}

/** Every help article that can be shown, in set order. */
export async function listHelpArticles(ctx: ReadCtx): Promise<SitePage[]> {
  const [known, published] = await Promise.all([
    ctx.db.select({ slug: page.slug }).from(page).where(eq(page.kind, "help")),
    ctx.db
      .select(publishedColumns)
      .from(page)
      .innerJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
      .where(and(eq(page.kind, "help"), eq(pageVersion.status, "published"))),
  ]);
  const inDatabase = new Set(known.map((row) => row.slug));
  const articles = [
    ...published.map((row) => fromRow("help", row)),
    ...bundledPages("help").filter((file) => !inDatabase.has(file.slug)).map(fromFile),
  ];
  // A slug can have a row per audience; show one article per slug.
  const seen = new Set<string>();
  return articles
    .filter((article) => (seen.has(article.slug) ? false : (seen.add(article.slug), true)))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "en-GB"));
}

export type LegalPageState =
  /** Published. `draft` is true while the text still says it has not been reviewed: the page then shows the banner and is not indexed. */
  | { state: "published"; page: SitePage; draft: boolean }
  /** One of the six legal addresses, with nothing published yet. */
  | { state: "unpublished"; slug: LegalSlug };

/** A legal page by its D16 slug, or `null` for any other slug. Never reads the draft files. */
export async function getLegalPage(ctx: ReadCtx, slug: string): Promise<LegalPageState | null> {
  if (!isLegalSlug(slug)) return null;
  const rows = await ctx.db
    .select(publishedColumns)
    .from(page)
    .innerJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
    .where(and(eq(page.kind, "legal"), eq(page.slug, slug), eq(pageVersion.status, "published")))
    .orderBy(asc(page.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return { state: "unpublished", slug };
  const found = fromRow("legal", row);
  return { state: "published", page: found, draft: isUnreviewedLegalText(found.body) };
}

/** Legal pages that are published and no longer marked as drafts: the only ones that go in the sitemap. */
export async function listReviewedLegalSlugs(ctx: ReadCtx): Promise<LegalSlug[]> {
  const rows = await ctx.db
    .select({ slug: page.slug, body: pageVersion.body })
    .from(page)
    .innerJoin(pageVersion, eq(pageVersion.id, page.currentVersionId))
    .where(and(eq(page.kind, "legal"), eq(pageVersion.status, "published"), inArray(page.slug, [...LEGAL_SLUGS])));
  const reviewed = new Set(rows.filter((row) => !isUnreviewedLegalText(row.body)).map((row) => row.slug));
  return LEGAL_SLUGS.filter((slug) => reviewed.has(slug));
}

// ── Importing the files ─────────────────────────────────────────────────────

export type ImportPagesOptions = {
  /**
   * Local development and tests only: also publish the legal drafts, with their draft banner,
   * so the legal pages can be looked at. Refused in preview and production.
   */
  publishDrafts?: boolean;
};

export type ImportPagesResult = {
  /** `kind/slug` of pages made for the first time. */
  created: string[];
  /** Pages that got a new version because the file changed. */
  updated: string[];
  unchanged: string[];
  /** Pages left alone because a person has edited or published them in Studio. */
  keptStudioVersion: string[];
  /** Pages whose shown version changed in this run. */
  published: string[];
  /** Legal pages that are still drafts after this run. */
  legalDrafts: string[];
};

const importNote = (file: PageFile, hash: string): string => `Imported from content/pages/${file.kind}/${file.slug}.md · ${hash}`;

/**
 * Loads page files into `page` and `page_version`. Safe to run again.
 *
 * - Marketing and help pages are published as they are imported.
 * - **Legal pages are imported as drafts and never published here**, so the launch-readiness gate
 *   stays shut until a person publishes reviewed text in Studio. `publishDrafts` is the one
 *   exception, and only where `APP_ENV` is `local` or `test`.
 * - A file that has not changed adds nothing. A changed file adds a new version; old versions are kept.
 * - A page whose newest version was written by a person, or whose shown version was published by
 *   a person, is never overwritten from a file.
 */
export async function upsertPagesFromFiles(ctx: Ctx, files: readonly PageFile[], options: ImportPagesOptions = {}): Promise<ImportPagesResult> {
  assertCan(ctx.actor, "page.manage");
  const publishDrafts = options.publishDrafts === true;
  if (publishDrafts && env.APP_ENV !== "local" && env.APP_ENV !== "test") {
    throw new AppError("forbidden", "Legal drafts can only be published automatically in local development and tests. Publish reviewed legal pages in Studio.");
  }

  const result: ImportPagesResult = { created: [], updated: [], unchanged: [], keptStudioVersion: [], published: [], legalDrafts: [] };

  await ctx.db.transaction(async (tx) => {
    for (const file of files) {
      const name = `${file.kind}/${file.slug}`;
      const body = toStoredBody(file);
      const hash = sha256(`${file.title}\n${body}`).slice(0, 16);
      const shouldPublish = file.kind !== "legal" || publishDrafts;

      const existing = await tx
        .select({ id: page.id, currentVersionId: page.currentVersionId })
        .from(page)
        .where(and(eq(page.kind, file.kind), eq(page.slug, file.slug)))
        .orderBy(asc(page.createdAt))
        .limit(1);
      let pageId = existing[0]?.id;
      let currentVersionId = existing[0]?.currentVersionId ?? null;

      if (!pageId) {
        const inserted = await tx
          .insert(page)
          .values({ slug: file.slug, kind: file.kind, audience: file.audience, title: file.title, position: file.position, createdAt: ctx.now, updatedAt: ctx.now })
          .returning({ id: page.id });
        pageId = inserted[0]?.id;
        if (!pageId) throw new Error(`Could not create the page "${name}"`);
        result.created.push(name);
      }

      const versions = await tx
        .select({
          id: pageVersion.id,
          version: pageVersion.version,
          status: pageVersion.status,
          changeNote: pageVersion.changeNote,
          createdBy: pageVersion.createdBy,
          publishedBy: pageVersion.publishedBy,
        })
        .from(pageVersion)
        .where(eq(pageVersion.pageId, pageId))
        .orderBy(desc(pageVersion.version));
      const latest = versions[0];
      const current = versions.find((version) => version.id === currentVersionId);

      // A person's work in Studio always wins over a file.
      const personEdited = latest?.createdBy != null;
      const personPublished = current?.publishedBy != null;
      if (personEdited || (personPublished && shouldPublish)) {
        result.keptStudioVersion.push(name);
        if (file.kind === "legal" && current?.status !== "published") result.legalDrafts.push(name);
        continue;
      }

      let versionId = latest?.id;
      const sameText = latest?.changeNote === importNote(file, hash);
      if (!latest || !sameText) {
        const inserted = await tx
          .insert(pageVersion)
          .values({
            pageId,
            version: (latest?.version ?? 0) + 1,
            title: file.title,
            body,
            status: "draft",
            changeNote: importNote(file, hash),
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning({ id: pageVersion.id });
        versionId = inserted[0]?.id;
        if (latest) result.updated.push(name);
      } else if (!result.created.includes(name)) {
        result.unchanged.push(name);
      }
      if (!versionId) throw new Error(`Could not save a version of the page "${name}"`);

      if (shouldPublish && currentVersionId !== versionId) {
        if (current && current.status === "published") {
          await tx.update(pageVersion).set({ status: "archived", updatedAt: ctx.now }).where(eq(pageVersion.id, current.id));
        }
        await tx.update(pageVersion).set({ status: "published", publishedAt: ctx.now, updatedAt: ctx.now }).where(eq(pageVersion.id, versionId));
        currentVersionId = versionId;
        result.published.push(name);
      }

      await tx
        .update(page)
        .set({ title: file.title, audience: file.audience, position: file.position, currentVersionId, updatedAt: ctx.now })
        .where(eq(page.id, pageId));

      if (file.kind === "legal" && currentVersionId !== versionId) result.legalDrafts.push(name);
    }

    await audit(
      ctx,
      {
        action: "page.import",
        targetType: "page",
        reason: publishDrafts ? "Development import: legal drafts published with their draft banner" : undefined,
        meta: {
          created: result.created,
          updated: result.updated,
          published: result.published,
          keptStudioVersion: result.keptStudioVersion,
          legalDrafts: result.legalDrafts,
          publishDrafts,
        },
      },
      tx,
    );
  });

  return result;
}
