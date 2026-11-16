import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { needsSession, signInRedirectPath } from "@/lib/protected-paths";

/**
 * Next.js 16 "proxy" (what used to be middleware). It does one thing: if a request for a
 * signed-in area (learner, parent or Studio) arrives with no session cookie at all, send the
 * visitor to sign in and bring them back afterwards. Everything else passes straight through.
 *
 * This is a convenience, not security. It only looks at whether a cookie is present: it does not
 * check that the cookie is valid, read the database or know who the visitor is. Every page,
 * action and handler still does the real check (`requireSession()` and `assertCan`).
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (!needsSession(pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL(signInRedirectPath(pathname, search), request.url));
}

export const config = {
  matcher: [
    // Everything except API routes, Next.js internals and static files (anything ending in a file extension).
    "/((?!api/|_next/static|_next/image|_next/data|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|sw.js|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
