"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { text } from "@/app/(auth)/_lib/form";
import { runAction, type ActionState } from "@/server/action";
import { requireParent } from "@/server/context";
import { markParentNoticesRead } from "@/server/services/parent-dashboard";

/** Marks one of the parent's own notices, or all of them, as read. */
export async function markNoticesReadAction(_prev: ActionState<{ changed: number }>, formData: FormData): Promise<ActionState<{ changed: number }>> {
  return runAction(async () => {
    const ctx = await requireParent();
    const id = text(formData, "id");
    const changed = await markParentNoticesRead(ctx, id === "all" ? "all" : [z.uuid("That notice could not be found.").parse(id)]);
    revalidatePath("/parent/notices");
    revalidatePath("/parent");
    return { changed };
  });
}
