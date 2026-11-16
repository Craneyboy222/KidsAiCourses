import type { Metadata } from "next";
import { BillingActionForm } from "@/components/billing/billing-forms";
import { Callout, Card, CardTitle, LinkButton, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatPence } from "@/lib/format";
import { describeFakeCheckout } from "@/server/stripe/fake-simulator";
import { completeFakeCheckoutAction } from "../actions";
import { requireFakeStripe } from "../guard";

export const metadata: Metadata = { title: "Stand-in payment page", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * The stand-in for Stripe Checkout, for local development and tests (`STRIPE_DRIVER=fake`). It
 * plays the part of a page on stripe.com: pressing the button makes the fake send the same signed
 * webhooks Stripe would. There is no card form, because no card is involved.
 * The amounts shown come from the plan data, as on Stripe's own page.
 */
export default async function FakeCheckoutPage({ searchParams }: { searchParams: Search }) {
  const sessionId = one((await searchParams).session);
  const { ctx, session } = await requireFakeStripe(sessionId);
  if (session.kind === "portal") return null;

  const banner = (
    <Callout tone="warning" title="This is a stand-in for Stripe">
      <p>You are on a local test page, not a real payment page. No card is asked for and no money moves.</p>
    </Callout>
  );

  if (session.kind === "setup") {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <PageHeader title="Check a card" description="Stand-in for Stripe's card check page." />
        {banner}
        <Card as="section" aria-labelledby="card-check">
          <CardTitle id="card-check">Card check, no charge</CardTitle>
          <p className="mt-3">Stripe would ask for a card here and confirm it with the bank without taking any money.</p>
          <div className="mt-5 flex flex-wrap items-start gap-3">
            <BillingActionForm action={completeFakeCheckoutAction} label="Pretend the card check passed" pendingText="Sending the result…" describedAs="Complete the card check" fields={{ session: sessionId }} />
            <LinkButton href={session.cancelPath} variant="secondary">
              Go back without checking
            </LinkButton>
          </div>
        </Card>
      </main>
    );
  }

  const summary = await describeFakeCheckout(session);
  const per = summary.interval === "year" ? "a year" : "a month";
  const trialEnds = summary.trialDays > 0 ? new Date(ctx.now.getTime() + summary.trialDays * 24 * 60 * 60 * 1000) : null;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <PageHeader title={`Subscribe to ${summary.planName}`} description="Stand-in for Stripe's payment page." />
      {banner}
      <Card as="section" aria-labelledby="order">
        <CardTitle id="order">Your order</CardTitle>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="font-bold">Plan</dt>
          <dd>
            {summary.planName}, {formatPence(summary.pricePence)} {per}
          </dd>
          {summary.discountNote && (
            <>
              <dt className="font-bold">Discount</dt>
              <dd>
                {summary.discountNote}: first payment {formatPence(summary.firstPaymentPence)}
              </dd>
            </>
          )}
          <dt className="font-bold">Due today</dt>
          <dd>{trialEnds ? `${formatPence(0)} (free trial until ${formatDate(trialEnds)})` : formatPence(summary.firstPaymentPence)}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap items-start gap-3">
          <BillingActionForm
            action={completeFakeCheckoutAction}
            label={trialEnds ? "Pretend to add a card and start the trial" : "Pretend to pay"}
            pendingText="Sending the result…"
            describedAs="Complete the payment"
            fields={{ session: sessionId }}
          />
          <LinkButton href={session.cancelPath} variant="secondary">
            Go back without paying
          </LinkButton>
        </div>
      </Card>
    </main>
  );
}
