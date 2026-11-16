import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSitemap } from "@/lib/marketing/seo";
import { LEGAL_SLUGS, isPrivatePath } from "@/lib/marketing/site";
import { systemActor } from "@/server/authz/actor";
import { page, pageVersion } from "@/server/db/schema";
import { getLegalPage, getSitePage, listHelpArticles, listReviewedLegalSlugs, readPageFiles } from "@/server/services/pages";
import { importPages } from "../../../scripts/import-pages";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

const T0 = new Date("2026-11-16T10:00:00.000Z");
const sys = () => testCtx(systemActor("pages.import"), { now: T0 });

describe("reading pages", () => {
  it("falls back to the shipped files for marketing and help pages when the database has none", async () => {
    const safety = await getSitePage({ db }, "marketing", "safety");
    expect(safety).toMatchObject({ source: "file", title: "Safety", updatedAt: null });
    expect(safety?.body).toContain("Tools from other companies");

    const help = await listHelpArticles({ db });
    expect(help).toHaveLength(readPageFiles("help").length);
    expect(help.every((article) => article.source === "file")).toBe(true);
    expect(await getSitePage({ db }, "help", "invite-codes")).toMatchObject({ source: "file", topic: "accounts" });
    expect(await getSitePage({ db }, "marketing", "no-such-page")).toBeNull();
  });

  it("NEVER falls back to the draft files for a legal page", async () => {
    for (const slug of LEGAL_SLUGS) expect(await getLegalPage({ db }, slug), slug).toEqual({ state: "unpublished", slug });
    for (const slug of ["privacy-teens", "ai-use", "refunds", "../privacy", ""]) expect(await getLegalPage({ db }, slug), slug).toBeNull();
    expect(await listReviewedLegalSlugs({ db })).toEqual([]);
  });

  it("lets Studio take a page down: a row with nothing published hides the page, file or no file", async () => {
    await importPages(sys());
    const [row] = await db.select().from(page).where(eq(page.slug, "invite-codes"));
    await db.update(pageVersion).set({ status: "archived" }).where(eq(pageVersion.pageId, row!.id));
    await db.update(page).set({ currentVersionId: null }).where(eq(page.id, row!.id));

    expect(await getSitePage({ db }, "help", "invite-codes")).toBeNull();
    const help = await listHelpArticles({ db });
    expect(help.map((article) => article.slug)).not.toContain("invite-codes");
    expect(help).toHaveLength(readPageFiles("help").length - 1);
  });

  it("shows a help article added in Studio beside the shipped ones", async () => {
    const [row] = await db.insert(page).values({ slug: "studio-only-article", kind: "help", audience: "adult", title: "Added in Studio", position: 5 }).returning();
    const [version] = await db
      .insert(pageVersion)
      .values({ pageId: row!.id, version: 1, title: "Added in Studio", body: "---\nsummary: Written in Studio for parents.\ntopic: billing\n---\nSome help text.", status: "published", publishedAt: T0 })
      .returning();
    await db.update(page).set({ currentVersionId: version!.id }).where(eq(page.id, row!.id));

    const help = await listHelpArticles({ db });
    expect(help).toHaveLength(readPageFiles("help").length + 1);
    expect(help.find((article) => article.slug === "studio-only-article")).toMatchObject({ source: "database", audience: "adult", topic: "billing", summary: "Written in Studio for parents.", body: "Some help text." });
    expect(help[0]?.slug).toBe("studio-only-article");
  });

  it("does not show a draft version of a marketing page", async () => {
    const [row] = await db.insert(page).values({ slug: "safety", kind: "marketing", title: "Safety" }).returning();
    await db.insert(pageVersion).values({ pageId: row!.id, version: 1, title: "Safety (draft)", body: "Unfinished.", status: "draft" });
    expect(await getSitePage({ db }, "marketing", "safety")).toBeNull();
  });
});

describe("the sitemap, from real data", () => {
  it("lists help articles and only reviewed legal pages, and nothing private", async () => {
    await importPages(sys(), { publishDrafts: true });
    const helpArticles = (await listHelpArticles({ db })).map((article) => ({ slug: article.slug, lastModified: article.updatedAt }));
    const withDrafts = buildSitemap({ appUrl: "https://studio.example", now: T0, courses: [], helpArticles, legalSlugs: await listReviewedLegalSlugs({ db }) });
    const paths = withDrafts.map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain("/help/invite-codes");
    expect(paths.filter((path) => path.startsWith("/help/"))).toHaveLength(helpArticles.length);
    // Published drafts are shown with a banner but are not offered to search engines.
    expect(paths.some((path) => path.startsWith("/legal/"))).toBe(false);
    expect(paths.some(isPrivatePath)).toBe(false);

    // Once a person publishes reviewed text, that page is listed.
    const [row] = await db.select().from(page).where(eq(page.slug, "cookies"));
    await db.update(pageVersion).set({ body: "Reviewed cookie notice." }).where(eq(pageVersion.id, row!.currentVersionId!));
    expect(await listReviewedLegalSlugs({ db })).toEqual(["cookies"]);
  });
});
