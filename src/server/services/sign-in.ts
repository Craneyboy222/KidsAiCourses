import { eq } from "drizzle-orm";
import { parseA11yPrefs, type A11yPrefs } from "@/components/ui/a11y-prefs";
import { LEARNER_AREAS, safeNextPath } from "@/lib/protected-paths";
import type { UserStatus } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { learnerProfile, user } from "@/server/db";
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
      if (!facts.twoFactorEnabled) return TWO_FACTOR_SETUP_PATH;
      if (!facts.twoFactorVerified) return TWO_FACTOR_PATH;
      return "/studio";
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
