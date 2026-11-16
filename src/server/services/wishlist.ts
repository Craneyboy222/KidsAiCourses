import { and, desc, eq } from "drizzle-orm";
import { assertCan } from "@/server/authz";
import type { Ctx } from "@/server/context";
import { wishlist } from "@/server/db";
import { AppError } from "@/server/errors";
import { catalogueCoursesForLearner, type CatalogueCourse } from "./catalogue";

/**
 * "Save for later" (spec 3.2). A learner can only save a course they can see: the catalogue rules
 * (age, parent blocks, live) decide, so a guessed course id tells them nothing.
 */
export async function saveForLater(ctx: Ctx, learnerId: string, courseId: string): Promise<{ saved: true }> {
  assertCan(ctx.actor, "learner.wishlist.write", { learnerId });
  const [visible] = await catalogueCoursesForLearner(ctx, learnerId, { ids: [courseId] });
  if (!visible) throw new AppError("not_found", "That course could not be found. It may have been moved or removed.");
  await ctx.db.insert(wishlist).values({ learnerId, courseId, createdAt: ctx.now, updatedAt: ctx.now }).onConflictDoNothing({ target: [wishlist.learnerId, wishlist.courseId] });
  return { saved: true };
}

/** Removing always works, including for a course the learner can no longer see. */
export async function removeSaved(ctx: Ctx, learnerId: string, courseId: string): Promise<{ saved: false }> {
  assertCan(ctx.actor, "learner.wishlist.write", { learnerId });
  await ctx.db.delete(wishlist).where(and(eq(wishlist.learnerId, learnerId), eq(wishlist.courseId, courseId)));
  return { saved: false };
}

/** Saved courses, most recently saved first. A course that has since been hidden from this learner is left out. */
export async function listSaved(ctx: Ctx, learnerId: string): Promise<CatalogueCourse[]> {
  assertCan(ctx.actor, "learner.wishlist.write", { learnerId });
  const rows = await ctx.db.select({ courseId: wishlist.courseId }).from(wishlist).where(eq(wishlist.learnerId, learnerId)).orderBy(desc(wishlist.createdAt));
  const visible = new Map((await catalogueCoursesForLearner(ctx, learnerId, { ids: rows.map((row) => row.courseId) })).map((item) => [item.id, item]));
  return rows.map((row) => visible.get(row.courseId)).filter((item): item is CatalogueCourse => item !== undefined);
}
