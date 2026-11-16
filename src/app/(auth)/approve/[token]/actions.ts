"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import { getCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { approveTeen, createParentForApproval, declineTeen } from "@/server/services/approve-teen";
import { endSession, requestHeaders } from "../../_lib/after-sign-in";
import { raw, text, ticked } from "../../_lib/form";

const tokenOf = (formData: FormData) => z.string().min(10).max(200).parse(text(formData, "token"));
const approvePath = (token: string) => `/approve/${encodeURIComponent(token)}`;

const createSchema = z.object({
  name: z.string().trim().max(80, "Keep your name to 80 characters or fewer.").optional(),
  password: z.string().min(1, "Choose a password.").max(128),
  confirmedAdult: z.boolean(),
});

/**
 * A parent with no account yet creates one for the address the link was sent to, and is signed
 * in. Nothing is approved by this step: they come back to the same page to say yes or no.
 */
export async function createParentForApprovalAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const token = tokenOf(formData);
    const input = createSchema.parse({ name: text(formData, "name") || undefined, password: raw(formData, "password"), confirmedAdult: ticked(formData, "confirmedAdult") });
    await rateLimit(ctx, "approve.create_parent", { limit: 10, windowSec: 60 * 60 });
    // Whoever was signed in on this device, the new account is made by a visitor holding the link.
    const created = await createParentForApproval({ ...ctx, actor: { type: "anonymous" } }, token, input);
    await endSession();
    try {
      await getAuth().api.signInEmail({ body: { email: created.email, password: input.password }, headers: await requestHeaders() });
    } catch {
      redirect(`/signin?as=parent&notice=created&next=${encodeURIComponent(approvePath(token))}`);
    }
    redirect(approvePath(token));
  });
}

/** The signed-in parent says yes. The teen joins the family; the consent centre comes next. */
export async function approveTeenAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const token = tokenOf(formData);
    if (ctx.actor.type !== "parent") throw new AppError("unauthenticated", "Sign in to your parent account, or create one, to approve this request.");
    await rateLimit(ctx, "approve.decide", { limit: 20, windowSec: 60 * 60 });
    const { learnerId } = await approveTeen(ctx, token);
    redirect(`/parent/children/${learnerId}/consent?from=approval`);
  });
}

/** "No" or "I don't recognise this": the pending account is deleted at once. */
export async function declineTeenAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const token = tokenOf(formData);
    if (ctx.actor.type !== "anonymous" && ctx.actor.type !== "parent") {
      throw new AppError("forbidden", "Sign out first, then open the link from the email again.");
    }
    if (!ticked(formData, "confirm")) {
      throw new AppError("invalid_input", "Tick the box to confirm that the account should be deleted.", { fieldErrors: { confirm: ["Tick this box to confirm."] } });
    }
    await rateLimit(ctx, "approve.decide", { limit: 20, windowSec: 60 * 60 });
    await declineTeen(ctx, token);
    // The request no longer exists, so the page can only say what happened from the address.
    redirect(`${approvePath(token)}?declined=1`);
  });
}
