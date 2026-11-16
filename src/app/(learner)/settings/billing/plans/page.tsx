import type { Metadata } from "next";
import { startCheckoutAction } from "@/app/(parent)/parent/billing/actions";
import { PlanChoicePanel } from "@/components/billing/plan-choice";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { tMany } from "@/server/copy";
import { requireAdultBillingPage } from "../_lib";

export const metadata: Metadata = { title: "Choose a plan", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** The plan choice for an 18-year-old who owns their own account. Not found for every other learner. */
export default async function AdultPlansPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { ctx, overview } = await requireAdultBillingPage("/settings/billing/plans");
  const copy = await tMany(ctx, ["billing.hosted_by_stripe", "billing.nothing_deleted"]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Choose a plan"
        description="The Free plan stays free. A paid plan opens every course."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Your plan", href: "/settings/billing" }, { label: "Choose a plan" }]} />}
      />
      <PlanChoicePanel overview={overview} cancelled={params.checkout === "cancelled"} startCheckout={startCheckoutAction} copy={{ hostedByStripe: copy["billing.hosted_by_stripe"], nothingDeleted: copy["billing.nothing_deleted"] }} />
    </div>
  );
}
