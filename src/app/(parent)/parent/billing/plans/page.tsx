import type { Metadata } from "next";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { PlanChoicePanel } from "@/components/billing/plan-choice";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { tMany } from "@/server/copy";
import { getBillingOverview } from "@/server/services/billing";
import { startCheckoutAction } from "../actions";

export const metadata: Metadata = { title: "Choose a plan" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The plan choice. This is also where a parent lands after approving a child's "Ask a parent to
 * unlock" request for a paid course. Prices come from the plan data; parents and carers only.
 */
export default async function ParentPlansPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const ctx = await requireParentPage();
  const [overview, copy] = await Promise.all([getBillingOverview(ctx), tMany(ctx, ["billing.hosted_by_stripe", "billing.nothing_deleted"])]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Choose a plan"
        description="The Free plan stays free. A paid plan opens every course for your family."
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: "Billing", href: "/parent/billing" }, { label: "Choose a plan" }]} />}
      />
      <PlanChoicePanel overview={overview} cancelled={params.checkout === "cancelled"} startCheckout={startCheckoutAction} copy={{ hostedByStripe: copy["billing.hosted_by_stripe"], nothingDeleted: copy["billing.nothing_deleted"] }} />
    </div>
  );
}
