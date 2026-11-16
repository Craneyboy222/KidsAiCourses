import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProsePage } from "@/components/marketing/prose-page";
import { Breadcrumbs, Callout, LinkButton } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { metaDescription, publicPageMetadata } from "@/lib/marketing/metadata";
import { countToConfirm, stripDraftBannerLine } from "@/lib/marketing/page-file";
import { LEGAL_DRAFT_BANNER, LEGAL_PAGES } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { getLegalPage } from "@/server/services/pages";

type Params = Promise<{ slug: string }>;

const loadLegalPage = cache(async (slug: string) => getLegalPage(await getCtx(), slug));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadLegalPage(slug);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };
  const known = LEGAL_PAGES.find((page) => page.slug === slug);
  if (found.state === "unpublished") return { title: known?.title ?? "Legal", robots: { index: false, follow: false } };
  return publicPageMetadata({
    title: fillBrand(found.page.title),
    description: metaDescription(fillBrand(found.page.summary ?? found.page.title)),
    path: `/legal/${slug}`,
    type: "article",
    // A draft is shown only so that it can be read and checked. It is never listed by a search engine.
    index: !found.draft,
  });
}

/**
 * One of the six legal pages (decision D16). Only a published `page` row is ever shown:
 * - nothing published: the address says so plainly (the launch-readiness gate keeps sign-up shut);
 * - published but still a draft (possible in local development only): the text is shown under a
 *   "Draft — not yet reviewed by a lawyer" notice and is not indexed;
 * - published, reviewed text: shown as it is.
 */
export default async function LegalPage({ params }: { params: Params }) {
  const { slug } = await params;
  const found = await loadLegalPage(slug);
  if (!found) notFound();
  const known = LEGAL_PAGES.find((page) => page.slug === slug);
  const breadcrumbs = <Breadcrumbs items={[{ label: "Legal" }, { label: known?.label ?? slug }]} />;

  if (found.state === "unpublished") {
    return (
      <ProsePage
        title={known?.title ?? "Legal"}
        breadcrumbs={breadcrumbs}
        body=""
        before={
          <Callout tone="warning" title="This page has not been published yet" className="max-w-measure">
            <p>We are finishing this policy and having it reviewed. Sign-up stays closed until it, and our other policies, are published.</p>
            <p>
              In the meantime, the{" "}
              <Link href="/safety" className="link">
                Safety page
              </Link>{" "}
              explains how the service works.
            </p>
          </Callout>
        }
        after={
          <div>
            <LinkButton href="/" variant="secondary">
              Back to the home page
            </LinkButton>
          </div>
        }
      />
    );
  }

  const { page, draft } = found;
  // Counted without the banner line, which mentions the marker itself.
  const open = countToConfirm(stripDraftBannerLine(page.body));
  return (
    <ProsePage
      title={page.title}
      description={page.summary}
      breadcrumbs={breadcrumbs}
      eyebrow={!draft && page.updatedAt ? <span>Last updated {formatDate(page.updatedAt)}</span> : undefined}
      body={draft ? stripDraftBannerLine(page.body) : page.body}
      before={
        draft ? (
          <Callout tone="warning" title={LEGAL_DRAFT_BANNER} className="max-w-measure">
            <p>This text is a working draft. It describes how the product is built, and it must not be relied on.</p>
            {open > 0 && (
              <p>
                {open} {open === 1 ? "point is" : "points are"} marked “⚖️ TO CONFIRM”: {open === 1 ? "a decision" : "decisions"} that a lawyer or the owner still has to make.
              </p>
            )}
          </Callout>
        ) : undefined
      }
    />
  );
}
