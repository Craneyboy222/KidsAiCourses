import { describe, expect, it } from "vitest";
import { CATALOGUE_MAX_PAGE_SIZE, CATALOGUE_PAGE_SIZE, buildCataloguePlan, parseCatalogueFilters, type CatalogueClause, type CatalogueScope } from "@/server/services/catalogue";

const learner: CatalogueScope = { kind: "learner", age: 14, pathway: "ks3", interests: ["music", "games"], blockedCategories: [], blockedCourseIds: [] };
const kinds = (where: CatalogueClause[]) => where.map((clause) => clause.kind);
const BLOCKED_ID = "0b1f3c66-6f0e-4f0e-9f43-1d2b3c4d5e6f";

describe("buildCataloguePlan: safety conditions", () => {
  it("always requires a live course, for everyone", () => {
    expect(buildCataloguePlan({ kind: "public" }).where).toEqual([{ kind: "live" }]);
    expect(buildCataloguePlan(learner).where[0]).toEqual({ kind: "live" });
  });

  it("always applies the learner's age as a hard gate", () => {
    expect(buildCataloguePlan(learner).where).toContainEqual({ kind: "min_age_at_most", age: 14 });
    expect(buildCataloguePlan({ ...learner, age: 17 }).where).toContainEqual({ kind: "min_age_at_most", age: 17 });
    // The public catalogue has no age to apply.
    expect(kinds(buildCataloguePlan({ kind: "public" }).where)).not.toContain("min_age_at_most");
  });

  it("keeps the age gate whatever filters are sent, including another pathway", () => {
    const plan = buildCataloguePlan(learner, { pathway: "sixth_form", q: "anything", sort: "popular", free: true, difficulty: "pro", toolSlug: "replit", category: "games", maxMinutes: 60 });
    expect(plan.where).toContainEqual({ kind: "min_age_at_most", age: 14 });
    // Choosing a pathway filters by it; it never replaces or relaxes the age condition.
    expect(plan.where).toContainEqual({ kind: "pathway", pathway: "sixth_form" });
    expect(plan.where.filter((clause) => clause.kind === "min_age_at_most")).toHaveLength(1);
  });

  it("uses the learner's own pathway only to order, never to hide", () => {
    const plan = buildCataloguePlan(learner);
    expect(kinds(plan.where)).not.toContain("pathway");
    expect(plan.order[0]).toEqual({ by: "for_you", interests: ["music", "games"], pathway: "ks3" });
  });

  it("applies a parent's blocked categories and courses", () => {
    const plan = buildCataloguePlan({ ...learner, blockedCategories: ["games", "games", ""], blockedCourseIds: [BLOCKED_ID, "not-a-uuid"] });
    expect(plan.where).toContainEqual({ kind: "category_not_in", categories: ["games"] });
    expect(plan.where).toContainEqual({ kind: "course_not_in", courseIds: [BLOCKED_ID] });
    // Asking for the blocked category does not unblock it: both conditions are there.
    const asked = buildCataloguePlan({ ...learner, blockedCategories: ["games"] }, { category: "games" });
    expect(kinds(asked.where)).toEqual(["live", "min_age_at_most", "category_not_in", "category"]);
  });
});

describe("buildCataloguePlan: filters and sorts", () => {
  it("adds one clause per recognised filter", () => {
    const plan = buildCataloguePlan({ kind: "public" }, { q: "  music   video ", category: "video-film", pathway: "ks4", difficulty: "builder", maxMinutes: 120.9, toolSlug: "capcut", free: true });
    expect(plan.where).toEqual([
      { kind: "live" },
      { kind: "search", q: "music video" },
      { kind: "category", category: "video-film" },
      { kind: "pathway", pathway: "ks4" },
      { kind: "difficulty", difficulty: "builder" },
      { kind: "minutes_at_most", minutes: 120 },
      { kind: "tool", toolSlug: "capcut" },
      { kind: "free" },
    ]);
  });

  it("ignores values it does not recognise rather than trusting them", () => {
    const junk = { q: "   ", category: "Not A Slug!", pathway: "year-12", difficulty: "expert", maxMinutes: -5, toolSlug: "'; drop table course;--", free: false, sort: "price" } as unknown as Parameters<typeof buildCataloguePlan>[1];
    expect(buildCataloguePlan({ kind: "public" }, junk).where).toEqual([{ kind: "live" }]);
    expect(buildCataloguePlan({ kind: "public" }, junk).order).toEqual([{ by: "new" }]);
  });

  it("sorts: for you, new, popular (an aggregate) and shortest", () => {
    expect(buildCataloguePlan(learner, { sort: "new" }).order).toEqual([{ by: "new" }]);
    expect(buildCataloguePlan(learner, { sort: "popular" }).order).toEqual([{ by: "popular" }, { by: "new" }]);
    expect(buildCataloguePlan(learner, { sort: "shortest" }).order).toEqual([{ by: "shortest" }, { by: "new" }]);
    expect(buildCataloguePlan(learner, { sort: "for_you" }).order).toEqual([{ by: "for_you", interests: ["music", "games"], pathway: "ks3" }, { by: "new" }]);
    // Signed out there is nobody to tailor it to.
    expect(buildCataloguePlan({ kind: "public" }, { sort: "for_you" }).order).toEqual([{ by: "popular" }, { by: "new" }]);
    expect(buildCataloguePlan({ kind: "public" }).order).toEqual([{ by: "new" }]);
  });

  it("puts the best text match first when there is a search", () => {
    expect(buildCataloguePlan(learner, { q: "chatbot", sort: "shortest" }).order).toEqual([{ by: "relevance", q: "chatbot" }, { by: "shortest" }, { by: "new" }]);
  });

  it("keeps paging inside sensible limits", () => {
    expect(buildCataloguePlan({ kind: "public" })).toMatchObject({ limit: CATALOGUE_PAGE_SIZE, offset: 0 });
    expect(buildCataloguePlan({ kind: "public" }, { limit: 10_000, offset: -3 })).toMatchObject({ limit: CATALOGUE_MAX_PAGE_SIZE, offset: 0 });
    expect(buildCataloguePlan({ kind: "public" }, { limit: 0, offset: 48.7 })).toMatchObject({ limit: CATALOGUE_PAGE_SIZE, offset: 48 });
    expect(buildCataloguePlan({ kind: "public" }, { q: "x".repeat(500) }).where[1]).toEqual({ kind: "search", q: "x".repeat(100) });
  });
});

describe("parseCatalogueFilters", () => {
  it("reads page search params and a query string the same way", () => {
    const expected = { page: 3, q: "bot", category: "chatbots-agents", pathway: "ks3", difficulty: "starter", maxMinutes: 120, toolSlug: "chatgpt", free: true, sort: "shortest" };
    expect(parseCatalogueFilters({ q: " bot ", category: "chatbots-agents", pathway: "ks3", difficulty: "starter", time: "120", tool: "chatgpt", free: "1", sort: "shortest", page: "3" })).toEqual(expected);
    expect(parseCatalogueFilters(new URLSearchParams("q=bot&category=chatbots-agents&pathway=ks3&difficulty=starter&time=120&tool=chatgpt&free=on&sort=shortest&page=3"))).toEqual(expected);
  });

  it("drops anything unexpected, and takes the first of a repeated value", () => {
    expect(parseCatalogueFilters({ q: ["one", "two"], category: "UPPER", pathway: "ks9", difficulty: "hard", time: "soon", tool: "a b", free: "no", sort: "price", page: "-2", minAge: "13" })).toEqual({ page: 1, q: "one" });
    expect(parseCatalogueFilters({})).toEqual({ page: 1 });
  });
});
