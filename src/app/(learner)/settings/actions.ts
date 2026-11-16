"use server";

import { revalidatePath } from "next/cache";
import type { A11yPrefs } from "@/components/ui/a11y-prefs";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { markRead } from "@/server/notifications";
import { rateLimit } from "@/server/ratelimit";
import { saveAccessibility, saveAvatar, saveInterests } from "@/server/services/onboarding";

const LIMIT = { limit: 60, windowSec: 60 * 60 };

/**
 * Called by the preferences panel on every change. The panel has already updated the page and the
 * `a11y` cookie; this saves the same choices to the learner's profile so they follow them to
 * another device. Throws on failure, which the panel reports.
 */
export async function saveSettingsA11yAction(prefs: A11yPrefs): Promise<void> {
  const ctx = await requireLearner();
  await rateLimit(ctx, "settings.save", LIMIT);
  await saveAccessibility(ctx, prefs);
}

export async function saveSettingsInterestsAction(_prev: ActionState<{ saved: true }>, formData: FormData): Promise<ActionState<{ saved: true }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "settings.save", LIMIT);
    const chosen = formData.getAll("interests").filter((value): value is string => typeof value === "string");
    await saveInterests(ctx, chosen);
    revalidatePath("/settings");
    revalidatePath("/home");
    return { saved: true as const };
  });
}

export async function saveSettingsAvatarAction(_prev: ActionState<{ saved: true }>, formData: FormData): Promise<ActionState<{ saved: true }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "settings.save", LIMIT);
    const seed = formData.get("avatar");
    await saveAvatar(ctx, typeof seed === "string" ? seed : "");
    // The avatar is in the frame around every learner page.
    revalidatePath("/", "layout");
    return { saved: true as const };
  });
}

export async function markNoticesReadAction(_prev: ActionState<{ changed: number }>, _formData: FormData): Promise<ActionState<{ changed: number }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "settings.save", LIMIT);
    const changed = await markRead(ctx, ctx.actor.userId, "all");
    revalidatePath("/settings");
    revalidatePath("/home");
    return { changed };
  });
}
