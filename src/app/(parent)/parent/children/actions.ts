"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BLOCKED_AGE_PATH, hasAgeGateCookie, withAgeGate } from "@/app/(auth)/_lib/age-gate";
import { birthFrom, consentChoices, raw, text, ticked } from "@/app/(auth)/_lib/form";
import { formatDateTime } from "@/lib/dates";
import { runAction, type ActionState } from "@/server/action";
import { requireParent } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { addChild } from "@/server/services/children";
import { saveConsents } from "@/server/services/consent";
import { assertOldEnough } from "@/server/services/signup";

const childSchema = z.object({
  nickname: z.string().trim().min(1, "Add a nickname, so we know what to call them.").max(60),
  username: z.string().trim().min(1, "Choose a username.").max(40),
  password: z.string().max(128).optional(),
});

export type AddedChild = {
  learnerId: string;
  nickname: string;
  username: string;
  /** Present when no password was set. Shown once, here; it is also emailed to the parent. */
  invite: { code: string; expiresOn: string } | null;
};

/**
 * Adds a child to the signed-in parent's family. With a password, goes straight to the consent
 * centre; without one, returns the one-time code to show.
 */
export async function addChildAction(_prev: ActionState<AddedChild>, formData: FormData): Promise<ActionState<AddedChild>> {
  return runAction(async () => {
    if (await hasAgeGateCookie()) redirect(BLOCKED_AGE_PATH);
    const ctx = await requireParent();
    const birth = birthFrom(formData);
    // The age gate first, before the rest of the form is read or any limit is counted.
    await withAgeGate(() => assertOldEnough(ctx, birth));
    const input = childSchema.parse({ nickname: text(formData, "nickname"), username: text(formData, "username"), password: raw(formData, "password") || undefined });
    await rateLimit(ctx, "children.add", { limit: 10, windowSec: 60 * 60 });
    const added = await withAgeGate(() => addChild(ctx, { ...birth, ...input, password: input.password ?? null }));
    revalidatePath("/parent", "layout");
    if (!added.invite) redirect(`/parent/children/${added.learnerId}/consent?from=new`);
    return {
      learnerId: added.learnerId,
      nickname: added.nickname,
      username: added.username,
      invite: { code: added.invite.formatted, expiresOn: formatDateTime(added.invite.expiresAt) },
    };
  });
}

export type SavedConsents = {
  status: string;
  activated: boolean;
  paused: boolean;
  missingRequired: string[];
  changed: number;
};

/** Saves the consent centre for one child. Withdrawing a required consent needs the confirmation tick. */
export async function saveConsentsAction(_prev: ActionState<SavedConsents>, formData: FormData): Promise<ActionState<SavedConsents>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = z.uuid().parse(text(formData, "learnerId"));
    await rateLimit(ctx, "consent.save", { limit: 30, windowSec: 60 * 60 });
    const method = text(formData, "from") === "approval" ? "teen_approval" : "consent_centre";
    const result = await saveConsents(ctx, learnerId, { choices: consentChoices(formData), method, confirmPause: ticked(formData, "confirmPause") });
    revalidatePath("/parent", "layout");
    return { status: result.status, activated: result.activated, paused: result.paused, missingRequired: result.missingRequired, changed: result.changed.length };
  });
}
