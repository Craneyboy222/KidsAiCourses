"use server";

import { redirect } from "next/navigation";
import { text } from "@/app/(auth)/_lib/form";
import type { A11yPrefs } from "@/components/ui/a11y-prefs";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { completeOnboarding, saveAccessibility, saveAvatar, saveInterests } from "@/server/services/onboarding";

const LIMIT = { limit: 60, windowSec: 60 * 60 };

/** Step 1: at least three interests. After this, everything else can be skipped. */
export async function saveInterestsAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "onboarding.save", LIMIT);
    const chosen = formData.getAll("interests").filter((value): value is string => typeof value === "string");
    await saveInterests(ctx, chosen);
    redirect("/onboarding?step=avatar");
  });
}

/** Step 2: the generated avatar. Only a seed is stored, never an image. */
export async function saveAvatarAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "onboarding.save", LIMIT);
    await saveAvatar(ctx, text(formData, "avatar"));
    redirect("/onboarding?step=accessibility");
  });
}

/**
 * Step 3: called by the preferences panel each time a setting changes. The panel has already
 * updated the page and the `a11y` cookie; this keeps the same choices on the profile, so they
 * follow the learner to another device. Throws on failure, which the panel reports.
 */
export async function saveAccessibilityAction(prefs: A11yPrefs): Promise<void> {
  const ctx = await requireLearner();
  await rateLimit(ctx, "onboarding.save", LIMIT);
  await saveAccessibility(ctx, prefs);
}

/** Step 4, or "skip the rest" from any step after interests: marks onboarding done and moves on. */
export async function finishOnboardingAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "onboarding.save", LIMIT);
    // "Decide later" is a second button on the project form: it wins over whichever project is selected.
    const slug = text(formData, "later") ? null : text(formData, "project") || null;
    const { next } = await completeOnboarding(ctx, { firstProjectSlug: slug });
    redirect(next);
  });
}
