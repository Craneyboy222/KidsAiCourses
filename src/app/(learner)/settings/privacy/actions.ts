"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { text, ticked } from "@/app/(auth)/_lib/form";
import { formatDate } from "@/lib/dates";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { cancelDeletion, requestExport, requestSelfDeletion } from "@/server/services/data-request";

/**
 * Data rights for an 18-year-old, on their own account (spec 3.6 and the parents brief: "A learner
 * aged 18 can do both for themselves"). The service refuses anyone under 18 and anyone else's data.
 */
export async function requestOwnExportAction(_prev: ActionState<{ requestId: string }>, _formData: FormData): Promise<ActionState<{ requestId: string }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "data.export", { limit: 6, windowSec: 24 * 60 * 60 });
    const view = await requestExport(ctx);
    revalidatePath("/settings/privacy");
    return { requestId: view.id };
  });
}

export async function deleteOwnAccountAction(_prev: ActionState<{ deleteOn: string }>, formData: FormData): Promise<ActionState<{ deleteOn: string }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    if (!ticked(formData, "confirm")) {
      throw new AppError("invalid_input", "Tick the box to confirm that you have read what will be deleted.", { fieldErrors: { confirm: ["Tick this box to confirm."] } });
    }
    if (text(formData, "confirmWord").toUpperCase() !== "DELETE") {
      throw new AppError("invalid_input", "Type DELETE in the box to confirm.", { fieldErrors: { confirmWord: ["Type DELETE to confirm."] } });
    }
    await rateLimit(ctx, "data.delete", { limit: 10, windowSec: 24 * 60 * 60 });
    const view = await requestSelfDeletion(ctx);
    revalidatePath("/settings", "layout");
    return { deleteOn: view.undoUntil ? formatDate(view.undoUntil) : "" };
  });
}

export async function keepOwnAccountAction(_prev: ActionState<{ cancelled: true }>, formData: FormData): Promise<ActionState<{ cancelled: true }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const requestId = z.uuid("That request could not be found.").parse(text(formData, "requestId"));
    await cancelDeletion(ctx, requestId);
    revalidatePath("/settings", "layout");
    return { cancelled: true as const };
  });
}
