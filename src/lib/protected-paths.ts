/**
 * Which paths are signed-in areas, for the optimistic redirect in `src/proxy.ts`.
 * Pure and dependency-free. This is a convenience only: real authorisation is in pages and services.
 */

/** First path segments that are only for signed-in people. */
export const LEARNER_AREAS = [
  "home",
  "explore",
  "learn",
  "portfolio",
  "certificates",
  "settings",
  "onboarding",
] as const;
export const PARENT_AREAS = ["parent"] as const;
export const STUDIO_AREAS = ["studio"] as const;

const SIGNED_IN_AREAS: ReadonlySet<string> = new Set([...LEARNER_AREAS, ...PARENT_AREAS, ...STUDIO_AREAS]);

/** True for `/home`, `/parent/billing`, `/studio/...`; false for `/parents`, `/`, `/signin`. */
export function needsSession(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  return SIGNED_IN_AREAS.has(first.toLowerCase());
}

/** Where to send a signed-out visitor: `/signin?next=<the page they asked for>`. */
export function signInRedirectPath(pathname: string, search = ""): string {
  return `/signin?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

/**
 * For the sign-in page: the path to return to after signing in, or `fallback` when `next` is
 * missing or is not a plain path on this site (so it can never send someone to another website).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n\t]/.test(next))
    return fallback;
  return next;
}
