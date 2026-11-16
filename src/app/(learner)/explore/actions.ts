"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/ratelimit";
import { catalogueCoursesForLearner } from "@/server/services/catalogue";
import { startCourse } from "@/server/services/enrolment";
import { requestToolApproval } from "@/server/services/tool-approval";
import { requestUnlock } from "@/server/services/unlock-requests";
import { removeSaved, saveForLater } from "@/server/services/wishlist";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const NOT_FOUND = "That course could not be found. It may have been moved or removed.";

/** Start (or carry on with) a course. The service runs the whole gate; on success the player opens. */
export async function startCourseAction(_prev: ActionState<null>, formData: FormData): Promise<ActionState<null>> {
  const result = await runAction(async () => {
    const ctx = await requireLearner();
    const slug = slugSchema.parse(formData.get("slug"));
    await rateLimit(ctx, "enrolment.start", { limit: 30, windowSec: 3600 });
    const { enrolment } = await startCourse(ctx, { learnerId: ctx.actor.userId, courseSlug: slug });
    return `/learn/${enrolment.courseSlug}${enrolment.currentStepKey ? `/${enrolment.currentStepKey}` : ""}`;
  });
  if (result.ok) redirect(result.data);
  return result;
}

const savedSchema = z.object({ courseId: z.uuid(), slug: slugSchema, save: z.enum(["1", "0"]) });

/** Save for later, or take it off the list. */
export async function toggleSavedAction(_prev: ActionState<{ saved: boolean }>, formData: FormData): Promise<ActionState<{ saved: boolean }>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const input = savedSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "wishlist.write", { limit: 60, windowSec: 60 });
    const result = input.save === "1" ? await saveForLater(ctx, ctx.actor.userId, input.courseId) : await removeSaved(ctx, ctx.actor.userId, input.courseId);
    revalidatePath(`/explore/${input.slug}`);
    revalidatePath("/home");
    return result;
  });
}

const askSchema = z.object({ courseId: z.uuid(), slug: slugSchema, kind: z.enum(["paid_course", "pro_course"]) });

/**
 * "Ask a parent to unlock": the only thing a learner can do about a locked course. A learner can
 * only ask about a course they can see, so this cannot be used to probe for hidden ones. Used as a
 * plain form action, so it reports back through the address rather than a return value.
 */
export async function askUnlockAction(formData: FormData): Promise<void> {
  const parsed = askSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/explore");
  const input = parsed.data;
  const result = await runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "unlock.request", { limit: 10, windowSec: 3600 });
    const [visible] = await catalogueCoursesForLearner(ctx, ctx.actor.userId, { ids: [input.courseId] });
    if (!visible) throw new AppError("not_found", NOT_FOUND);
    await requestUnlock(ctx, { learnerId: ctx.actor.userId, courseId: input.courseId, kind: input.kind });
  });
  revalidatePath(`/explore/${input.slug}`);
  redirect(`/explore/${input.slug}?asked=${result.ok ? "sent" : "failed"}`);
}

const toolSchema = z.object({ courseId: z.uuid(), slug: slugSchema, toolSlug: slugSchema });

/** Ask a parent to approve a tool for this course (spec 3.3). */
export async function askToolApprovalAction(formData: FormData): Promise<void> {
  const parsed = toolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/explore");
  const input = parsed.data;
  const result = await runAction(async () => {
    const ctx = await requireLearner();
    await rateLimit(ctx, "tool_approval.request", { limit: 10, windowSec: 3600 });
    const [visible] = await catalogueCoursesForLearner(ctx, ctx.actor.userId, { ids: [input.courseId] });
    if (!visible) throw new AppError("not_found", NOT_FOUND);
    await requestToolApproval(ctx, { learnerId: ctx.actor.userId, courseId: input.courseId, toolSlug: input.toolSlug });
  });
  revalidatePath(`/explore/${input.slug}`);
  redirect(`/explore/${input.slug}?asked=${result.ok ? "sent" : "failed"}`);
}
