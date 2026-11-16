import type { MetadataRoute } from "next";
import { LEGAL_SLUGS, PUBLIC_ROUTES, ROBOTS_DISALLOW, isIndexablePath } from "./site";

/**
 * robots.txt and sitemap.xml, built by pure functions so the rules can be tested without a
 * server. `src/app/robots.ts` and `src/app/sitemap.ts` only fetch the data and call these.
 */

/** `https://example.org/` and `https://example.org` both become `https://example.org`. */
export function siteOrigin(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/**
 * The name our fetcher uses in robots.txt: the part of its User-Agent before the version.
 * `PlatformRadar/1.0 (+https://…/radar)` gives `PlatformRadar`.
 */
export function radarProductToken(userAgent: string): string {
  const token = userAgent.trim().split(/[\s/]/)[0] ?? "";
  return /^[A-Za-z0-9._-]{2,60}$/.test(token) ? token : "PlatformRadar";
}

/**
 * Only the production site may be indexed. A preview or local copy asks every crawler to stay
 * away from all of it, so a test address can never compete with the real one in search results.
 */
export function buildRobots(input: { appUrl: string; indexable: boolean }): MetadataRoute.Robots {
  const origin = siteOrigin(input.appUrl);
  if (!input.indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

export type SitemapInput = {
  appUrl: string;
  now: Date;
  courses: readonly { slug: string; lastModified: Date | null }[];
  helpArticles: readonly { slug: string; lastModified: Date | null }[];
  /** Legal pages that are published and no longer marked as drafts. */
  legalSlugs: readonly string[];
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every address that may be listed, and nothing else. Each one passes `isIndexablePath`, so a
 * signed-in area, a certificate check, an approval or invite link, a preview or an API route can
 * never be emitted, whatever the data holds.
 */
export function buildSitemap(input: SitemapInput): MetadataRoute.Sitemap {
  const origin = siteOrigin(input.appUrl);
  const entries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();
  const add = (path: string, extra: Omit<MetadataRoute.Sitemap[number], "url">) => {
    if (!isIndexablePath(path) || seen.has(path)) return;
    seen.add(path);
    entries.push({ url: path === "/" ? origin : `${origin}${path}`, ...extra });
  };

  for (const route of PUBLIC_ROUTES) add(route.path, { lastModified: input.now, changeFrequency: route.changeFrequency, priority: route.priority });
  for (const course of input.courses) {
    if (SLUG.test(course.slug)) add(`/courses/${course.slug}`, { lastModified: course.lastModified ?? input.now, changeFrequency: "weekly", priority: 0.8 });
  }
  for (const article of input.helpArticles) {
    if (SLUG.test(article.slug)) add(`/help/${article.slug}`, { lastModified: article.lastModified ?? input.now, changeFrequency: "monthly", priority: 0.5 });
  }
  for (const slug of input.legalSlugs) {
    if ((LEGAL_SLUGS as readonly string[]).includes(slug)) add(`/legal/${slug}`, { lastModified: input.now, changeFrequency: "yearly", priority: 0.3 });
  }
  return entries;
}
