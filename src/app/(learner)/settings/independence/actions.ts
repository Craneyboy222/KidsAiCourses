"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { consentChoices, text, ticked } from "@/app/(auth)/_lib/form";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { AppError } from "@/server/errors";
import { confirmIndependence, removeParentLink, requestIndependence } from "@/server/services/independence";

const emailSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email("Enter your email address, like name@example.com.").max(254)) });

/** Step 1: the learner's own email address. A confirmation link is sent; nothing else changes. */
export async function requestIndependenceAction(_prev: ActionState<{ sent: true }>, formData: FormData): Promise<ActionState<{ sent: true }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const { email } = emailSchema.parse({ email: text(formData, "email") });
    // `requestIndependence` is rate limited itself (five an hour per learner).
    await requestIndependence(ctx, { email });
    return { sent: true as const };
  });
}

const confirmSchema = z.object({ token: z.string().min(10).max(200), parentLink: z.enum(["keep", "remove"], "Choose whether to stay linked to your parent or carer.") });

/** Step 2, from the emailed link: their own consents and what happens to the parent link. */
export async function confirmIndependenceAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const input = confirmSchema.parse({ token: text(formData, "token"), parentLink: text(formData, "parentLink") });
    if (!ticked(formData, "understood")) {
      throw new AppError("invalid_input", "Tick the box to confirm that you want to take over your account.", { fieldErrors: { understood: ["Tick this box to confirm."] } });
    }
    const result = await confirmIndependence(ctx, { ...input, consents: consentChoices(formData) });
    revalidatePath("/settings/independence");
    // The page now has a different shape (no more form), so the outcome travels in the address.
    redirect(`/settings/independence?done=${result.parentLinkRemoved ? "own" : "linked"}`);
  });
}

/** Later, for someone who stayed linked: leave the parent's family. */
export async function removeParentLinkAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    if (!ticked(formData, "confirm")) {
      throw new AppError("invalid_input", "Tick the box to confirm that you want to remove the link.", { fieldErrors: { confirm: ["Tick this box to confirm."] } });
    }
    await removeParentLink(ctx);
    revalidatePath("/settings/independence");
    redirect("/settings/independence?done=unlinked");
  });
}
