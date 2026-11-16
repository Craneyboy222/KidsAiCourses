import type { Metadata } from "next";
import { HelpArticleList, HelpSearchForm, helpHref } from "@/components/marketing/help";
import { PublicPage } from "@/components/marketing/prose-page";
import { Callout, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { groupByTopic, parseQuery, parseReader, queryTerms, searchHelp, type HelpReader } from "@/lib/marketing/help-search";
import { publicPageMetadata } from "@/lib/marketing/metadata";
import { isUnder18Learner } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { listHelpArticles } from "@/server/services/pages";
import { getSetting } from "@/server/settings";

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const params = await searchParams;
  const filtered = parseQuery(params.q) !== "" || params.for !== undefined;
  return publicPageMetadata({
    title: "Help centre",
    description: `Short answers for teenagers and parents: accounts, invite codes, consent, tools and approvals, Coach, time limits, handing in work, certificates, your data and billing on ${BRAND_NAME}.`,
    path: "/help",
    // One address for the help centre in search engines: search results and filters are not listed.
    index: !filtered,
  });
}

/**
 * The help centre: every article, grouped by topic, with a search box and a filter for who is
 * reading. Search is a plain GET form, so it works without JavaScript; nothing typed into it is stored.
 */
export default async function HelpPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const ctx = await getCtx();
  const query = parseQuery(params.q);
  const under18 = isUnder18Learner(ctx.actor);
  // Signed-in readers start on their own articles; the filter links let anyone change that.
  const defaultReader: HelpReader | null = params.for !== undefined ? null : under18 ? "teen" : ctx.actor.type === "parent" ? "parent" : null;
  const reader = parseReader(params.for) ?? defaultReader;

  const [all, supportEmail] = await Promise.all([listHelpArticles(ctx), getSetting(ctx, "site.support_email")]);
  // A learner under 18 is not offered the articles about plans and billing (spec 3.7).
  const offered = under18 ? all.filter((article) => article.topic !== "billing") : all;
  const results = searchHelp(offered, { query, reader });
  const searching = queryTerms(query).length > 0;

  return (
    <PublicPage wide>
      <PageHeader title="Help centre" description="Short answers about how everything works, for teenagers and for parents and carers." />
      <HelpSearchForm query={query} reader={reader} />

      <Callout tone="danger" title="If you or someone else is in danger right now, call 999">
        <p>You can also talk to Childline free on 0800 1111, call Samaritans on 116 123 or text SHOUT to 85258, at any time.</p>
      </Callout>

      {searching ? (
        <section aria-labelledby="help-results" className="flex flex-col gap-4">
          <h2 id="help-results" className="text-2xl font-bold">
            Search results
          </h2>
          <p role="status">
            {results.length === 0 ? `No articles match “${query}”.` : `${results.length} ${results.length === 1 ? "article matches" : "articles match"} “${query}”.`}
          </p>
          {results.length > 0 ? (
            <HelpArticleList articles={results} headingLevel="h3" />
          ) : (
            <EmptyState
              title="Nothing found"
              description="Try fewer or different words, for example “password”, “invite code” or “certificate”."
              action={
                <LinkButton href={helpHref({ reader, everyone: true })} variant="secondary">
                  Show every article
                </LinkButton>
              }
              headingLevel="h3"
            />
          )}
        </section>
      ) : results.length === 0 ? (
        <EmptyState title="No help articles yet" description="We are still writing these. Please check back soon." />
      ) : (
        groupByTopic(results).map((group) => (
          <section key={group.key} aria-labelledby={`help-topic-${group.key}`} className="flex flex-col gap-4">
            <h2 id={`help-topic-${group.key}`} className="text-2xl font-bold">
              {group.label}
            </h2>
            <HelpArticleList articles={group.articles} headingLevel="h3" />
          </section>
        ))
      )}

      <section aria-labelledby="help-contact" className="border-line flex flex-col gap-2 border-t-2 pt-6">
        <h2 id="help-contact" className="text-xl font-bold">
          Still stuck?
        </h2>
        {supportEmail ? (
          <p>
            Parents and carers can email us at{" "}
            <a href={`mailto:${supportEmail}`} className="link">
              {supportEmail}
            </a>
            . Learners: use the Report control on any step, and a person on our team will read it.
          </p>
        ) : (
          <p>Use the Report control on any step, course or Coach reply, and a person on our team will read it. We will add a contact address for parents here before sign-up opens.</p>
        )}
      </section>
    </PublicPage>
  );
}
