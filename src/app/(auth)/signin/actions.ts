"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import { getCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { safeNextPath } from "@/lib/protected-paths";
import { TWO_FACTOR_PATH, passwordFailure, signInFailure, twoFactorFailure } from "@/server/services/sign-in";
import { AFTER_EMAIL_LINK_PATH } from "@/server/services/signup";
import { endSession, finishSignIn, requestHeaders, type SignInBase } from "../_lib/after-sign-in";
import { raw, text } from "../_lib/form";

/** Per caller, on top of the per-account lock in `auth/lockout.ts`. Server-side calls skip Better Auth's own HTTP limiter. */
const SIGN_IN_LIMIT = { limit: 20, windowSec: 10 * 60 };

const withNext = (path: string, next: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

type SignedIn = { user?: { id?: string } | null; twoFactorRedirect?: boolean };

/** After the password is accepted: staff with two-step go to the code page, everyone else to their home. */
async function afterPassword(ctx: SignInBase, result: unknown, next: string): Promise<never> {
  const outcome = (result ?? {}) as SignedIn;
  if (outcome.twoFactorRedirect === true) redirect(withNext(TWO_FACTOR_PATH, next));
  const userId = outcome.user?.id;
  if (!userId) throw new AppError("internal", "We couldn't sign you in just then. Nothing is wrong with your account. Please try again.");
  return finishSignIn(ctx, userId, next);
}

const learnerSchema = z.object({
  username: z.string().trim().min(1, "Enter your username.").max(60),
  password: z.string().min(1, "Enter your password.").max(128),
});

/** Learners: username and password. */
export async function signInLearnerAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const next = safeNextPath(text(formData, "next"), "");
    const input = learnerSchema.parse({ username: text(formData, "username"), password: raw(formData, "password") });
    await rateLimit(ctx, "signin", SIGN_IN_LIMIT);
    let result: unknown;
    try {
      result = await getAuth().api.signInUsername({ body: input, headers: await requestHeaders() });
    } catch (error) {
      throw signInFailure(error, "username");
    }
    return afterPassword(ctx, result, next);
  });
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter your email address, like name@example.com.").max(254)),
  password: z.string().min(1, "Enter your password.").max(128),
});

/** Parents, carers, adult learners and the team: email and password. Staff are then asked for their two-step code. */
export async function signInEmailAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const next = safeNextPath(text(formData, "next"), "");
    const input = emailSchema.parse({ email: text(formData, "email"), password: raw(formData, "password") });
    await rateLimit(ctx, "signin", SIGN_IN_LIMIT);
    let result: unknown;
    try {
      // The callback is where the "confirm your address" link lands, if this sign-in has to send one.
      result = await getAuth().api.signInEmail({ body: { ...input, callbackURL: withNext(AFTER_EMAIL_LINK_PATH, next) }, headers: await requestHeaders() });
    } catch (error) {
      throw signInFailure(error, "email");
    }
    return afterPassword(ctx, result, next);
  });
}

/**
 * Parents: a one-time sign-in link by email. The answer is always the same, so the form cannot
 * be used to find out whether an address has an account (and only parent accounts are ever sent one).
 */
export async function sendMagicLinkAction(_prev: ActionState<{ sent: true }>, formData: FormData): Promise<ActionState<{ sent: true }>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const next = safeNextPath(text(formData, "next"), "");
    const { email } = emailSchema.pick({ email: true }).parse({ email: text(formData, "email") });
    await rateLimit(ctx, "signin.magic_link", { limit: 5, windowSec: 15 * 60 });
    try {
      await getAuth().api.signInMagicLink({ body: { email, callbackURL: withNext(AFTER_EMAIL_LINK_PATH, next) }, headers: await requestHeaders() });
    } catch {
      // Same answer whatever happened.
    }
    return { sent: true as const };
  });
}

const codeSchema = z.object({ code: z.string().trim().min(1, "Enter your code.").max(40) });

/** Staff, second step: the six-digit code from their authenticator app, or one of their backup codes. */
export async function verifyTwoFactorAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const next = safeNextPath(text(formData, "next"), "");
    const { code } = codeSchema.parse({ code: text(formData, "code").replace(/\s+/g, "") });
    await rateLimit(ctx, "signin.two_factor", { limit: 10, windowSec: 10 * 60 });
    const useBackup = text(formData, "method") === "backup";
    let result: unknown;
    try {
      const api = getAuth().api;
      const headers = await requestHeaders();
      result = useBackup ? await api.verifyBackupCode({ body: { code }, headers }) : await api.verifyTOTP({ body: { code }, headers });
    } catch (error) {
      throw twoFactorFailure(error);
    }
    const userId = (result as SignedIn | null)?.user?.id;
    if (!userId) throw new AppError("internal", "We couldn't finish signing you in. Go back to sign in and start again.");
    return finishSignIn(ctx, userId, next, { twoFactorVerified: true });
  });
}

export type TwoFactorEnrolment = { secret: string; totpUri: string; backupCodes: string[] };

/** Two-step set-up, part one: confirm the password, get the key for the authenticator app and the backup codes. */
export async function startTwoFactorSetupAction(_prev: ActionState<TwoFactorEnrolment>, formData: FormData): Promise<ActionState<TwoFactorEnrolment>> {
  return runAction(async () => {
    const ctx = await getCtx();
    if (ctx.actor.type !== "staff" && ctx.actor.type !== "parent") throw new AppError("unauthenticated", "Sign in first, then set up two-step sign-in.");
    const password = raw(formData, "password");
    if (!password) throw new AppError("invalid_input", "Enter your password to carry on.", { fieldErrors: { password: ["Enter your password."] } });
    await rateLimit(ctx, "signin.two_factor_setup", { limit: 10, windowSec: 10 * 60 });
    let totpUri = "";
    let backupCodes: string[] = [];
    try {
      const result = await getAuth().api.enableTwoFactor({ body: { password }, headers: await requestHeaders() });
      if ("totpURI" in result) {
        totpUri = result.totpURI;
        backupCodes = result.backupCodes;
      }
    } catch (error) {
      throw passwordFailure(error, "We couldn't start the set-up. Check your password and try again.");
    }
    const secret = totpUri ? (new URL(totpUri).searchParams.get("secret") ?? "") : "";
    if (!secret) throw new AppError("internal", "We couldn't start the set-up. Please try again.");
    return { secret, totpUri, backupCodes };
  });
}

/** Two-step set-up, part two: the first code proves the app is set up. The session becomes a verified one. */
export async function confirmTwoFactorSetupAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    if (ctx.actor.type !== "staff" && ctx.actor.type !== "parent") throw new AppError("unauthenticated", "Sign in first, then set up two-step sign-in.");
    const userId = ctx.actor.userId;
    const next = safeNextPath(text(formData, "next"), "");
    const { code } = codeSchema.parse({ code: text(formData, "code").replace(/\s+/g, "") });
    await rateLimit(ctx, "signin.two_factor", { limit: 10, windowSec: 10 * 60 });
    try {
      await getAuth().api.verifyTOTP({ body: { code }, headers: await requestHeaders() });
    } catch (error) {
      throw twoFactorFailure(error);
    }
    return finishSignIn(ctx, userId, next, { twoFactorVerified: true });
  });
}

const resetRequestSchema = emailSchema.pick({ email: true });

/** "Forgot your password": parents, carers, adult learners and the team. Always the same answer. */
export async function requestPasswordResetAction(_prev: ActionState<{ sent: true }>, formData: FormData): Promise<ActionState<{ sent: true }>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const { email } = resetRequestSchema.parse({ email: text(formData, "email") });
    await rateLimit(ctx, "password.reset_request", { limit: 5, windowSec: 15 * 60 });
    try {
      await getAuth().api.requestPasswordReset({ body: { email, redirectTo: "/reset" } });
    } catch {
      // Same answer whatever happened: never confirm that an address has an account.
    }
    return { sent: true as const };
  });
}

const resetSchema = z.object({ token: z.string().min(10).max(200), password: z.string().min(1, "Choose a new password.").max(128) });

/** Sets the new password from an emailed reset link. Every session for the account ends. */
export async function resetPasswordAction(_prev: ActionState<{ done: true }>, formData: FormData): Promise<ActionState<{ done: true }>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const input = resetSchema.parse({ token: text(formData, "token"), password: raw(formData, "password") });
    await rateLimit(ctx, "password.reset", { limit: 10, windowSec: 15 * 60 });
    try {
      await getAuth().api.resetPassword({ body: { token: input.token, newPassword: input.password } });
    } catch (error) {
      throw passwordFailure(error, "We couldn't change your password with that link. Ask for a new one and try again.");
    }
    return { done: true as const };
  });
}

/** Signs out and goes to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/signin");
}
