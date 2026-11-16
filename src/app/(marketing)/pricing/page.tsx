import type { Metadata } from "next";
import { AskParentAboutPlans, PlanCards } from "@/components/marketing/plans";
import { PublicPage } from "@/components/marketing/prose-page";
import { Callout, Markdown, PageHeader } from "@/components/ui";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { publicPageMetadata } from "@/lib/marketing/metadata";
import { getCtx } from "@/server/context";
import { getPricingView } from "@/server/services/marketing";
import { ClosingActions, loadMarketingPage } from "../_lib/pages";

export const metadata: Metadata = publicPageMetadata({
  title: "Pricing",
  description: "A free plan that stays free, and a family plan that opens every course. Every plan includes every parental control.",
  path: "/pricing",
});

/**
 * Plans and prices, from the plan data (spec 3.7, Section 11). Written for parents.
 *
 * A signed-in learner under 18 gets the "Ask a parent" page instead: `getPricingView` gives this
 * page no plans and no amounts for them, and the notes below the plans are not loaded either.
 */
export default async function PricingPage() {
  const ctx = await getCtx();
  const view = await getPricingView(ctx);

  if (view.kind === "ask_parent") {
    return (
      <PublicPage>
        <PageHeader title="Plans" description="This part is for parents and carers." />
        <AskParentAboutPlans />
      </PublicPage>
    );
  }

  const notes = await loadMarketingPage("pricing");
  return (
    <PublicPage wide>
      <PageHeader title="Pricing" description="Start free. Move to a family plan when you want every course. Every plan includes every parental control." />
      {view.plans.length > 0 ? (
        <PlanCards plans={view.plans} viewer={view.viewer} />
      ) : (
        <Callout tone="info" title="Plans are not on sale yet">
          <p>We will show the plans here before sign-up opens.</p>
        </Callout>
      )}
      {notes && <Markdown>{fillBrand(notes.body)}</Markdown>}
      <ClosingActions />
    </PublicPage>
  );
}
