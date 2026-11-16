import { NextResponse, type NextRequest } from "next/server";
import { A11Y_COOKIE, serialiseA11yPrefs } from "@/components/ui/a11y-prefs";
import { safeNextPath } from "@/lib/protected-paths";
import { resolveCtx } from "@/server/context";
import { resolveAfterSignIn } from "@/server/services/sign-in";
import { a11yCookieOptions } from "../../_lib/after-sign-in";

/**
 * Where an emailed link lands (confirm your address, one-time sign-in link) once Better Auth has
 * created the session. It is a redirect, not a page: it copies saved accessibility preferences
 * into the `a11y` cookie and sends each kind of user to the right place. A page cannot set a
 * cookie, which is why this is a Route Handler inside the `(auth)` group.
 *
 * If the link had run out or been used, Better Auth adds `?error=…` and there is no session:
 * the visitor goes to the sign-in page with a plain explanation.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"), "");
  const failed = url.searchParams.has("error");
  const ctx = await resolveCtx(request.headers);

  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") {
    const target = new URL("/signin", url);
    target.searchParams.set("as", "parent");
    if (failed) target.searchParams.set("notice", "link");
    if (next) target.searchParams.set("next", next);
    return NextResponse.redirect(target, 303);
  }

  const after = await resolveAfterSignIn(ctx, next);
  const response = NextResponse.redirect(new URL(after.path, url), 303);
  if (after.a11y) response.cookies.set(A11Y_COOKIE, serialiseA11yPrefs(after.a11y), a11yCookieOptions());
  return response;
}
