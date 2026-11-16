import type { Metadata } from "next";
import { cache } from "react";
import { ProsePage } from "@/components/marketing/prose-page";
import { LinkButton } from "@/components/ui";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { metaDescription, publicPageMetadata } from "@/lib/marketing/metadata";
import { homeLinkFor } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { getSitePage, type SitePage } from "@/server/services/pages";

/** One marketing page's text, read once per request (the page and its metadata both need it). */
export const loadMarketingPage = cache(async (slug: string): Promise<SitePage | null> => getSitePage(await getCtx(), "marketing", slug));

export type MarketingPageDefaults = {
  slug: string;
  path: string;
  /** Used when the page's text cannot be loaded, so the address still has a heading. */
  title: string;
  description: string;
};

export async function marketingPageMetadata(defaults: MarketingPageDefaults): Promise<Metadata> {
  const page = await loadMarketingPage(defaults.slug);
  return publicPageMetadata({
    title: fillBrand(page?.title ?? defaults.title),
    description: metaDescription(fillBrand(page?.summary ?? defaults.description)),
    path: defaults.path,
  });
}

/** The closing calls to action of a public page: sign-up for a visitor, their own home for someone signed in. */
export async function ClosingActions() {
  const ctx = await getCtx();
  const home = homeLinkFor(ctx.actor);
  return (
    <div className="border-line flex flex-wrap gap-3 border-t-2 pt-6">
      {home ? (
        <LinkButton href={home.href}>{home.label}</LinkButton>
      ) : (
        <>
          <LinkButton href="/signup/parent">Parents: get started</LinkButton>
          <LinkButton href="/courses" variant="secondary">
            Browse the courses
          </LinkButton>
        </>
      )}
      <LinkButton href="/help" variant="ghost">
        Help centre
      </LinkButton>
    </div>
  );
}

/** A whole marketing text page: heading, summary, text, closing actions. */
export async function MarketingTextPage({ defaults }: { defaults: MarketingPageDefaults }) {
  const page = await loadMarketingPage(defaults.slug);
  return <ProsePage title={page?.title ?? defaults.title} description={page?.summary ?? defaults.description} body={page?.body ?? null} after={<ClosingActions />} />;
}
