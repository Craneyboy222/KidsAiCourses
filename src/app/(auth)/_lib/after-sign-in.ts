import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { A11Y_COOKIE, A11Y_COOKIE_MAX_AGE, serialiseA11yPrefs, type A11yPrefs } from "@/components/ui/a11y-prefs";
import { env } from "@/env";
import { getAuth } from "@/server/auth/auth";
import type { ParentActor } from "@/server/authz";
import { getCtx, type Ctx } from "@/server/context";
import { ctxForUser, resolveAfterSignIn } from "@/server/services/sign-in";

/** The options the `a11y` cookie is always written with. It is read by the page's own script, so it is not HttpOnly. */
export function a11yCookieOptions() {
  return {
    path: "/",
    maxAge: A11Y_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
    httpOnly: false,
  };
}

/** Copies a learner's saved preferences into the cookie, so the very next page is drawn the way they like it. */
export async function writeA11yCookie(prefs: A11yPrefs): Promise<void> {
  (await cookies()).set(A11Y_COOKIE, serialiseA11yPrefs(prefs), a11yCookieOptions());
}

/** What `finishSignIn` needs from the request: everything in a context except who is asking. */
export type SignInBase = Pick<Ctx, "db" | "now" | "requestId" | "ip">;

/**
 * Server Actions only. Call straight after Better Auth has created a session for `userId`:
 * copies saved accessibility preferences into the cookie and sends each kind of user to the right
 * place (`next` is honoured only when it is a safe path that belongs to that kind of user).
 *
 * `base` is the context the action resolved when it started. Do NOT call `getCtx()` again at this
 * point: the request still carries whatever cookie the browser sent, and if that cookie is dead
 * (an old session that was signed out, or the one a sign-in or two-step set-up has just
 * replaced) Better Auth answers the look-up by clearing the session cookie, which wipes out the
 * new one set a moment ago and leaves the person signed out on the very next page.
 */
export async function finishSignIn(base: SignInBase, userId: string, next?: string | null, options: { twoFactorVerified?: boolean } = {}): Promise<never> {
  const ctx = await ctxForUser(base, userId, options);
  const after = await resolveAfterSignIn(ctx, next);
  if (after.a11y) await writeA11yCookie(after.a11y);
  redirect(after.path);
}

/** The request headers, for Better Auth calls that read or set cookies. */
export async function requestHeaders(): Promise<Headers> {
  return new Headers(await headers());
}

/** Ends the current session, if there is one. Never throws: signing out must always work. */
export async function endSession(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await requestHeaders() });
  } catch {
    // No session, or it had already ended.
  }
}

/**
 * Pages only (a page cannot set cookies): someone who is already signed in has no use for a
 * sign-in or sign-up form, so they go to their own home. Returns the context for a visitor.
 */
export async function redirectIfSignedIn(next?: string | null) {
  const ctx = await getCtx();
  if (ctx.actor.type === "learner" || ctx.actor.type === "parent" || ctx.actor.type === "staff") {
    redirect((await resolveAfterSignIn(ctx, next)).path);
  }
  return ctx;
}

/**
 * Parent pages and the parent layout: the context for a signed-in parent or carer. Anyone else
 * leaves by redirect: a visitor to sign in, a learner or a member of staff to their own home.
 *
 * Use this in pages rather than `requireParent()`. Next.js renders a layout and its page side by
 * side, so the layout's redirect does not stop the page running: a page that throws `forbidden`
 * for a learner races that redirect and writes an error to the log each time.
 */
export async function requireParentPage(): Promise<Ctx<ParentActor>> {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect("/signin?as=parent");
  if (ctx.actor.type !== "parent") redirect((await resolveAfterSignIn(ctx)).path);
  return { ...ctx, actor: ctx.actor };
}
