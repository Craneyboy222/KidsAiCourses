// CONTRACT — owner: learning slice. See _contract.ts.
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { CATEGORY_SLUGS, DIFFICULTIES, PATHWAYS } from "@/content/schema";
import type { Ctx } from "@/server/context";
import { course, enrolment, wishlist } from "@/server/db";
import { LIVE_COURSE_STATUSES } from "./course-store";
import { canAccessCourse } from "./entitlements";
import { getLearnerSummary } from "./family";
import { assertLearnerAccess } from "./learning-access";
import { getControls } from "./parent-controls";

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

// ───────────────────────────── Building the query (pure) ─────────────────────────────

export const CATALOGUE_PAGE_SIZE = 24;
export const CATALOGUE_MAX_PAGE_SIZE = 60;
export const CATALOGUE_SORTS = ["for_you", "new", "popular", "shortest"] as const;
/** The choices offered for the "time" filter, in minutes. */
export const CATALOGUE_TIME_CHOICES = [60, 120, 180, 240] as const;

/** Who the list is for, already resolved: age, pathway, interests and the parent's blocks. */
export type CatalogueScope =
  | { kind: "public" }
  | { kind: "learner"; age: number; pathway: string; interests: string[]; blockedCategories: string[]; blockedCourseIds: string[] };

/** One condition on the list. A plain description, so the rules can be tested without a database. */
export type CatalogueClause =
  | { kind: "live" }
  /** Hard age gate: `course.min_age <= age`, whatever the pathway. */
  | { kind: "min_age_at_most"; age: number }
  | { kind: "category_not_in"; categories: string[] }
  | { kind: "course_not_in"; courseIds: string[] }
  | { kind: "search"; q: string }
  | { kind: "category"; category: string }
  | { kind: "pathway"; pathway: (typeof PATHWAYS)[number] }
  | { kind: "difficulty"; difficulty: (typeof DIFFICULTIES)[number] }
  | { kind: "minutes_at_most"; minutes: number }
  | { kind: "tool"; toolSlug: string }
  | { kind: "free" };

export type CatalogueOrder =
  /** Best text match first. Only ever added in front of another order, when there is a search. */
  | { by: "relevance"; q: string }
  /** Shared interests first, then the learner's pathway. Orders only: it never hides a course. */
  | { by: "for_you"; interests: string[]; pathway: string }
  | { by: "new" }
  /** `course.enrolment_count`: an aggregate, never anything about one learner. */
  | { by: "popular" }
  | { by: "shortest" };

export type CataloguePlan = { where: CatalogueClause[]; order: CatalogueOrder[]; limit: number; offset: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Turns a viewer and their filters into the conditions and order of the query.
 *
 * The safety conditions come from `scope` alone and are always present for a learner: nothing in
 * `filters` (which comes from the address bar) can remove or loosen them. A filter value that is
 * not recognised is ignored rather than trusted.
 */
export function buildCataloguePlan(scope: CatalogueScope, filters: CatalogueFilters = {}): CataloguePlan {
  const where: CatalogueClause[] = [{ kind: "live" }];

  if (scope.kind === "learner") {
    where.push({ kind: "min_age_at_most", age: Math.floor(scope.age) });
    const categories = [...new Set(scope.blockedCategories)].filter((slug) => slug.length > 0);
    if (categories.length > 0) where.push({ kind: "category_not_in", categories });
    const courseIds = [...new Set(scope.blockedCourseIds)].filter((id) => UUID.test(id));
    if (courseIds.length > 0) where.push({ kind: "course_not_in", courseIds });
  }

  const q = (filters.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length > 0) where.push({ kind: "search", q });
  if (isOneOf(CATEGORY_SLUGS, filters.category) || (typeof filters.category === "string" && SLUG.test(filters.category))) {
    where.push({ kind: "category", category: filters.category });
  }
  if (isOneOf(PATHWAYS, filters.pathway)) where.push({ kind: "pathway", pathway: filters.pathway });
  if (isOneOf(DIFFICULTIES, filters.difficulty)) where.push({ kind: "difficulty", difficulty: filters.difficulty });
  if (typeof filters.maxMinutes === "number" && Number.isFinite(filters.maxMinutes) && filters.maxMinutes > 0) {
    where.push({ kind: "minutes_at_most", minutes: Math.floor(filters.maxMinutes) });
  }
  if (typeof filters.toolSlug === "string" && SLUG.test(filters.toolSlug)) where.push({ kind: "tool", toolSlug: filters.toolSlug });
  if (filters.free === true) where.push({ kind: "free" });

  const sort = isOneOf(CATALOGUE_SORTS, filters.sort) ? filters.sort : scope.kind === "learner" ? "for_you" : "new";
  const order: CatalogueOrder[] = [];
  if (q.length > 0) order.push({ by: "relevance", q });
  if (sort === "for_you") {
    // Signed out there is nobody to tailor it to, so "for you" means what most people start.
    if (scope.kind === "learner") order.push({ by: "for_you", interests: scope.interests, pathway: scope.pathway });
    else order.push({ by: "popular" });
    order.push({ by: "new" });
  } else if (sort === "popular") order.push({ by: "popular" }, { by: "new" });
  else if (sort === "shortest") order.push({ by: "shortest" }, { by: "new" });
  else order.push({ by: "new" });

  const limit = Math.min(Math.max(Math.floor(filters.limit ?? CATALOGUE_PAGE_SIZE) || CATALOGUE_PAGE_SIZE, 1), CATALOGUE_MAX_PAGE_SIZE);
  const offset = Math.max(Math.floor(filters.offset ?? 0) || 0, 0);
  return { where, order, limit, offset };
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Reads filters from a page's search params or a request's query string. Unknown values are dropped. */
export function parseCatalogueFilters(params: RawParams | URLSearchParams): CatalogueFilters & { page: number } {
  const get = (key: string): string | undefined => (params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params[key]));
  const filters: CatalogueFilters & { page: number } = { page: 1 };
  const q = get("q")?.trim();
  if (q) filters.q = q.slice(0, 100);
  const category = get("category");
  if (category && SLUG.test(category)) filters.category = category;
  const pathway = get("pathway");
  if (isOneOf(PATHWAYS, pathway)) filters.pathway = pathway;
  const difficulty = get("difficulty");
  if (isOneOf(DIFFICULTIES, difficulty)) filters.difficulty = difficulty;
  const time = Number(get("time"));
  if (Number.isInteger(time) && time > 0 && time <= 24 * 60) filters.maxMinutes = time;
  const tool = get("tool");
  if (tool && SLUG.test(tool)) filters.toolSlug = tool;
  const free = get("free");
  if (free === "1" || free === "true" || free === "on") filters.free = true;
  const sort = get("sort");
  if (isOneOf(CATALOGUE_SORTS, sort)) filters.sort = sort;
  const page = Number(get("page"));
  if (Number.isInteger(page) && page > 1 && page < 10_000) filters.page = page;
  return filters;
}

// ───────────────────────────── Running it ─────────────────────────────

const textArray = (values: readonly string[]): SQL => (values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`);
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

function clauseToSql(clause: CatalogueClause): SQL {
  switch (clause.kind) {
    case "live":
      // The same test as `getPublishedCourseBySlug`: a live status, not taken down, and a published version.
      return sql`(${inArray(course.status, [...LIVE_COURSE_STATUSES])} and ${isNull(course.takenDownAt)} and ${isNotNull(course.publishedVersionId)})`;
    case "min_age_at_most":
      return lte(course.minAge, clause.age);
    case "category_not_in":
      return sql`(${course.category} is null or ${notInArray(course.category, clause.categories)})`;
    case "course_not_in":
      return notInArray(course.id, clause.courseIds);
    case "search":
      return sql`(${course.search} @@ websearch_to_tsquery('english', ${clause.q}) or ${course.title} ilike ${likePattern(clause.q)})`;
    case "category":
      return eq(course.category, clause.category);
    case "pathway":
      return sql`${clause.pathway}::pathway = any(${course.pathways})`;
    case "difficulty":
      return eq(course.difficulty, clause.difficulty);
    case "minutes_at_most":
      return lte(course.estimatedMinutes, clause.minutes);
    case "tool":
      return sql`${clause.toolSlug} = any(${course.toolSlugs})`;
    case "free":
      return eq(course.isFree, true);
  }
}

function orderToSql(order: CatalogueOrder): SQL[] {
  switch (order.by) {
    case "relevance":
      return [desc(sql`ts_rank(${course.search}, websearch_to_tsquery('english', ${order.q}))`)];
    case "for_you": {
      const shared = sql`cardinality(array(select unnest(${course.interests}) intersect select unnest(${textArray(order.interests)})))`;
      const onPathway = sql`case when ${order.pathway} = any(${course.pathways}::text[]) then 1 else 0 end`;
      return [desc(shared), desc(onPathway)];
    }
    case "new":
      return [sql`${course.publishedAt} desc nulls last`, asc(course.title)];
    case "popular":
      return [desc(course.enrolmentCount)];
    case "shortest":
      return [sql`${course.estimatedMinutes} asc nulls last`];
  }
}

type CourseRow = typeof course.$inferSelect;

function toCatalogueCourse(row: CourseRow, flags: { locked: boolean; saved: boolean; enrolled: boolean }): CatalogueCourse {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline ?? "",
    whatYouMake: row.whatYouMake ?? "",
    category: row.category ?? "",
    difficulty: row.difficulty ?? "starter",
    pathways: row.pathways,
    minAge: row.minAge,
    isFree: row.isFree,
    estimatedMinutes: row.estimatedMinutes ?? 0,
    interests: row.interests,
    toolSlugs: row.toolSlugs,
    lastVerifiedAt: row.lastVerifiedAt,
    publishedAt: row.publishedAt,
    ...flags,
  };
}

async function runPlan(ctx: Pick<Ctx, "db">, plan: CataloguePlan, extra: SQL[] = []): Promise<{ rows: CourseRow[]; total: number }> {
  const where = and(...plan.where.map(clauseToSql), ...extra);
  const [rows, totals] = await Promise.all([
    ctx.db
      .select()
      .from(course)
      .where(where)
      .orderBy(...plan.order.flatMap(orderToSql), asc(course.id))
      .limit(plan.limit)
      .offset(plan.offset),
    ctx.db.select({ n: count() }).from(course).where(where),
  ]);
  return { rows, total: totals[0]?.n ?? 0 };
}

/** The learner's age, pathway, interests and their parent's blocks: everything that shapes their catalogue. */
export async function learnerCatalogueScope(ctx: Ctx, learnerId: string): Promise<Extract<CatalogueScope, { kind: "learner" }>> {
  const [summary, controls] = await Promise.all([getLearnerSummary(ctx, learnerId), getControls(ctx, learnerId)]);
  return {
    kind: "learner",
    age: summary.age,
    pathway: summary.pathway,
    interests: summary.interests,
    blockedCategories: controls.blockedCategories,
    blockedCourseIds: controls.blockedCourseIds,
  };
}

/** Marks each row for this learner: locked (paid, and their plan does not cover it), saved, enrolled. */
async function decorateForLearner(ctx: Ctx, learnerId: string, rows: CourseRow[]): Promise<CatalogueCourse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [saved, enrolled, access] = await Promise.all([
    ctx.db.select({ courseId: wishlist.courseId }).from(wishlist).where(and(eq(wishlist.learnerId, learnerId), inArray(wishlist.courseId, ids))),
    ctx.db.select({ courseId: enrolment.courseId }).from(enrolment).where(and(eq(enrolment.learnerId, learnerId), inArray(enrolment.courseId, ids))),
    // Free courses are open to everyone, so only paid ones need the entitlement check.
    Promise.all(rows.map(async (row) => [row.id, row.isFree ? true : await canAccessCourse(ctx, learnerId, { id: row.id, isFree: row.isFree })] as const)),
  ]);
  const savedIds = new Set(saved.map((row) => row.courseId));
  const enrolledIds = new Set(enrolled.map((row) => row.courseId));
  const canAccess = new Map(access);
  return rows.map((row) => toCatalogueCourse(row, { locked: canAccess.get(row.id) !== true, saved: savedIds.has(row.id), enrolled: enrolledIds.has(row.id) }));
}

/**
 * The public and signed-in catalogues share this (spec 3.2). For a learner it NEVER returns a course
 * whose `minAge` is above their age, nor one in a parent-blocked category or course list.
 * `popular` uses aggregate counts only.
 *
 * A signed-in learner always gets their own learner view, even if a caller asks for the public
 * one: the public list would show them courses they are too young for.
 */
export async function listCatalogue(ctx: Ctx, viewer: CatalogueViewer, filters: CatalogueFilters = {}): Promise<{ items: CatalogueCourse[]; total: number }> {
  const effective: CatalogueViewer = ctx.actor.type === "learner" ? { kind: "learner", learnerId: ctx.actor.userId } : viewer;
  if (effective.kind === "public") {
    const { rows, total } = await runPlan(ctx, buildCataloguePlan({ kind: "public" }, filters));
    return { items: rows.map((row) => toCatalogueCourse(row, { locked: false, saved: false, enrolled: false })), total };
  }
  await assertLearnerAccess(ctx, "learner.catalogue.read", effective.learnerId);
  const scope = await learnerCatalogueScope(ctx, effective.learnerId);
  const { rows, total } = await runPlan(ctx, buildCataloguePlan(scope, filters));
  return { items: await decorateForLearner(ctx, effective.learnerId, rows), total };
}

/** Simple interest-based "Made for you" picks, already age- and parent-filtered. Courses already started are left out. */
export async function recommendForLearner(ctx: Ctx, learnerId: string, limit = 6): Promise<CatalogueCourse[]> {
  await assertLearnerAccess(ctx, "learner.catalogue.read", learnerId);
  const scope = await learnerCatalogueScope(ctx, learnerId);
  const plan = buildCataloguePlan(scope, { sort: "for_you", limit });
  const started = sql`"course"."id" not in (select e.course_id from "enrolment" e where e.learner_id = ${learnerId})`;
  const { rows } = await runPlan(ctx, plan, [started]);
  return decorateForLearner(ctx, learnerId, rows);
}

/**
 * Specific courses as this learner may see them, in catalogue order. Anything too old for them,
 * blocked by a parent or no longer live is simply absent, so callers (the wishlist, "continue
 * learning", "new this week") never need their own copy of the rules.
 */
export async function catalogueCoursesForLearner(
  ctx: Ctx,
  learnerId: string,
  options: { ids?: readonly string[]; publishedSince?: Date; sort?: CatalogueFilters["sort"]; limit?: number } = {},
): Promise<CatalogueCourse[]> {
  await assertLearnerAccess(ctx, "learner.catalogue.read", learnerId);
  if (options.ids && options.ids.length === 0) return [];
  const scope = await learnerCatalogueScope(ctx, learnerId);
  const plan = buildCataloguePlan(scope, { sort: options.sort ?? "new", limit: options.limit ?? CATALOGUE_MAX_PAGE_SIZE });
  const extra: SQL[] = [];
  if (options.ids) extra.push(inArray(course.id, [...new Set(options.ids)]));
  if (options.publishedSince) extra.push(sql`${course.publishedAt} >= ${options.publishedSince.toISOString()}::timestamptz`);
  const { rows } = await runPlan(ctx, plan, extra);
  return decorateForLearner(ctx, learnerId, rows);
}

/** Tools and categories that have at least one live course this viewer can see, for the filter lists. */
export async function catalogueFacets(ctx: Ctx, viewer: CatalogueViewer): Promise<{ categories: string[]; toolSlugs: string[] }> {
  const effective: CatalogueViewer = ctx.actor.type === "learner" ? { kind: "learner", learnerId: ctx.actor.userId } : viewer;
  let scope: CatalogueScope = { kind: "public" };
  if (effective.kind === "learner") {
    await assertLearnerAccess(ctx, "learner.catalogue.read", effective.learnerId);
    scope = await learnerCatalogueScope(ctx, effective.learnerId);
  }
  const where = and(...buildCataloguePlan(scope).where.map(clauseToSql));
  const rows = await ctx.db.select({ category: course.category, toolSlugs: course.toolSlugs }).from(course).where(where);
  const categories = [...new Set(rows.map((row) => row.category).filter((value): value is string => value !== null && value !== ""))].sort();
  const toolSlugs = [...new Set(rows.flatMap((row) => row.toolSlugs))].sort();
  return { categories, toolSlugs };
}
