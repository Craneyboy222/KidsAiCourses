import type { MetadataRoute } from "next";
import { env } from "@/env";
import { buildSitemap } from "@/lib/marketing/seo";
import { ANONYMOUS } from "@/server/authz/actor";
import { getCtx } from "@/server/context";
import { logWarn } from "@/server/log";
import { listPublicCourseEntries } from "@/server/services/marketing";
import { listHelpArticles, listReviewedLegalSlugs } from "@/server/services/pages";

// Built on request: courses are published and help articles edited without a deploy.
export const dynamic = "force-dynamic";

/**
 * sitemap.xml: the public pages, every published course, every help article and the legal pages
 * that have been reviewed and published. Nothing signed-in, no certificate checks, no approval or
 * invite links, no previews: `buildSitemap` refuses those whatever it is given.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Always the public view, whoever happens to be asking.
  const ctx = { ...(await getCtx()), actor: ANONYMOUS };
  const [courses, helpArticles, legalSlugs] = await Promise.all([
    listPublicCourseEntries(ctx).catch((error: unknown) => {
      logWarn("sitemap.courses_unavailable", { error: error instanceof Error ? error.message : String(error) });
      return [];
    }),
    listHelpArticles(ctx).then((articles) => articles.map((article) => ({ slug: article.slug, lastModified: article.updatedAt }))),
    listReviewedLegalSlugs(ctx),
  ]);
  return buildSitemap({ appUrl: env.NEXT_PUBLIC_APP_URL, now: ctx.now, courses, helpArticles, legalSlugs });
}
