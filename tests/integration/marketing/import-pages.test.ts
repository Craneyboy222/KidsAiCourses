import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/env";
import { LEGAL_DRAFT_BANNER, LEGAL_SLUGS } from "@/lib/marketing/site";
import { systemActor } from "@/server/authz/actor";
import { auditLog, page, pageVersion } from "@/server/db/schema";
import { getLegalPage, getSitePage, listHelpArticles, listReviewedLegalSlugs, readPageFiles, upsertPagesFromFiles } from "@/server/services/pages";
import { computeLaunchReadiness, markLaunchReadyForDev } from "@/server/settings/launch-readiness";
import { importPages, readAllPageFiles } from "../../../scripts/import-pages";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createStaff } from "../../helpers/factories";

beforeEach(resetDb);
afterAll(closeDb);

const T0 = new Date("2026-11-16T10:00:00.000Z");
const sys = (now: Date = T0) => testCtx(systemActor("pages.import"), { now });

async function versionsOf(kind: "marketing" | "help" | "legal", slug: string) {
  const [row] = await db.select().from(page).where(and(eq(page.kind, kind), eq(page.slug, slug)));
  if (!row) return { page: null, versions: [] };
  const versions = await db.select().from(pageVersion).where(eq(pageVersion.pageId, row.id)).orderBy(asc(pageVersion.version));
  return { page: row, versions };
}

const legalItem = async () => (await computeLaunchReadiness({ db })).items.find((item) => item.key === "legal_pages_published");

describe("importing the page files", () => {
  it("imports the legal pages as drafts and never publishes them, so the launch gate stays shut", async () => {
    const result = await importPages(sys());

    expect([...result.legalDrafts].sort()).toEqual(LEGAL_SLUGS.map((slug) => `legal/${slug}`).sort());
    expect(result.published.some((name) => name.startsWith("legal/"))).toBe(false);

    for (const slug of LEGAL_SLUGS) {
      const { page: row, versions } = await versionsOf("legal", slug);
      expect(row, slug).not.toBeNull();
      expect(row?.currentVersionId, slug).toBeNull();
      expect(versions.map((version) => version.status), slug).toEqual(["draft"]);
      expect(versions[0]?.publishedAt, slug).toBeNull();
      expect(versions[0]?.body, slug).toContain(LEGAL_DRAFT_BANNER);
      // The public page says it is not published; the draft text is not shown and not read from the file.
      expect(await getLegalPage({ db }, slug), slug).toEqual({ state: "unpublished", slug });
    }
    expect(await listReviewedLegalSlugs({ db })).toEqual([]);

    const item = await legalItem();
    expect(item?.satisfied).toBe(false);
    expect(item?.detail).toContain("privacy");
    expect((await computeLaunchReadiness({ db })).ready).toBe(false);
  });

  it("still publishes nothing legal when it is run again and again", async () => {
    await importPages(sys());
    const second = await importPages(sys(new Date(T0.getTime() + 60_000)));
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.published).toEqual([]);
    expect(second.unchanged).toHaveLength(readAllPageFiles().length);
    for (const slug of LEGAL_SLUGS) {
      const { page: row, versions } = await versionsOf("legal", slug);
      expect(versions).toHaveLength(1);
      expect(row?.currentVersionId).toBeNull();
    }
    expect((await legalItem())?.satisfied).toBe(false);
  });

  it("publishes the marketing and help pages, with their summary, topic and audience", async () => {
    const result = await importPages(sys());
    const files = readAllPageFiles().filter((file) => file.kind !== "legal");
    expect([...result.published].sort()).toEqual(files.map((file) => `${file.kind}/${file.slug}`).sort());

    const safety = await getSitePage({ db }, "marketing", "safety");
    expect(safety).toMatchObject({ source: "database", title: "Safety", kind: "marketing" });
    expect(safety?.body.startsWith("---")).toBe(false);
    expect(safety?.updatedAt).toEqual(T0);

    const help = await listHelpArticles({ db });
    expect(help).toHaveLength(files.filter((file) => file.kind === "help").length);
    expect(help.length).toBeGreaterThanOrEqual(15);
    expect(help.every((article) => article.source === "database" && article.summary && article.topic)).toBe(true);
    expect(help.find((article) => article.slug === "what-my-parent-can-see")).toMatchObject({ audience: "teen", topic: "consent" });
    expect(help.map((article) => article.position)).toEqual([...help.map((article) => article.position)].sort((a, b) => a - b));
  });

  it("writes one audit entry for the import", async () => {
    await importPages(sys());
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, "page.import"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.meta).toMatchObject({ publishDrafts: false });
  });

  it("adds a new version when a file changes and keeps the old one", async () => {
    const files = readPageFiles("help");
    const first = files[0]!;
    await upsertPagesFromFiles(sys(), [first]);
    const later = new Date(T0.getTime() + 3_600_000);
    const changed = { ...first, body: `${first.body}\n\nOne more line.` };
    const result = await upsertPagesFromFiles(sys(later), [changed]);
    expect(result.updated).toEqual([`help/${first.slug}`]);
    expect(result.published).toEqual([`help/${first.slug}`]);

    const { page: row, versions } = await versionsOf("help", first.slug);
    expect(versions.map((version) => [version.version, version.status])).toEqual([[1, "archived"], [2, "published"]]);
    expect(row?.currentVersionId).toBe(versions[1]?.id);
    expect((await getSitePage({ db }, "help", first.slug))?.body).toContain("One more line.");
  });

  it("never overwrites a page a person has edited or published in Studio", async () => {
    await importPages(sys());
    const { user: editor } = await createStaff({ roles: ["editor"] });

    // A person writes a new version of a help article in Studio.
    const help = await versionsOf("help", "invite-codes");
    const [edited] = await db
      .insert(pageVersion)
      .values({ pageId: help.page!.id, version: 2, title: "Invite codes (edited)", body: "Edited in Studio.", status: "published", createdBy: editor.id, publishedBy: editor.id, publishedAt: T0 })
      .returning();
    await db.update(page).set({ currentVersionId: edited!.id }).where(eq(page.id, help.page!.id));

    // A person publishes reviewed privacy text in Studio.
    const privacy = await versionsOf("legal", "privacy");
    const [reviewed] = await db
      .insert(pageVersion)
      .values({ pageId: privacy.page!.id, version: 2, title: "Privacy notice", body: "Reviewed privacy text with nothing left open.", status: "published", createdBy: editor.id, publishedBy: editor.id, publishedAt: T0 })
      .returning();
    await db.update(page).set({ currentVersionId: reviewed!.id }).where(eq(page.id, privacy.page!.id));

    const result = await importPages(sys(new Date(T0.getTime() + 60_000)), { publishDrafts: true });
    expect(result.keptStudioVersion).toEqual(expect.arrayContaining(["help/invite-codes", "legal/privacy"]));

    expect((await getSitePage({ db }, "help", "invite-codes"))?.body).toBe("Edited in Studio.");
    const shown = await getLegalPage({ db }, "privacy");
    expect(shown).toMatchObject({ state: "published", draft: false });
    expect(shown?.state === "published" && shown.page.body).toBe("Reviewed privacy text with nothing left open.");
    expect(await listReviewedLegalSlugs({ db })).toEqual(["privacy"]);
    expect((await versionsOf("legal", "privacy")).versions).toHaveLength(2);
  });

  it("refuses to run for anyone who may not manage pages", async () => {
    const { family, parentActor } = await createFamily();
    const { actor: learner } = await createLearner({ age: 15, familyId: family.id });
    for (const actor of [parentActor, learner]) {
      await expect(importPages(testCtx(actor))).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(importPages(testCtx())).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await db.select().from(page)).toEqual([]);
  });
});

describe("publishing the drafts for local development", () => {
  it("publishes the legal drafts with their banner, marked as drafts and kept out of the sitemap", async () => {
    const result = await importPages(sys(), { publishDrafts: true });
    expect(result.legalDrafts).toEqual([]);
    for (const slug of LEGAL_SLUGS) {
      const shown = await getLegalPage({ db }, slug);
      expect(shown?.state, slug).toBe("published");
      if (shown?.state !== "published") continue;
      expect(shown.draft, slug).toBe(true);
      expect(shown.page.body, slug).toContain(LEGAL_DRAFT_BANNER);
      expect(shown.page.body, slug).toContain("⚖️ TO CONFIRM");
    }
    // Published drafts satisfy the development gate, but are never offered to search engines.
    expect((await legalItem())?.satisfied).toBe(true);
    expect(await listReviewedLegalSlugs({ db })).toEqual([]);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "page.import"));
    expect(entry?.meta).toMatchObject({ publishDrafts: true });
  });

  it("replaces the development placeholder pages, in either order", async () => {
    await markLaunchReadyForDev(sys());
    expect((await getLegalPage({ db }, "terms"))?.state).toBe("published");

    // A plain import leaves the placeholder showing and adds the draft beside it.
    const plain = await importPages(sys());
    expect(plain.legalDrafts).toHaveLength(LEGAL_SLUGS.length);
    const before = await getLegalPage({ db }, "terms");
    expect(before?.state === "published" && before.page.body).toContain("Placeholder text for local development");

    const published = await importPages(sys(new Date(T0.getTime() + 60_000)), { publishDrafts: true });
    expect(published.published.filter((name) => name.startsWith("legal/"))).toHaveLength(LEGAL_SLUGS.length);
    const after = await getLegalPage({ db }, "terms");
    expect(after).toMatchObject({ state: "published", draft: true });
    // One page per slug: the importer reused the placeholder's row.
    for (const slug of LEGAL_SLUGS) expect(await db.select().from(page).where(and(eq(page.kind, "legal"), eq(page.slug, slug))), slug).toHaveLength(1);

    // And the other way round: the placeholder step leaves published drafts alone.
    await markLaunchReadyForDev(sys(new Date(T0.getTime() + 120_000)));
    expect(await getLegalPage({ db }, "terms")).toMatchObject({ state: "published", draft: true });
  });

  it("is refused outside local development and tests, and a plain import there still publishes nothing legal", async () => {
    // The guard is "anything but local or test"; a preview configuration is the one that can be loaded here.
    const saved = { APP_ENV: process.env.APP_ENV, STAFF_2FA_REQUIRED: process.env.STAFF_2FA_REQUIRED };
    process.env.APP_ENV = "preview";
    process.env.STAFF_2FA_REQUIRED = "true";
    resetEnvCache();
    try {
      expect(env.APP_ENV).toBe("preview");
      await expect(importPages(sys(), { publishDrafts: true })).rejects.toMatchObject({ code: "forbidden" });
      expect(await db.select().from(page)).toEqual([]);

      const plain = await importPages(sys());
      expect(plain.legalDrafts).toHaveLength(LEGAL_SLUGS.length);
      expect(plain.published.some((name) => name.startsWith("legal/"))).toBe(false);
    } finally {
      process.env.APP_ENV = saved.APP_ENV;
      process.env.STAFF_2FA_REQUIRED = saved.STAFF_2FA_REQUIRED;
      resetEnvCache();
    }
    expect(env.APP_ENV).toBe("test");
    expect((await legalItem())?.satisfied).toBe(false);
  });
});
