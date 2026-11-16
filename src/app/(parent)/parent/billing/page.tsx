import type { Metadata } from "next";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { BillingOverviewPanel, billingNoticeFrom } from "@/components/billing/billing-overview";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { tMany } from "@/server/copy";
import { getBillingOverview } from "@/server/services/billing";
import { openPortalAction, startCardCheckAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Parent billing (spec Section 5): current plan, seats, next payment date, upgrade, manage and
 * invoices through the Stripe portal, and the card check for age assurance with a plain
 * explanation of why it is asked. Parents and carers only: `requireParentPage` sends everyone
 * else away, and `getBillingOverview` refuses them again.
 */
export default async function ParentBillingPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const ctx = await requireParentPage();
  const [overview, copy] = await Promise.all([getBillingOverview(ctx), tMany(ctx, ["billing.card_check.why", "billing.card_check.what", "billing.card_check.alternative", "billing.nothing_deleted"])]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Your plan, your next payment and your card. Your children never see this page, or any prices."
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: "Billing" }]} />}
      />
      <BillingOverviewPanel
        overview={overview}
        notice={billingNoticeFrom(params)}
        actions={{ openPortal: openPortalAction, startCardCheck: startCardCheckAction }}
        copy={{ cardWhy: copy["billing.card_check.why"], cardWhat: copy["billing.card_check.what"], cardAlternative: copy["billing.card_check.alternative"], nothingDeleted: copy["billing.nothing_deleted"] }}
      />
    </div>
  );
}
