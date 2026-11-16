import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { isAppError } from "@/server/errors";
import { AGE_GATE_COOKIE, AGE_GATE_COOKIE_MAX_AGE_SEC } from "@/server/services/signup";

/**
 * The under-13 block, on the web side (spec 3.1).
 *
 * When a sign-up service answers `age_blocked`, nothing about the child has been stored. The
 * action then sets one short-lived cookie whose value is always "1" and sends the visitor to
 * `/blocked-age`. While the cookie lasts, the sign-up forms are not shown again, so the date
 * cannot simply be changed and the form sent again. The cookie says nothing about who was turned
 * away, or why.
 */
export const BLOCKED_AGE_PATH = "/blocked-age";

export async function hasAgeGateCookie(): Promise<boolean> {
  return (await cookies()).get(AGE_GATE_COOKIE)?.value === "1";
}

/** Server Actions only: sets the flag and leaves for `/blocked-age`. */
export async function blockForAge(): Promise<never> {
  (await cookies()).set(AGE_GATE_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
    path: "/",
    maxAge: AGE_GATE_COOKIE_MAX_AGE_SEC,
  });
  redirect(BLOCKED_AGE_PATH);
}

/** Pages: a browser that was just turned away goes straight back to the friendly page. */
export async function redirectIfAgeGated(): Promise<void> {
  if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
}

/**
 * Runs a sign-up step. If it is refused for age, sets the flag and redirects; any other error is
 * thrown on for `runAction` to turn into a message.
 */
export async function withAgeGate<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (isAppError(error) && error.code === "age_blocked") await blockForAge();
    throw error;
  }
}
