import { eq } from "drizzle-orm";
import { parseA11yPrefs, type A11yPrefs } from "@/components/ui/a11y-prefs";
import { INTEREST_TAGS, type InterestTag } from "@/content/schema";
import { assertCan, type LearnerActor, type ParentActor } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { newToken } from "@/server/crypto";
import { learnerProfile } from "@/server/db";
import { AppError } from "@/server/errors";
import { logWarn } from "@/server/log";
import { listCatalogue, recommendForLearner, type CatalogueCourse } from "./catalogue";
import { missingRequiredConsents } from "./consent";
import { getFamily, listChildren } from "./family";

/**
 * Onboarding (spec 3.1, Section 4).
 *
 * Learner: a generated avatar (a random seed, never a photo), at least three of the 16 interest
 * tags, accessibility preferences and a first-project pick. Interests come first; everything
 * after them can be skipped.
 *
 * Parent: read how safety and outside tools work, choose Free or the Family trial (the billing
 * page belongs to the payments slice), add a child, complete the consent centre.
 */

export const MIN_INTERESTS = 3;
export const LEARNER_ONBOARDING_STEPS = ["interests", "avatar", "accessibility", "project"] as const;
export type LearnerOnboardingStep = (typeof LEARNER_ONBOARDING_STEPS)[number];

/** Short labels for the 16 interest tags (spec Section 15). */
export const INTEREST_LABELS: Record<InterestTag, string> = {
  music: "Music",
  film: "Film and video",
  games: "Games",
  apps: "Apps",
  coding: "Coding",
  art: "Art",
  fashion: "Fashion",
  sport: "Sport",
  business: "Business",
  study: "Study skills",
  writing: "Writing",
  science: "Science",
  social: "Social media",
  design: "Design",
  environment: "Environment",
  careers: "Careers",
};

const AVATAR_SEED = /^[A-Za-z0-9_-]{12}$/;

/** Fresh random seeds to choose an avatar from. A seed only decides which shapes are drawn. */
export function newAvatarChoices(count = 6): string[] {
  return Array.from({ length: count }, () => newToken(9));
}

/** Keeps only real interest tags, without repeats. */
export function cleanInterests(raw: readonly string[]): InterestTag[] {
  const allowed = new Set<string>(INTEREST_TAGS);
  return [...new Set(raw.map((tag) => tag.trim().toLowerCase()))].filter((tag): tag is InterestTag => allowed.has(tag));
}

export type LearnerOnboarding = {
  learnerId: string;
  nickname: string;
  interests: string[];
  avatarSeed: string;
  a11y: A11yPrefs;
  completed: boolean;
  /** True once at least three interests are saved: from then on the rest can be skipped. */
  canSkip: boolean;
};

function learnerOf(ctx: Ctx): LearnerActor {
  if (ctx.actor.type !== "learner") throw new AppError("forbidden", "That page is for learner accounts.");
  return ctx.actor;
}

export async function getLearnerOnboarding(ctx: Ctx): Promise<LearnerOnboarding> {
  const learner = learnerOf(ctx);
  assertCan(learner, "learner.profile.read", { learnerId: learner.userId });
  const rows = await ctx.db.select().from(learnerProfile).where(eq(learnerProfile.userId, learner.userId)).limit(1);
  const profile = rows[0];
  if (!profile) throw new AppError("not_found", "We couldn't find your profile. Try signing in again.");
  return {
    learnerId: learner.userId,
    nickname: profile.nickname,
    interests: profile.interests,
    avatarSeed: profile.avatarSeed,
    a11y: parseA11yPrefs(profile.a11y),
    completed: profile.onboardingCompletedAt !== null,
    canSkip: profile.interests.length >= MIN_INTERESTS,
  };
}

export async function saveInterests(ctx: Ctx, raw: readonly string[]): Promise<InterestTag[]> {
  const learner = learnerOf(ctx);
  assertCan(learner, "learner.profile.update", { learnerId: learner.userId });
  const interests = cleanInterests(raw);
  if (interests.length < MIN_INTERESTS) {
    const message = `Pick at least ${MIN_INTERESTS} things you're into, so we can suggest projects you'll like.`;
    throw new AppError("invalid_input", message, { fieldErrors: { interests: [message] } });
  }
  await ctx.db.update(learnerProfile).set({ interests, updatedAt: ctx.now }).where(eq(learnerProfile.userId, learner.userId));
  return interests;
}

/** Saves the chosen avatar. Only a seed in the format we generate is accepted: never an image, a link or a name. */
export async function saveAvatar(ctx: Ctx, seed: string): Promise<string> {
  const learner = learnerOf(ctx);
  assertCan(learner, "learner.profile.update", { learnerId: learner.userId });
  if (!AVATAR_SEED.test(seed)) throw new AppError("invalid_input", "Choose one of the avatars shown.", { fieldErrors: { avatar: ["Choose one of the avatars shown."] } });
  await ctx.db.update(learnerProfile).set({ avatarSeed: seed, updatedAt: ctx.now }).where(eq(learnerProfile.userId, learner.userId));
  return seed;
}

/** Saves text size, theme, reading mode and motion. Anything unexpected falls back to the default. */
export async function saveAccessibility(ctx: Ctx, raw: unknown): Promise<A11yPrefs> {
  const learner = learnerOf(ctx);
  assertCan(learner, "learner.settings.update", { learnerId: learner.userId });
  const prefs = parseA11yPrefs(raw);
  await ctx.db.update(learnerProfile).set({ a11y: prefs, updatedAt: ctx.now }).where(eq(learnerProfile.userId, learner.userId));
  return prefs;
}

export type FirstProjectChoice = Pick<CatalogueCourse, "slug" | "title" | "tagline" | "whatYouMake" | "difficulty" | "estimatedMinutes" | "category">;

/**
 * Up to three courses to start with: the "Made for you" picks, or free courses if there are none.
 * Both lists come from the catalogue service, which already hides anything above the learner's
 * age or blocked by a parent. Locked (paid) courses are left out, so no price question arises.
 * If the catalogue is unavailable the step is simply empty and can be skipped.
 */
export async function getFirstProjectChoices(ctx: Ctx, limit = 3): Promise<FirstProjectChoice[]> {
  const learner = learnerOf(ctx);
  let courses: CatalogueCourse[] = [];
  try {
    courses = await recommendForLearner(ctx, learner.userId, limit * 2);
    if (courses.filter((course) => !course.locked).length === 0) {
      courses = (await listCatalogue(ctx, { kind: "learner", learnerId: learner.userId }, { free: true, sort: "for_you", limit: limit * 2 })).items;
    }
  } catch (error) {
    logWarn("onboarding.first_project_unavailable", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
  return courses
    .filter((course) => !course.locked)
    .slice(0, limit)
    .map(({ slug, title, tagline, whatYouMake, difficulty, estimatedMinutes, category }) => ({ slug, title, tagline, whatYouMake, difficulty, estimatedMinutes, category }));
}

/**
 * Finishes (or skips the rest of) onboarding. Needs three interests first. Returns where to go
 * next: the chosen first project, or home.
 */
export async function completeOnboarding(ctx: Ctx, input: { firstProjectSlug?: string | null } = {}): Promise<{ next: string }> {
  const learner = learnerOf(ctx);
  assertCan(learner, "learner.profile.update", { learnerId: learner.userId });
  const rows = await ctx.db.select({ interests: learnerProfile.interests }).from(learnerProfile).where(eq(learnerProfile.userId, learner.userId)).limit(1);
  if ((rows[0]?.interests.length ?? 0) < MIN_INTERESTS) {
    throw new AppError("invalid_input", `Pick at least ${MIN_INTERESTS} interests first. After that you can skip the rest.`);
  }
  await ctx.db.update(learnerProfile).set({ onboardingCompletedAt: ctx.now, updatedAt: ctx.now }).where(eq(learnerProfile.userId, learner.userId));
  const slug = input.firstProjectSlug?.trim() ?? "";
  return { next: /^[a-z0-9][a-z0-9-]{0,120}$/.test(slug) ? `/explore/${slug}` : "/home" };
}

// ── Parents ─────────────────────────────────────────────────────────────────

export type ParentOnboarding = {
  familyId: string;
  /** `plan.key` of the family's current plan. Parents only: never shown to a learner. */
  plan: string;
  children: Array<{ learnerId: string; nickname: string; consentComplete: boolean; status: string }>;
  hasChildren: boolean;
  /** At least one child, and every child's required consents are complete. */
  complete: boolean;
};

export async function getParentOnboarding(ctx: Ctx<ParentActor>): Promise<ParentOnboarding> {
  const { familyId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });
  const [familyInfo, learners] = await Promise.all([getFamily(ctx, familyId), listChildren(ctx, familyId)]);
  const children = [];
  for (const learner of learners) {
    if (learner.status === "pending_deletion") continue;
    const missing = await missingRequiredConsents(ctx, learner.learnerId);
    children.push({ learnerId: learner.learnerId, nickname: learner.nickname, consentComplete: missing.length === 0, status: learner.status });
  }
  return {
    familyId,
    plan: familyInfo?.plan ?? "free",
    children,
    hasChildren: children.length > 0,
    complete: children.length > 0 && children.every((child) => child.consentComplete),
  };
}
