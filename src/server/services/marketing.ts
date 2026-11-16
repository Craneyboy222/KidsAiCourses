import { isUnder18Learner } from "@/lib/marketing/site";
import type { Ctx } from "@/server/context";
import { logWarn } from "@/server/log";
import { listCatalogue, type CatalogueCourse } from "./catalogue";
import { canSeePrices, listPublicPlans, type PlanPricing, type PublicPlan } from "./plans";

/**
 * What the public pages need from the rest of the product, shaped for the page. Read-only.
 *
 * The one rule that matters here: a learner under 18 never receives a price (spec 3.7). The
 * pricing view for them has no plans in it at all, so there is nothing a template could show by
 * mistake.
 */
export type PricedPlan = Omit<PublicPlan, "pricing"> & { pricing: PlanPricing };

export type PricingView =
  /** A learner under 18: the "Ask a parent" page. Carries no plan and no amount. */
  | { kind: "ask_parent" }
  | { kind: "plans"; plans: PricedPlan[]; viewer: "visitor" | "parent" | "adult_learner" | "staff" };

export async function getPricingView(ctx: Pick<Ctx, "db" | "actor">): Promise<PricingView> {
  const { actor } = ctx;
  // Two independent checks: this slice's own rule, and the payments slice's.
  if (isUnder18Learner(actor) || !canSeePrices(actor)) return { kind: "ask_parent" };
  const plans = await listPublicPlans(ctx);
  const priced: PricedPlan[] = [];
  for (const plan of plans) {
    // `listPublicPlans` answers `pricing: null` for anyone who may not see prices. If that ever
    // happens here, show no prices at all rather than some.
    if (plan.pricing === null) return { kind: "ask_parent" };
    priced.push({ ...plan, pricing: plan.pricing });
  }
  const viewer = actor.type === "parent" ? "parent" : actor.type === "learner" ? "adult_learner" : actor.type === "staff" ? "staff" : "visitor";
  return { kind: "plans", plans: priced, viewer };
}

export const HOME_COURSE_COUNT = 6;

/**
 * Real, published courses for the home page, newest first. Empty for a signed-in learner: the
 * public list is not filtered by age or by a parent's blocks, so learners are pointed at their
 * own catalogue instead. A failure here never takes the home page down.
 */
export async function getHomeCourses(ctx: Ctx, limit: number = HOME_COURSE_COUNT): Promise<CatalogueCourse[]> {
  if (ctx.actor.type === "learner") return [];
  try {
    const { items } = await listCatalogue(ctx, { kind: "public" }, { sort: "new", limit });
    return items;
  } catch (error) {
    logWarn("marketing.home_courses_unavailable", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/** Every published course's slug and last change, for the sitemap. */
export async function listPublicCourseEntries(ctx: Ctx): Promise<{ slug: string; lastModified: Date | null }[]> {
  const entries: { slug: string; lastModified: Date | null }[] = [];
  const pageSize = 60;
  for (let offset = 0; offset < 6000; offset += pageSize) {
    const { items, total } = await listCatalogue(ctx, { kind: "public" }, { sort: "new", limit: pageSize, offset });
    for (const item of items) entries.push({ slug: item.slug, lastModified: item.lastVerifiedAt ?? item.publishedAt });
    if (items.length === 0 || entries.length >= total) break;
  }
  return entries;
}
