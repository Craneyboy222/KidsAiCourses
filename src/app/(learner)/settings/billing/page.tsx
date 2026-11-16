import type { Metadata } from "next";
import { openPortalAction, startCardCheckAction } from "@/app/(parent)/parent/billing/actions";
import { BillingOverviewPanel, billingNoticeFrom } from "@/components/billing/billing-overview";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { tMany } from "@/server/copy";
import { requireAdultBillingPage } from "./_lib";

export const metadata: Metadata = { title: "Your plan", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Billing for an 18-year-old who owns their own account. Not found for every other learner: see `_lib.ts`. */
export default async function AdultBillingPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { ctx, overview } = await requireAdultBillingPage("/settings/billing");
  const copy = await tMany(ctx, ["billing.card_check.why", "billing.card_check.what", "billing.card_check.alternative", "billing.nothing_deleted"]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Your plan" description="Your plan, your next payment and your card." breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Your plan" }]} />} />
      <BillingOverviewPanel
        overview={overview}
        notice={billingNoticeFrom(params)}
        actions={{ openPortal: openPortalAction, startCardCheck: startCardCheckAction }}
        copy={{ cardWhy: copy["billing.card_check.why"], cardWhat: copy["billing.card_check.what"], cardAlternative: copy["billing.card_check.alternative"], nothingDeleted: copy["billing.nothing_deleted"] }}
      />
    </div>
  );
}
