import type { Metadata } from "next";
import { CatalogueView } from "@/components/course";
import { PageHeader } from "@/components/ui";
import { CATALOGUE_PAGE_SIZE, catalogueFacets, listCatalogue, parseCatalogueFilters } from "@/server/services/catalogue";
import { getToolsBySlugs } from "@/server/services/tools";
import { requireLearnerPage } from "../_lib/learner-page";
import { AccountOnHold } from "../_lib/paused";

export const metadata: Metadata = { title: "Explore" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The signed-in catalogue (spec 3.2). Search and filters are the same as the public one; what can
 * appear is the learner's own catalogue, so nothing above their age or blocked by a parent is ever
 * listed, whatever is typed into the address bar. Paid courses on the Free plan show as locked,
 * with "Ask a parent to unlock" and no price.
 */
export default async function ExplorePage({ searchParams }: { searchParams: Search }) {
  const page = await requireLearnerPage("/explore");
  if (!page.active) return <AccountOnHold title="Explore" />;
  const filters = parseCatalogueFilters(await searchParams);
  const viewer = { kind: "learner", learnerId: page.learnerId } as const;
  const { page: pageNumber, ...query } = filters;
  const [result, facets] = await Promise.all([
    listCatalogue(page.ctx, viewer, { ...query, limit: CATALOGUE_PAGE_SIZE, offset: (pageNumber - 1) * CATALOGUE_PAGE_SIZE }),
    catalogueFacets(page.ctx, viewer),
  ]);
  const toolRows = await getToolsBySlugs(page.ctx, facets.toolSlugs);
  const tools = facets.toolSlugs.map((slug) => ({ slug, name: toolRows.get(slug)?.name ?? slug }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Explore" description="Short projects you make in real tools. Pick one, go at your own pace, keep what you make." />
      <CatalogueView basePath="/explore" audience="learner" items={result.items} total={result.total} filters={filters} categories={facets.categories} tools={tools} />
    </div>
  );
}
