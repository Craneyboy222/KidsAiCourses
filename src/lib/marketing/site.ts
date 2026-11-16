/**
 * The public site's map: which addresses are public, which are private, and where a signed-in
 * visitor's own home is. Pure and dependency-free, so `robots.ts`, `sitemap.ts`, the marketing
 * pages and the tests all read the same lists.
 *
 * `public/sw.js` keeps its own copy of the private prefixes, because a service worker cannot
 * import this file. `tests/unit/marketing/service-worker.test.ts` fails if the two drift apart.
 */

/** Legal pages, in footer order (decision D16). The slug is both the address and `page.slug`. */
export const LEGAL_PAGES = [
  { slug: "privacy", label: "Privacy", title: "Privacy notice", audience: "adult" },
  { slug: "privacy-teen", label: "Privacy for teens", title: "Your privacy, in plain words", audience: "teen" },
  { slug: "terms", label: "Terms", title: "Terms of use", audience: "everyone" },
  { slug: "cookies", label: "Cookies", title: "Cookie notice", audience: "everyone" },
  { slug: "community-code", label: "Community code", title: "Community code", audience: "everyone" },
  { slug: "ai-use-policy", label: "How we use AI", title: "AI use policy", audience: "everyone" },
] as const;

export type LegalSlug = (typeof LEGAL_PAGES)[number]["slug"];
export const LEGAL_SLUGS: readonly LegalSlug[] = LEGAL_PAGES.map((page) => page.slug);

export function isLegalSlug(slug: string): slug is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(slug);
}

/** The words every unreviewed legal draft starts with. A page that carries them shows the draft banner and is never indexed. */
export const LEGAL_DRAFT_BANNER = "Draft — not yet reviewed by a lawyer";
/** Marks one legal decision that a person still has to make. */
export const LEGAL_TO_CONFIRM = "⚖️ TO CONFIRM";

export type PublicRoute = {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

/** The fixed public pages that belong in the sitemap. Course, help and legal pages are added from data. */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/courses", changeFrequency: "daily", priority: 0.9 },
  { path: "/how-it-works", changeFrequency: "monthly", priority: 0.8 },
  { path: "/parents", changeFrequency: "monthly", priority: 0.8 },
  { path: "/safety", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.7 },
  { path: "/help", changeFrequency: "weekly", priority: 0.6 },
  { path: "/radar", changeFrequency: "yearly", priority: 0.2 },
];

/**
 * First path segments that must never be indexed, listed in a sitemap or stored by the service
 * worker: every signed-in area, the API, sign-in and sign-up, links that carry a code or token
 * (`/verify`, `/approve`, `/join`), draft previews and development pages.
 */
export const PRIVATE_SEGMENTS = [
  // Learner
  "home",
  "explore",
  "learn",
  "portfolio",
  "certificates",
  "settings",
  "onboarding",
  // Parent and staff
  "parent",
  "studio",
  // Accounts
  "signin",
  "signup",
  "reset",
  "blocked-age",
  // Links that carry a code or a token
  "verify",
  "approve",
  "join",
  // Drafts, machinery and development pages
  "preview",
  "api",
  "dev",
  "offline",
] as const;

const PRIVATE: ReadonlySet<string> = new Set(PRIVATE_SEGMENTS);

const firstSegment = (path: string): string => (path.split(/[?#]/)[0]?.split("/")[1] ?? "").toLowerCase();

/** True for `/home`, `/parent/billing`, `/verify/ABCD`, `/api/health`; false for `/`, `/parents`, `/courses/x`. */
export function isPrivatePath(path: string): boolean {
  return PRIVATE.has(firstSegment(path));
}

/**
 * True when a path may appear in the sitemap. Besides the private areas, a course's taster is
 * left out: it is a sample of a page that is already listed.
 */
export function isIndexablePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (isPrivatePath(path)) return false;
  return !/^\/courses\/[^/]+\/taster\/?$/.test(path.split(/[?#]/)[0] ?? "");
}

/**
 * What crawlers are asked not to fetch at all. `/verify`, `/approve` and `/join` are deliberately
 * NOT here: those pages answer with `noindex`, and a crawler that is blocked by robots.txt never
 * sees that instruction, so a link someone posts could still be listed by its bare address.
 */
const ROBOTS_CLOSED_SEGMENTS = PRIVATE_SEGMENTS.filter((segment) => segment !== "verify" && segment !== "approve" && segment !== "join");

/**
 * Three rules for each closed area: the page itself (`/parent$`), the page with a query string
 * (`/parent?`) and everything beneath it (`/parent/`). A bare prefix would not do: `/parent`
 * would also close `/parents`, the public page for parents.
 */
export const ROBOTS_DISALLOW: readonly string[] = ROBOTS_CLOSED_SEGMENTS.flatMap((segment) => [`/${segment}$`, `/${segment}?`, `/${segment}/`]);

export type HomeLink = { href: string; label: string };

/**
 * Where a signed-in visitor's own pages start, or `null` for a visitor. Used on the public pages
 * in place of the sign-up calls to action. Never a redirect: the public page stays the same page
 * for everyone, crawlers included.
 */
export function homeLinkFor(actor: { type: string }): HomeLink | null {
  switch (actor.type) {
    case "learner":
      return { href: "/home", label: "Go to your home" };
    case "parent":
      return { href: "/parent", label: "Go to your dashboard" };
    case "staff":
      return { href: "/studio", label: "Go to Studio" };
    default:
      return null;
  }
}

/** A learner who may not be shown anything about money (spec 3.7). Mirrors `canSeePrices` in the plans service. */
export function isUnder18Learner(actor: { type: string; age?: number; safetyBand?: string }): boolean {
  return actor.type === "learner" && !(actor.safetyBand === "adult_18" && (actor.age ?? 0) >= 18);
}
