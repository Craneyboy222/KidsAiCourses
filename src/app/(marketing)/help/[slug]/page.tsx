import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AudienceBadge, HelpArticleList } from "@/components/marketing/help";
import { AskParentAboutPlans } from "@/components/marketing/plans";
import { ProsePage, PublicPage } from "@/components/marketing/prose-page";
import { Breadcrumbs, LinkButton, PageHeader } from "@/components/ui";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { metaDescription, publicPageMetadata } from "@/lib/marketing/metadata";
import { HELP_TOPICS } from "@/lib/marketing/page-file";
import { isUnder18Learner } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { listHelpArticles } from "@/server/services/pages";

type Params = Promise<{ slug: string }>;

const validSlug = (slug: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;

/** All articles, once per request: the article, its neighbours and its metadata come from the same list. */
const loadArticles = cache(async () => listHelpArticles(await getCtx()));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const article = validSlug(slug) ? (await loadArticles()).find((candidate) => candidate.slug === slug) : undefined;
  if (!article) return { title: "Help article not found", robots: { index: false, follow: false } };
  return publicPageMetadata({
    title: fillBrand(article.title),
    description: metaDescription(fillBrand(article.summary ?? article.title)),
    path: `/help/${article.slug}`,
    type: "article",
  });
}

/** One help article, with the other articles on the same topic underneath. */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const [ctx, articles] = await Promise.all([getCtx(), loadArticles()]);
  const article = articles.find((candidate) => candidate.slug === slug);
  if (!article) notFound();

  const breadcrumbs = <Breadcrumbs items={[{ label: "Help centre", href: "/help" }, { label: fillBrand(article.title) }]} />;

  // Plans and billing are for parents: a learner under 18 gets the "Ask a parent" note instead (spec 3.7).
  if (article.topic === "billing" && isUnder18Learner(ctx.actor)) {
    return (
      <PublicPage>
        <PageHeader title="This one is for parents and carers" breadcrumbs={breadcrumbs} />
        <AskParentAboutPlans />
      </PublicPage>
    );
  }

  const topic = HELP_TOPICS.find((candidate) => candidate.key === article.topic);
  const related = articles.filter((candidate) => candidate.topic === article.topic && candidate.slug !== article.slug && !(candidate.topic === "billing" && isUnder18Learner(ctx.actor))).slice(0, 4);

  return (
    <ProsePage
      title={article.title}
      description={article.summary}
      breadcrumbs={breadcrumbs}
      eyebrow={
        <>
          {topic && <span>{topic.label}</span>}
          <AudienceBadge audience={article.audience} />
        </>
      }
      body={article.body}
      after={
        <>
          {related.length > 0 && (
            <section aria-labelledby="help-related" className="border-line flex flex-col gap-4 border-t-2 pt-6">
              <h2 id="help-related" className="text-xl font-bold">
                More on this topic
              </h2>
              <HelpArticleList articles={related} headingLevel="h3" />
            </section>
          )}
          <div>
            <LinkButton href="/help" variant="secondary">
              Back to the help centre
            </LinkButton>
          </div>
        </>
      }
    />
  );
}
