import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogueView } from "@/components/course";
import { PageHeader } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { getCtx } from "@/server/context";
import { CATALOGUE_PAGE_SIZE, catalogueFacets, listCatalogue, parseCatalogueFilters } from "@/server/services/catalogue";
import { getToolsBySlugs } from "@/server/services/tools";

export const metadata: Metadata = {
  title: "Courses",
  description: `Short, self-paced projects for 13 to 18-year-olds, made in real AI tools. Browse everything on ${BRAND_NAME}.`,
  openGraph: { title: `Courses · ${BRAND_NAME}`, description: "Short, self-paced projects for 13 to 18-year-olds, made in real AI tools.", type: "website" },
  alternates: { canonical: "/courses" },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The public catalogue (spec 3.2, Section 5). The same search and filters as the signed-in one,
 * with no prices: plans live on the pricing page. A signed-in learner is sent to their own
 * catalogue, so the public list can never show them a course above their age.
 *
 * No `<main>` here: the marketing layout (owned by the marketing slice) provides the page frame.
 */
export default async function PublicCoursesPage({ searchParams }: { searchParams: Search }) {
  const raw = await searchParams;
  const ctx = await getCtx();
  if (ctx.actor.type === "learner") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined) query.set(key, first);
    }
    const text = query.toString();
    redirect(text ? `/explore?${text}` : "/explore");
  }

  const filters = parseCatalogueFilters(raw);
  const { page, ...query } = filters;
  const viewer = { kind: "public" } as const;
  const [result, facets] = await Promise.all([
    listCatalogue(ctx, viewer, { ...query, limit: CATALOGUE_PAGE_SIZE, offset: (page - 1) * CATALOGUE_PAGE_SIZE }),
    catalogueFacets(ctx, viewer),
  ]);
  const toolRows = await getToolsBySlugs(ctx, facets.toolSlugs);
  const tools = facets.toolSlugs.map((slug) => ({ slug, name: toolRows.get(slug)?.name ?? slug }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader title="Courses" description="Every course is a short project: you make something real in a real tool, at your own pace, and keep it." />
      <CatalogueView basePath="/courses" audience="public" items={result.items} total={result.total} filters={filters} categories={facets.categories} tools={tools} />
    </div>
  );
}
