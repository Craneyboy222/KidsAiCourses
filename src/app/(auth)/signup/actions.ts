"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import { getCtx } from "@/server/context";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { signUpAdultLearner, signUpParent, signupRouteForBirth, suggestAvailableUsernames } from "@/server/services/signup";
import { WAITING_PATH } from "@/server/services/sign-in";
import { resendParentApproval, signUpTeen } from "@/server/services/teen-signup";
import { endSession, requestHeaders } from "../_lib/after-sign-in";
import { BLOCKED_AGE_PATH, hasAgeGateCookie, withAgeGate } from "../_lib/age-gate";
import { birthFrom, consentChoices, raw, text, ticked } from "../_lib/form";

const email = (message: string) => z.string().trim().toLowerCase().pipe(z.email(message).max(254));

const parentSchema = z.object({
  name: z.string().trim().max(80, "Keep your name to 80 characters or fewer.").optional(),
  email: email("Enter your email address, like name@example.com."),
  password: z.string().max(128).optional(),
  confirmedAdult: z.boolean(),
});

/** Parent or carer sign-up. The answer is the same whether or not the address already has an account. */
export async function signUpParentAction(_prev: ActionState<{ sent: true }>, formData: FormData): Promise<ActionState<{ sent: true }>> {
  return runAction(async () => {
    if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
    const ctx = await getCtx();
    const input = parentSchema.parse({
      name: text(formData, "name") || undefined,
      email: text(formData, "email"),
      password: raw(formData, "password") || undefined,
      confirmedAdult: ticked(formData, "confirmedAdult"),
    });
    await rateLimit(ctx, "signup.parent", { limit: 10, windowSec: 60 * 60 });
    await signUpParent(ctx, input);
    return { sent: true as const };
  });
}

export type TeenAgeStep = { route: "teen" | "adult"; birthMonth: number; birthYear: number; suggestions: string[] };

/**
 * Step one of teen sign-up: the birth month and year, and nothing else. Under 13, the visitor is
 * counted anonymously and sent to `/blocked-age` before any other question is asked.
 */
export async function teenAgeAction(_prev: ActionState<TeenAgeStep>, formData: FormData): Promise<ActionState<TeenAgeStep>> {
  return runAction(async () => {
    if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
    const ctx = await getCtx();
    const birth = birthFrom(formData);
    const route = await withAgeGate(() => signupRouteForBirth(ctx, birth));
    // Only after the age gate: for an under-13 nothing is written, not even a rate-limit count.
    await rateLimit(ctx, "signup.teen.age", { limit: 30, windowSec: 60 * 60 });
    const suggestions = await suggestAvailableUsernames(db, { birthYear: birth.birthYear });
    return { route, ...birth, suggestions };
  });
}

const teenSchema = z.object({
  username: z.string().trim().min(1, "Choose a username.").max(40),
  password: z.string().min(1, "Choose a password.").max(128),
  parentEmail: email("Enter your parent or carer's email address, like name@example.com."),
});

/** Step two for under-18s: username, password and a parent's email. Ends on the waiting page, signed in. */
export async function teenDetailsAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
    const ctx = await getCtx();
    const birth = birthFrom(formData);
    // The age gate first, again: the birth date arrives with this form too, and could have been changed.
    await withAgeGate(() => signupRouteForBirth(ctx, birth));
    const input = teenSchema.parse({ username: text(formData, "username"), password: raw(formData, "password"), parentEmail: text(formData, "parentEmail") });
    await rateLimit(ctx, "signup.teen", { limit: 10, windowSec: 60 * 60 });
    const created = await withAgeGate(() => signUpTeen(ctx, { ...birth, ...input }));
    // Sign them in, so the waiting page can show when the account runs out and offer to resend the email.
    await endSession();
    try {
      await getAuth().api.signInUsername({ body: { username: created.username, password: input.password }, headers: await requestHeaders() });
    } catch {
      // The account exists; they can sign in by hand.
      redirect("/signin?notice=created");
    }
    redirect(WAITING_PATH);
  });
}

const adultSchema = z.object({
  username: z.string().trim().min(1, "Choose a username.").max(40),
  email: email("Enter your email address, like name@example.com."),
  password: z.string().min(1, "Choose a password.").max(128),
});

/** Step two for an 18-year-old signing up for themselves (only when the owner has switched that on). */
export async function adultDetailsAction(_prev: ActionState<{ sent: true }>, formData: FormData): Promise<ActionState<{ sent: true }>> {
  return runAction(async () => {
    if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
    const ctx = await getCtx();
    const birth = birthFrom(formData);
    const route = await withAgeGate(() => signupRouteForBirth(ctx, birth));
    if (route !== "adult") {
      throw new AppError("parent_approval_required", "Under-18s need a parent or carer to approve their account. Go back and choose your birth month and year again.");
    }
    const input = adultSchema.parse({ username: text(formData, "username"), email: text(formData, "email"), password: raw(formData, "password") });
    await rateLimit(ctx, "signup.adult", { limit: 10, windowSec: 60 * 60 });
    await withAgeGate(() => signUpAdultLearner(ctx, { ...birth, ...input, consents: consentChoices(formData) }));
    return { sent: true as const };
  });
}

/** The waiting teen asks for the email to their parent to be sent again. */
export async function resendApprovalAction(_prev: ActionState<{ emailsSent: number }>, _formData: FormData): Promise<ActionState<{ emailsSent: number }>> {
  return runAction(async () => resendParentApproval(await getCtx()));
}
