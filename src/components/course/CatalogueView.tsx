import { Search } from "lucide-react";
import { Checkbox, EmptyState, Field, Icon, Input, LinkButton, Pagination, Select, SubmitButton } from "@/components/ui";
import { DIFFICULTIES, DIFFICULTY_LABELS, PATHWAYS, PATHWAY_LABELS } from "@/content/schema";
import { formatMinutes } from "@/lib/dates";
import { CATALOGUE_PAGE_SIZE, CATALOGUE_TIME_CHOICES, type CatalogueCourse, type CatalogueFilters } from "@/server/services/catalogue";
import { CourseGrid, categoryName } from "./CourseCard";

export type CatalogueViewProps = {
  /** `/courses` or `/explore`. The filters are a plain GET form to this address. */
  basePath: string;
  audience: "public" | "learner";
  items: CatalogueCourse[];
  total: number;
  filters: CatalogueFilters & { page: number };
  /** Categories and tools that have at least one course this viewer can see. */
  categories: string[];
  tools: { slug: string; name: string }[];
};

const SORT_LABELS = { for_you: "For you", new: "Newest", popular: "Most started", shortest: "Shortest first" } as const;

function queryFor(filters: CatalogueViewProps["filters"], page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.pathway) params.set("pathway", filters.pathway);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.maxMinutes) params.set("time", String(filters.maxMinutes));
  if (filters.toolSlug) params.set("tool", filters.toolSlug);
  if (filters.free) params.set("free", "1");
  if (filters.sort) params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Search, filters, results and paging for both catalogues (spec 3.2). A Server Component around an
 * ordinary GET form: it works without JavaScript, the address can be shared or bookmarked, and
 * nothing is filtered in the browser. What may be listed at all is decided by the catalogue
 * service, not here.
 */
export function CatalogueView({ basePath, audience, items, total, filters, categories, tools }: CatalogueViewProps) {
  const active = Boolean(filters.q || filters.category || filters.pathway || filters.difficulty || filters.maxMinutes || filters.toolSlug || filters.free);
  const sort = filters.sort ?? (audience === "learner" ? "for_you" : "new");
  const pageCount = Math.max(1, Math.ceil(total / CATALOGUE_PAGE_SIZE));
  return (
    <div className="flex flex-col gap-6">
      <form action={basePath} method="get" role="search" aria-label="Find a course" className="rounded-card border-ink bg-surface flex flex-col gap-4 border-2 p-4">
        <Field label="Search courses" hint="Try something you'd like to make, such as a game, a video or a chatbot.">
          <Input type="search" name="q" defaultValue={filters.q ?? ""} maxLength={100} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Category">
            <Select name="category" defaultValue={filters.category ?? ""} placeholder="Any category" options={categories.map((slug) => ({ value: slug, label: categoryName(slug) }))} />
          </Field>
          <Field label="School stage">
            <Select name="pathway" defaultValue={filters.pathway ?? ""} placeholder="Any stage" options={PATHWAYS.map((value) => ({ value, label: PATHWAY_LABELS[value] }))} />
          </Field>
          <Field label="Level">
            <Select name="difficulty" defaultValue={filters.difficulty ?? ""} placeholder="Any level" options={DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }))} />
          </Field>
          <Field label="Time">
            <Select name="time" defaultValue={filters.maxMinutes ? String(filters.maxMinutes) : ""} placeholder="Any length" options={CATALOGUE_TIME_CHOICES.map((value) => ({ value: String(value), label: `Up to ${formatMinutes(value)}` }))} />
          </Field>
          <Field label="Tool">
            <Select name="tool" defaultValue={filters.toolSlug ?? ""} placeholder="Any tool" options={tools.map((tool) => ({ value: tool.slug, label: tool.name }))} />
          </Field>
          <Field label="Sort by">
            <Select name="sort" defaultValue={sort} options={Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <Checkbox name="free" value="1" defaultChecked={filters.free === true} label="Free courses only" />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Searching…" iconStart={<Search aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />}>
            Show courses
          </SubmitButton>
          {active && (
            <LinkButton href={basePath} variant="ghost">
              Clear filters
            </LinkButton>
          )}
        </div>
      </form>

      <section aria-labelledby="catalogue-results" className="flex flex-col gap-4">
        <h2 id="catalogue-results" className="text-2xl font-bold">
          {total === 0 ? "No courses match" : `${total} ${total === 1 ? "course" : "courses"}${active ? " match" : ""}`}
        </h2>
        {items.length === 0 ? (
          <EmptyState
            headingLevel="h3"
            icon={<Icon icon={Search} size="xl" />}
            title="Nothing matches those filters"
            description="Try a different word, or clear a filter or two. New courses are added as tools change."
            action={<LinkButton href={basePath}>See every course</LinkButton>}
          />
        ) : (
          <CourseGrid courses={items} hrefFor={(slug) => `${basePath === "/courses" ? "/courses" : "/explore"}/${slug}`} audience={audience} headingLevel="h3" />
        )}
        <Pagination page={filters.page} pageCount={pageCount} hrefFor={(page) => `${basePath}${queryFor(filters, page)}`} label="Courses" />
      </section>
    </div>
  );
}
