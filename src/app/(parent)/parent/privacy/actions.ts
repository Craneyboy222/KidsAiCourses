"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { text, ticked } from "@/app/(auth)/_lib/form";
import { formatDate } from "@/lib/dates";
import { runAction, type ActionState } from "@/server/action";
import { requireParent } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { cancelDeletion, requestChildDeletion, requestExport, requestFamilyDeletion } from "@/server/services/data-request";

const learnerIdSchema = z.uuid("That child could not be found in your family.");

export type ExportRequested = { requestId: string; nickname: string | null };

/** Asks for a download of one child's data. The file is built in the background and we email when it is ready. */
export async function requestExportAction(_prev: ActionState<ExportRequested>, formData: FormData): Promise<ActionState<ExportRequested>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    await rateLimit(ctx, "data.export", { limit: 6, windowSec: 24 * 60 * 60 });
    const view = await requestExport(ctx, { learnerId });
    revalidatePath("/parent/privacy");
    return { requestId: view.id, nickname: view.learnerNickname };
  });
}

export type DeletionScheduled = { requestId: string; deleteOn: string; scope: "learner" | "family" };

function assertConfirmed(formData: FormData): void {
  if (!ticked(formData, "confirm")) {
    throw new AppError("invalid_input", "Tick the box to confirm that you have read what will be deleted.", { fieldErrors: { confirm: ["Tick this box to confirm."] } });
  }
}

/** Starts the 14-day deletion of one child's account. Nothing is removed until the 14 days are up. */
export async function deleteChildAction(_prev: ActionState<DeletionScheduled>, formData: FormData): Promise<ActionState<DeletionScheduled>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const learnerId = learnerIdSchema.parse(text(formData, "learnerId"));
    assertConfirmed(formData);
    await rateLimit(ctx, "data.delete", { limit: 10, windowSec: 24 * 60 * 60 });
    const view = await requestChildDeletion(ctx, learnerId);
    revalidatePath("/parent", "layout");
    return { requestId: view.id, deleteOn: view.undoUntil ? formatDate(view.undoUntil) : "", scope: "learner" as const };
  });
}

/** Starts the 14-day deletion of the whole family account. Only the parent who set it up can do this. */
export async function deleteFamilyAction(_prev: ActionState<DeletionScheduled>, formData: FormData): Promise<ActionState<DeletionScheduled>> {
  return runAction(async () => {
    const ctx = await requireParent();
    assertConfirmed(formData);
    // Typing the word is the second deliberate step: this closes every account in the family.
    if (text(formData, "confirmWord").toUpperCase() !== "DELETE") {
      throw new AppError("invalid_input", "Type DELETE in the box to confirm.", { fieldErrors: { confirmWord: ["Type DELETE to confirm."] } });
    }
    await rateLimit(ctx, "data.delete", { limit: 10, windowSec: 24 * 60 * 60 });
    const view = await requestFamilyDeletion(ctx);
    revalidatePath("/parent", "layout");
    return { requestId: view.id, deleteOn: view.undoUntil ? formatDate(view.undoUntil) : "", scope: "family" as const };
  });
}

/** Undoes a deletion inside its 14 days. */
export async function cancelDeletionAction(_prev: ActionState<{ cancelled: true }>, formData: FormData): Promise<ActionState<{ cancelled: true }>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const requestId = z.uuid("That request could not be found.").parse(text(formData, "requestId"));
    await cancelDeletion(ctx, requestId);
    revalidatePath("/parent", "layout");
    return { cancelled: true as const };
  });
}
