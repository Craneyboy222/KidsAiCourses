import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { A11Y_COOKIE, A11Y_COOKIE_MAX_AGE, serialiseA11yPrefs, type A11yPrefs } from "@/components/ui/a11y-prefs";
import { env } from "@/env";
import { getAuth } from "@/server/auth/auth";
import { getCtx } from "@/server/context";
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

/**
 * Server Actions only. Call straight after Better Auth has created a session for `userId`:
 * copies saved accessibility preferences into the cookie and sends each kind of user to the right
 * place (`next` is honoured only when it is a safe path that belongs to that kind of user).
 */
export async function finishSignIn(userId: string, next?: string | null, options: { twoFactorVerified?: boolean } = {}): Promise<never> {
  const base = await getCtx();
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
