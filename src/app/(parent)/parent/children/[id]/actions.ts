"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { raw, text, ticked } from "@/app/(auth)/_lib/form";
import { formatDateTime } from "@/lib/dates";
import { parseControlsForm } from "@/lib/parents/controls-rules";
import { runAction, type ActionState } from "@/server/action";
import { requireParent } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { issueChildInvite, resetChildPassword } from "@/server/services/children";
import { requireOwnChild } from "@/server/services/parent-dashboard";
import { pauseLearner, resumeLearner, updateControls } from "@/server/services/parent-controls";

/**
 * Actions for one child. Every one starts the same way: the signed-in parent, then
 * `requireOwnChild`, which answers "not found" unless the id belongs to a child in the family the
 * session says this parent is in. The services check again.
 */
const learnerIdSchema = z.uuid("That child could not be found in your family.");

const all = (formData: FormData, name: string): string[] => formData.getAll(name).filter((value): value is string => typeof value === "string" && value.trim() !== "");

export type SavedControls = { saved: true; dailyMinutesCap: number | null; quietOn: boolean };

/** Saves the daily limit, quiet hours, blocks and Pro approval for one child. */
export async function saveControlsAction(_prev: ActionState<SavedControls>, formData: FormData): Promise<ActionState<SavedControls>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    await requireOwnChild(ctx, learnerId);
    await rateLimit(ctx, "controls.save", { limit: 60, windowSec: 60 * 60 });
    const parsed = parseControlsForm({
      dailyCap: text(formData, "dailyCap"),
      quietEnabled: ticked(formData, "quietEnabled"),
      quietStart: text(formData, "quietStart"),
      quietEnd: text(formData, "quietEnd"),
      blockedCategories: all(formData, "blockedCategories"),
      blockedCourseIds: all(formData, "blockedCourseIds"),
      requireApprovalForPro: ticked(formData, "requireApprovalForPro"),
    });
    if (!parsed.ok) throw new AppError("invalid_input", "Some of that didn't look right. Check the highlighted fields and try again.", { fieldErrors: parsed.fieldErrors });
    const controls = await updateControls(ctx, learnerId, parsed.value);
    revalidatePath(`/parent/children/${learnerId}`, "layout");
    revalidatePath("/parent");
    return { saved: true as const, dailyMinutesCap: controls.dailyMinutesCap, quietOn: controls.quietStartMin !== controls.quietEndMin };
  });
}

export type PauseOutcome = { paused: boolean; waitingForConsent: boolean };

/** Pauses the child's account now and signs them out, or switches it back on. */
export async function setPausedAction(_prev: ActionState<PauseOutcome>, formData: FormData): Promise<ActionState<PauseOutcome>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    await requireOwnChild(ctx, learnerId);
    await rateLimit(ctx, "controls.pause", { limit: 30, windowSec: 60 * 60 });
    const intent = z.enum(["pause", "resume"]).parse(text(formData, "intent"));
    const result = intent === "pause" ? await pauseLearner(ctx, learnerId, { reason: text(formData, "reason") }) : await resumeLearner(ctx, learnerId);
    revalidatePath(`/parent/children/${learnerId}`, "layout");
    revalidatePath("/parent");
    return { paused: result.paused, waitingForConsent: result.waitingForConsent };
  });
}

export type PasswordReset = { mode: "password" } | { mode: "code"; code: string; expiresOn: string };

/**
 * Resets a child's password (spec 3.1). With a new password, that becomes their password. With
 * none, the old one stops working and a one-time code is shown for the child to choose their own.
 * Either way they are signed out everywhere.
 */
export async function resetPasswordAction(_prev: ActionState<PasswordReset>, formData: FormData): Promise<ActionState<PasswordReset>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    await requireOwnChild(ctx, learnerId);
    await rateLimit(ctx, "children.reset_password", { limit: 10, windowSec: 60 * 60 });
    const mode = z.enum(["password", "code"]).parse(text(formData, "mode") || "code");
    // Passwords are never trimmed.
    const password = mode === "password" ? raw(formData, "password") : "";
    if (mode === "password" && password.length === 0) {
      throw new AppError("invalid_input", "Type the new password, or choose the one-time code instead.", { fieldErrors: { password: ["Type the new password."] } });
    }
    const result = await resetChildPassword(ctx, learnerId, { password: mode === "password" ? password : null });
    revalidatePath(`/parent/children/${learnerId}`);
    if (result.invite) return { mode: "code" as const, code: result.invite.formatted, expiresOn: formatDateTime(result.invite.expiresAt) };
    return { mode: "password" as const };
  });
}

/** A fresh one-time code for a child who has not set a password yet. Their existing password, if any, keeps working. */
export async function newInviteCodeAction(_prev: ActionState<PasswordReset>, formData: FormData): Promise<ActionState<PasswordReset>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    await requireOwnChild(ctx, learnerId);
    await rateLimit(ctx, "children.invite", { limit: 10, windowSec: 60 * 60 });
    const invite = await issueChildInvite(ctx, learnerId);
    return { mode: "code" as const, code: invite.formatted, expiresOn: formatDateTime(invite.expiresAt) };
  });
}
