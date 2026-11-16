// CONTRACT — owner: learning slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import { notImplemented } from "./_contract";

export type CatalogueCourse = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  whatYouMake: string;
  category: string;
  difficulty: "starter" | "builder" | "pro";
  pathways: string[];
  minAge: number;
  isFree: boolean;
  estimatedMinutes: number;
  interests: string[];
  toolSlugs: string[];
  lastVerifiedAt: Date | null;
  publishedAt: Date | null;
  /** Learner view only: paid course on the Free plan. Shown locked with "Ask a parent to unlock" — never with a price. */
  locked: boolean;
  /** Learner view only. */
  saved: boolean;
  enrolled: boolean;
};

export type CatalogueViewer = { kind: "public" } | { kind: "learner"; learnerId: string };

export type CatalogueFilters = {
  q?: string;
  category?: string;
  pathway?: string;
  difficulty?: "starter" | "builder" | "pro";
  maxMinutes?: number;
  toolSlug?: string;
  free?: boolean;
  sort?: "for_you" | "new" | "popular" | "shortest";
  limit?: number;
  offset?: number;
};

/**
 * The public and signed-in catalogues share this (spec 3.2). For a learner it NEVER returns a course
 * whose `minAge` is above their age, nor one in a parent-blocked category or course list.
 * `popular` uses aggregate counts only.
 */
export async function listCatalogue(_ctx: Ctx, _viewer: CatalogueViewer, _filters?: CatalogueFilters): Promise<{ items: CatalogueCourse[]; total: number }> {
  return notImplemented("catalogue.listCatalogue");
}
/** Simple interest-based "Made for you" picks, already age- and parent-filtered. */
export async function recommendForLearner(_ctx: Ctx, _learnerId: string, _limit?: number): Promise<CatalogueCourse[]> {
  return notImplemented("catalogue.recommendForLearner");
}
