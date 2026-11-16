import { eq } from "drizzle-orm";
import { parseA11yPrefs, type A11yPrefs } from "@/components/ui/a11y-prefs";
import { LEARNER_AREAS, safeNextPath } from "@/lib/protected-paths";
import type { UserStatus } from "@/server/authz";
import { loadActor, type Ctx } from "@/server/context";
import { learnerProfile, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { countSeatsUsed } from "./family";

/**
 * Where each kind of user goes after signing in (spec Section 5), and which accessibility
 * preferences to copy into the `a11y` cookie so the first page already looks right.
 *
 * `next` (the page they were trying to reach) is honoured only when it is a plain path on this
 * site **and** it belongs to that kind of user. A learner is never sent to a parent or staff page
 * because a link said so, and nobody is ever sent to another website.
 */

export const WAITING_PATH = "/signup/teen/waiting";
export const TWO_FACTOR_PATH = "/signin/two-factor";
export const TWO_FACTOR_SETUP_PATH = "/signin/two-factor/setup";

export type SignedInFacts =
  | { kind: "anonymous" }
  | { kind: "learner"; status: UserStatus; onboardingCompleted: boolean }
  | { kind: "parent"; hasChildren: boolean }
  | { kind: "staff"; twoFactorEnabled: boolean; twoFactorVerified: boolean };

const firstSegment = (path: string) => (path.split(/[/?#]/)[1] ?? "").toLowerCase();

/** The default landing page for someone, ignoring `next`. */
export function homePathFor(facts: SignedInFacts): string {
  switch (facts.kind) {
    case "anonymous":
      return "/signin";
    case "learner":
      if (facts.status === "pending_parent") return WAITING_PATH;
      // Onboarding needs an active account; a paused learner goes home, where the pause is explained.
      if (!facts.onboardingCompleted && facts.status === "active") return "/onboarding";
      return "/home";
    case "parent":
      return facts.hasChildren ? "/parent" : "/parent/onboarding";
    case "staff":
      // Verified without being enrolled only happens in local development and tests, when
      // STAFF_2FA_REQUIRED is off (see `loadActor`): there is nothing to set up or enter.
      if (facts.twoFactorVerified) return "/studio";
      if (!facts.twoFactorEnabled) return TWO_FACTOR_SETUP_PATH;
      return TWO_FACTOR_PATH;
  }
}

/** Pure: the page to send someone to after sign-in, given where they asked to go. */
export function chooseAfterSignInPath(facts: SignedInFacts, next?: string | null): string {
  const home = homePathFor(facts);
  const wanted = safeNextPath(next, "");
  if (wanted === "") return home;
  const area = firstSegment(wanted);
  switch (facts.kind) {
    case "anonymous":
      return home;
    case "learner":
      // A waiting teen or a learner who has not onboarded finishes that first.
      if (home !== "/home") return home;
      return (LEARNER_AREAS as readonly string[]).includes(area) ? wanted : home;
    case "parent":
      // An approval link wins even before the parent has added a child: approving is how they add one.
      if (area === "approve") return wanted;
      return area === "parent" ? wanted : home;
    case "staff":
      if (home !== "/studio") return home;
      return area === "studio" ? wanted : home;
  }
}

/** Gathers the facts for the signed-in actor. */
export async function signedInFacts(ctx: Ctx): Promise<SignedInFacts> {
  const { actor } = ctx;
  switch (actor.type) {
    case "learner": {
      const rows = await ctx.db
        .select({ onboardingCompletedAt: learnerProfile.onboardingCompletedAt })
        .from(learnerProfile)
        .where(eq(learnerProfile.userId, actor.userId))
        .limit(1);
      return { kind: "learner", status: actor.status, onboardingCompleted: rows[0]?.onboardingCompletedAt != null };
    }
    case "parent":
      return { kind: "parent", hasChildren: (await countSeatsUsed(ctx, actor.familyId)) > 0 };
    case "staff": {
      const rows = await ctx.db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, actor.userId)).limit(1);
      return { kind: "staff", twoFactorEnabled: rows[0]?.twoFactorEnabled === true, twoFactorVerified: actor.twoFactorVerified };
    }
    default:
      return { kind: "anonymous" };
  }
}

/** The learner's saved accessibility preferences, or null when they have never chosen any (or are not a learner). */
export async function savedA11yPrefs(ctx: Ctx): Promise<A11yPrefs | null> {
  if (ctx.actor.type !== "learner") return null;
  const rows = await ctx.db.select({ a11y: learnerProfile.a11y }).from(learnerProfile).where(eq(learnerProfile.userId, ctx.actor.userId)).limit(1);
  const stored = rows[0]?.a11y;
  if (!stored || Object.keys(stored).length === 0) return null;
  return parseA11yPrefs(stored);
}

export type AfterSignIn = { path: string; a11y: A11yPrefs | null; facts: SignedInFacts };

/** Everything the sign-in action needs once a session exists. */
export async function resolveAfterSignIn(ctx: Ctx, next?: string | null): Promise<AfterSignIn> {
  const facts = await signedInFacts(ctx);
  return { path: chooseAfterSignInPath(facts, next), a11y: await savedA11yPrefs(ctx), facts };
}

// ── Helpers for the sign-in Server Actions ──────────────────────────────────

/**
 * A context for the user who has just signed in. Inside the Server Action that created the
 * session, the request still carries the old cookies, so `getCtx()` would say "anonymous": this
 * builds the Actor straight from the user id that Better Auth returned.
 */
export async function ctxForUser(base: Pick<Ctx, "db" | "now" | "requestId" | "ip">, userId: string, options: { twoFactorVerified?: boolean } = {}): Promise<Ctx> {
  const actor = await loadActor(base.db, { userId, createdAt: base.now, twoFactorVerified: options.twoFactorVerified === true }, base.now);
  return { ...base, actor };
}

export type SignInMethod = "username" | "email";

const NO_MATCH: Record<SignInMethod, string> = {
  username: "That username and password don't match. Check both, then try again.",
  email: "That email address and password don't match. Check both, then try again.",
};

/** Calm on purpose: nothing is wrong with the account, and there is a clear way forward. */
export const LOCKOUT_MESSAGE: Record<SignInMethod, string> = {
  username:
    "There have been a few wrong passwords, so sign-in is having a short rest. Nothing is wrong with your account. Try again in about 15 minutes, or ask your parent or carer to reset your password.",
  email:
    "There have been a few wrong passwords, so sign-in is having a short rest. Nothing is wrong with your account. Try again in about 15 minutes, or reset your password by email.",
};

type AuthFailure = { status: string; code: string; message: string };

/** Reads the `{ status, body: { code, message } }` shape that Better Auth rejects with. */
export function readAuthFailure(error: unknown): AuthFailure | null {
  if (!error || typeof error !== "object" || error instanceof AppError) return null;
  const e = error as { status?: unknown; statusCode?: unknown; body?: { code?: unknown; message?: unknown } };
  if (e.status === undefined && e.statusCode === undefined) return null;
  return { status: String(e.status ?? e.statusCode), code: typeof e.body?.code === "string" ? e.body.code : "", message: typeof e.body?.message === "string" ? e.body.message : "" };
}

/**
 * Turns a refused sign-in into a message for the person. A wrong password, an unknown name and a
 * badly shaped name all get the same answer, so the form never confirms which accounts exist.
 * Anything that is not a Better Auth refusal is returned unchanged.
 */
export function signInFailure(error: unknown, method: SignInMethod): unknown {
  const failure = readAuthFailure(error);
  if (!failure) return error;
  if (failure.code === "ACCOUNT_LOCKED" || failure.status === "TOO_MANY_REQUESTS" || failure.status === "429") {
    return new AppError("rate_limited", LOCKOUT_MESSAGE[method]);
  }
  if (failure.code === "EMAIL_NOT_VERIFIED") {
    return new AppError("forbidden", "Your email address hasn't been confirmed yet. We've just sent you a fresh link: open it and you'll be signed in.");
  }
  if (failure.code === "ACCOUNT_UNAVAILABLE") {
    return new AppError("forbidden", "This account can't be used to sign in right now. If you think that's a mistake, contact support.");
  }
  return new AppError("unauthenticated", NO_MATCH[method], { fieldErrors: { password: ["Check your password."] } });
}

/** The same for the two-step code page. */
export function twoFactorFailure(error: unknown): unknown {
  const failure = readAuthFailure(error);
  if (!failure) return error;
  if (failure.code === "INVALID_TWO_FACTOR_COOKIE") {
    return new AppError("unauthenticated", "That took a little too long, so we need your password again. Go back to sign in and start again.");
  }
  if (failure.code === "ACCOUNT_TEMPORARILY_LOCKED" || failure.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" || failure.status === "TOO_MANY_REQUESTS") {
    return new AppError("rate_limited", "There have been a few wrong codes, so this is having a short rest. Wait a few minutes, then sign in again.");
  }
  return new AppError("invalid_input", "That code isn't right. Codes change every 30 seconds, so check the newest one and try again.", { fieldErrors: { code: ["Check the code."] } });
}

/** For the password pages (reset, two-step set-up): Better Auth's password-policy refusals carry our own wording. */
export function passwordFailure(error: unknown, fallback: string): unknown {
  const failure = readAuthFailure(error);
  if (!failure) return error;
  if (failure.code.startsWith("PASSWORD_") && failure.message) {
    return new AppError("invalid_input", failure.message, { fieldErrors: { password: [failure.message] } });
  }
  if (failure.code === "INVALID_TOKEN") {
    return new AppError("invalid_input", "That link has run out or has already been used. Ask for a new one below.");
  }
  if (failure.code === "INVALID_PASSWORD") {
    return new AppError("invalid_input", "That password isn't right. Check it and try again.", { fieldErrors: { password: ["Check your password."] } });
  }
  return new AppError("invalid_input", fallback);
}
