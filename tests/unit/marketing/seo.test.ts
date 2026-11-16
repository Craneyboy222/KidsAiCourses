import { describe, expect, it } from "vitest";
import { MARKETING_HELP_LINKS, MARKETING_LEGAL_LINKS, MARKETING_NAV } from "@/components/layout";
import { LEARNER_AREAS, PARENT_AREAS, STUDIO_AREAS, needsSession } from "@/lib/protected-paths";
import { buildRobots, buildSitemap, radarProductToken, siteOrigin } from "@/lib/marketing/seo";
import { LEGAL_SLUGS, PRIVATE_SEGMENTS, PUBLIC_ROUTES, ROBOTS_DISALLOW, homeLinkFor, isIndexablePath, isPrivatePath, isUnder18Learner } from "@/lib/marketing/site";
import { REQUIRED_LEGAL_SLUGS } from "@/server/settings/launch-readiness";

const APP_URL = "https://studio.example/";
const NOW = new Date("2026-11-16T10:00:00.000Z");
const pathsOf = (entries: { url: string }[]) => entries.map((entry) => new URL(entry.url).pathname);

describe("which addresses are private", () => {
  it("covers every signed-in area the sign-in redirect knows about", () => {
    for (const area of [...LEARNER_AREAS, ...PARENT_AREAS, ...STUDIO_AREAS]) expect(PRIVATE_SEGMENTS, area).toContain(area);
    for (const path of ["/home", "/parent/billing", "/studio/users", "/learn/x/y"]) expect(needsSession(path) && isPrivatePath(path), path).toBe(true);
  });

  it("treats code and token links, sign-in, the API, previews and development pages as private", () => {
    for (const path of ["/verify/ABCD-EFGH", "/approve/tok", "/join/CODE", "/join", "/signin?next=%2Fhome", "/signup/teen", "/reset", "/api/health", "/preview/x", "/dev/kit", "/offline", "/HOME"]) {
      expect(isPrivatePath(path), path).toBe(true);
      expect(isIndexablePath(path), path).toBe(false);
    }
  });

  it("leaves the public pages public, including ones whose names start like a private one", () => {
    for (const path of ["/", "/courses", "/courses/build-an-app", "/parents", "/pricing", "/safety", "/how-it-works", "/help", "/help/invite-codes", "/legal/privacy", "/radar", "/homework", "/parenting"]) {
      expect(isPrivatePath(path), path).toBe(false);
      expect(isIndexablePath(path), path).toBe(true);
    }
    expect(isIndexablePath("/courses/build-an-app/taster")).toBe(false);
    expect(isIndexablePath("//evil.example/")).toBe(false);
    expect(isIndexablePath("courses")).toBe(false);
  });
});

describe("robots.txt", () => {
  const robots = buildRobots({ appUrl: APP_URL, indexable: true });
  const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
  const disallow = rules.flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));
  /** robots.txt matching (RFC 9309): a rule is a prefix of the path and query, and `$` anchors the end. */
  const blocked = (path: string) => disallow.some((rule) => (rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule)));

  it("has one rule for every crawler, and names the sitemap", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0]?.userAgent).toBe("*");
    expect(rules[0]?.allow).toBe("/");
    expect(robots.sitemap).toBe("https://studio.example/sitemap.xml");
    expect(robots.host).toBe("https://studio.example");
  });

  it("closes every signed-in area, the API and development pages to crawlers", () => {
    for (const path of ["/home", "/explore", "/explore/x", "/explore?q=apps", "/learn/a/b", "/portfolio/1", "/certificates", "/settings/billing", "/onboarding", "/parent", "/parent/billing", "/studio", "/studio/audit", "/api/v1/courses", "/dev/kit", "/preview/t", "/signin", "/signin?next=%2Fhome", "/signup/parent", "/reset", "/blocked-age", "/offline"]) {
      expect(blocked(path), path).toBe(true);
    }
  });

  it("leaves the marketing, course, help and legal pages open", () => {
    for (const path of ["/", "/courses", "/courses/build-an-app", "/parents", "/pricing", "/safety", "/how-it-works", "/help", "/help/invite-codes", "/legal/privacy", "/radar", "/homework", "/parents-evening", "/sitemap.xml"]) {
      expect(blocked(path), path).toBe(false);
    }
  });

  it("does not block code and token links, so crawlers can read their noindex instruction", () => {
    // A blocked address can still be listed by its bare address if someone links to it. These
    // pages answer `noindex` (next.config.ts, and the pages' own metadata), which a crawler only
    // sees if it is allowed to fetch them.
    for (const path of ["/verify/ABCD-EFGH", "/approve/token", "/join/CODE"]) expect(blocked(path), path).toBe(false);
    expect(ROBOTS_DISALLOW.every((prefix) => prefix.startsWith("/"))).toBe(true);
  });

  it("closes the whole site anywhere that is not production", () => {
    const preview = buildRobots({ appUrl: "https://preview.example", indexable: false });
    expect(preview.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(preview.sitemap).toBeUndefined();
  });
});

describe("sitemap.xml", () => {
  const input = {
    appUrl: APP_URL,
    now: NOW,
    courses: [{ slug: "build-an-app", lastModified: new Date("2026-11-01T00:00:00Z") }, { slug: "prompt-gym", lastModified: null }],
    helpArticles: [{ slug: "invite-codes", lastModified: null }],
    legalSlugs: ["privacy", "terms"],
  };

  it("lists the public pages, published courses, help articles and reviewed legal pages", () => {
    const paths = pathsOf(buildSitemap(input));
    expect(paths).toEqual(["/", "/courses", "/how-it-works", "/parents", "/safety", "/pricing", "/help", "/radar", "/courses/build-an-app", "/courses/prompt-gym", "/help/invite-codes", "/legal/privacy", "/legal/terms"]);
    const urls = buildSitemap(input).map((entry) => entry.url);
    expect(urls[0]).toBe("https://studio.example");
    expect(urls.every((url) => url.startsWith("https://studio.example") && !url.includes("//", 8))).toBe(true);
    expect(buildSitemap(input).find((entry) => entry.url.endsWith("/courses/build-an-app"))?.lastModified).toEqual(new Date("2026-11-01T00:00:00Z"));
  });

  it("has no private address in its fixed list", () => {
    for (const route of PUBLIC_ROUTES) expect(isIndexablePath(route.path), route.path).toBe(true);
    const paths = pathsOf(buildSitemap({ ...input, courses: [], helpArticles: [], legalSlugs: [] }));
    for (const path of paths) expect(isPrivatePath(path), path).toBe(false);
    for (const segment of PRIVATE_SEGMENTS) expect(paths.some((path) => path.split("/")[1] === segment), segment).toBe(false);
  });

  it("cannot be made to list a private or malformed address by the data it is given", () => {
    const paths = pathsOf(
      buildSitemap({
        ...input,
        courses: [{ slug: "../home", lastModified: null }, { slug: "x/taster", lastModified: null }, { slug: "Bad Slug", lastModified: null }, { slug: "", lastModified: null }, { slug: "ok-course", lastModified: null }],
        helpArticles: [{ slug: "../../parent/billing", lastModified: null }, { slug: "ok-article", lastModified: null }, { slug: "ok-article", lastModified: null }],
        legalSlugs: ["privacy", "not-a-legal-page", "../verify/ABCD"],
      }),
    );
    expect(paths.filter((path) => path.startsWith("/courses/"))).toEqual(["/courses/ok-course"]);
    expect(paths.filter((path) => path.startsWith("/help/"))).toEqual(["/help/ok-article"]);
    expect(paths.filter((path) => path.startsWith("/legal/"))).toEqual(["/legal/privacy"]);
    for (const path of paths) expect(isIndexablePath(path), path).toBe(true);
    expect(paths.some((path) => /verify|approve|join|studio|parent\/|home|learn|preview|api/.test(path))).toBe(false);
  });

  it("leaves out a legal page that is not published or is still a draft", () => {
    expect(pathsOf(buildSitemap({ ...input, legalSlugs: [] })).some((path) => path.startsWith("/legal/"))).toBe(false);
  });
});

describe("links and names", () => {
  it("uses the six legal addresses fixed by decision D16, the same ones the launch gate checks", () => {
    expect([...LEGAL_SLUGS]).toEqual(["privacy", "privacy-teen", "terms", "cookies", "community-code", "ai-use-policy"]);
    expect([...LEGAL_SLUGS].sort()).toEqual([...REQUIRED_LEGAL_SLUGS].sort());
    expect(MARKETING_LEGAL_LINKS.map((link) => link.href)).toEqual(LEGAL_SLUGS.map((slug) => `/legal/${slug}`));
  });

  it("only links the site's menu and footer to public pages that exist", () => {
    const known = new Set([...PUBLIC_ROUTES.map((route) => route.path), ...LEGAL_SLUGS.map((slug) => `/legal/${slug}`)]);
    for (const link of [...MARKETING_NAV, ...MARKETING_HELP_LINKS, ...MARKETING_LEGAL_LINKS]) expect(known.has(link.href), link.href).toBe(true);
  });

  it("gives a signed-in visitor a link to their own home, and a visitor none", () => {
    expect(homeLinkFor({ type: "learner" })).toEqual({ href: "/home", label: "Go to your home" });
    expect(homeLinkFor({ type: "parent" })?.href).toBe("/parent");
    expect(homeLinkFor({ type: "staff" })?.href).toBe("/studio");
    expect(homeLinkFor({ type: "anonymous" })).toBeNull();
    expect(homeLinkFor({ type: "system" })).toBeNull();
  });

  it("knows who may not be shown anything about money", () => {
    expect(isUnder18Learner({ type: "learner", age: 13, safetyBand: "teen_13_15" })).toBe(true);
    expect(isUnder18Learner({ type: "learner", age: 17, safetyBand: "teen_16_17" })).toBe(true);
    // The stricter of the two wins: 18 by age but not yet moved to the adult band.
    expect(isUnder18Learner({ type: "learner", age: 18, safetyBand: "teen_16_17" })).toBe(true);
    expect(isUnder18Learner({ type: "learner", age: 17, safetyBand: "adult_18" })).toBe(true);
    expect(isUnder18Learner({ type: "learner" })).toBe(true);
    expect(isUnder18Learner({ type: "learner", age: 18, safetyBand: "adult_18" })).toBe(false);
    expect(isUnder18Learner({ type: "parent" })).toBe(false);
    expect(isUnder18Learner({ type: "anonymous" })).toBe(false);
  });

  it("reads the fetcher's robots.txt name from its User-Agent", () => {
    expect(radarProductToken("PlatformRadar/1.0 (+http://localhost:3000/radar)")).toBe("PlatformRadar");
    expect(radarProductToken("  StudioRadar/2.1")).toBe("StudioRadar");
    expect(radarProductToken("")).toBe("PlatformRadar");
    expect(radarProductToken("<script>/1")).toBe("PlatformRadar");
    expect(siteOrigin("https://a.example///")).toBe("https://a.example");
  });
});
