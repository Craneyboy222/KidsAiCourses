import { Callout, Card, CardTitle, LinkButton } from "@/components/ui";
import type { RadioOption } from "@/components/ui";
import { formatPence } from "@/lib/format";
import type { BillingOverview, PlanOffer, PlanOption } from "@/server/services/billing";
import { PlanChoiceForm, type BillingAction } from "./billing-forms";

/**
 * The plan choice (spec Section 4: "chooses Free or a Family trial"). A Server Component.
 *
 * Every amount on this page is read from the `plan` table through `getBillingOverview`; there is
 * no price in this file or anywhere else in the code. Like the overview panel, it can only be
 * given data by a function that refuses every learner under 18.
 */
const perInterval = (interval: PlanOption["interval"]) => (interval === "year" ? "a year" : "a month");

function optionFor(offer: PlanOffer, option: PlanOption): RadioOption {
  const amount = `${formatPence(option.pricePence)} ${perInterval(option.interval)}`;
  const notes: string[] = [];
  if (option.founding) {
    notes.push(`Founding-family rate${option.lockMonths ? `, held for ${option.lockMonths} months` : ""}. The usual rate is ${formatPence(option.standardPricePence)} ${perInterval(option.interval)}.`);
  }
  if (option.interval === "year") {
    const monthly = offer.options.find((o) => o.interval === "month");
    const saving = monthly ? monthly.pricePence * 12 - option.pricePence : 0;
    if (saving > 0) notes.push(`${formatPence(saving)} less over a year than paying monthly.`);
  }
  if (option.interval === "month") notes.push("Cancel at any time.");
  return { value: option.interval, label: `${option.interval === "year" ? "Yearly" : "Monthly"}: ${amount}`, description: notes.join(" ") };
}

export type PlanChoicePanelProps = {
  overview: BillingOverview;
  cancelled: boolean;
  /** `startCheckoutAction` from `src/app/(parent)/parent/billing/actions.ts`. */
  startCheckout: BillingAction;
  copy: { hostedByStripe: string; nothingDeleted: string };
};

export function PlanChoicePanel({ overview, cancelled, startCheckout, copy }: PlanChoicePanelProps) {
  const { account } = overview;
  if (!overview.canChoosePlan) {
    return (
      <Callout tone="info" title={`You're already on the ${overview.plan.name} plan`} actions={<LinkButton href={account.homePath}>Back to Billing</LinkButton>}>
        <p>To change how you&apos;re billed, add places or cancel, use Manage plan on your Billing page.</p>
      </Callout>
    );
  }
  if (overview.offers.length === 0) {
    return (
      <Callout tone="info" title="Paid plans aren't on sale just yet" actions={<LinkButton href={account.homePath}>Back to Billing</LinkButton>}>
        <p>You&apos;re on the Free plan, and everything in it carries on working. Please check back soon.</p>
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {cancelled && (
        <Callout tone="info" title="You left before finishing" live="status">
          <p>Nothing was charged and your plan hasn&apos;t changed.</p>
        </Callout>
      )}
      {overview.offers.map((offer) => (
        <Card as="section" key={offer.planKey} aria-labelledby={`plan-${offer.planKey}`} variant="raised">
          <CardTitle id={`plan-${offer.planKey}`}>{offer.name}</CardTitle>
          {offer.description && <p className="mt-2 max-w-measure">{offer.description}</p>}
          {offer.highlights.length > 0 && (
            <ul className="mt-3 list-disc pl-6">
              {offer.highlights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {account.kind === "adult_learner" && <p className="text-ink-muted mt-3">On your own account this plan covers one person: you.</p>}
          {offer.extraSeatMonthlyPence !== null && offer.extraSeatMonthlyPence > 0 && account.kind === "parent" && (
            <p className="text-ink-muted mt-3">
              Need more than {offer.seats} places? Extra places are {formatPence(offer.extraSeatMonthlyPence)} a month each. You can add them from Manage plan once your plan has started.
            </p>
          )}
          {offer.trialDays > 0 && (
            <Callout tone="info" title={`${offer.trialDays} days free to start`} className="mt-4">
              <p>
                You add a card now and nothing is taken for {offer.trialDays} days. If you cancel before the trial ends you won&apos;t be charged, and your family stays on the Free plan. We&apos;ll remind you
                a few days before it ends.
              </p>
            </Callout>
          )}
          <div className="mt-5">
            <PlanChoiceForm
              action={startCheckout}
              planKey={offer.planKey}
              options={offer.options.map((option) => optionFor(offer, option))}
              defaultInterval={offer.options[0]?.interval ?? "month"}
              submitLabel={offer.trialDays > 0 ? "Start free trial on Stripe" : "Continue to Stripe"}
            />
          </div>
          <p className="text-ink-muted mt-4 max-w-measure">
            {copy.hostedByStripe} {copy.nothingDeleted}
          </p>
        </Card>
      ))}
    </div>
  );
}
