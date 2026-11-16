import type { Metadata } from "next";
import { BillingActionForm } from "@/components/billing/billing-forms";
import { Callout, Card, CardTitle, LinkButton, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatPence } from "@/lib/format";
import { findFakeSubscriptionForCustomer, loadFakeSubscription, type FakePortalAction } from "@/server/stripe/fake-simulator";
import { fakePortalAction } from "../actions";
import { requireFakeStripe } from "../guard";

export const metadata: Metadata = { title: "Stand-in customer portal", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

type PortalButton = { change: FakePortalAction; label: string; when: (s: { status: string; cancelAtPeriodEnd: boolean; extraSeats: number }) => boolean };

/** What a customer could do in Stripe's portal, followed by things only time or a bank would do, for trying each path locally. */
const CUSTOMER: PortalButton[] = [
  { change: "cancel_at_period_end", label: "Cancel plan at the end of the period", when: (s) => !s.cancelAtPeriodEnd },
  { change: "resume", label: "Keep my plan after all", when: (s) => s.cancelAtPeriodEnd },
  { change: "add_seat", label: "Add an extra place", when: () => true },
  { change: "remove_seat", label: "Remove an extra place", when: (s) => s.extraSeats > 0 },
];
const SIMULATE: PortalButton[] = [
  { change: "trial_will_end", label: "Send the \"trial ends soon\" reminder", when: (s) => s.status === "trialing" },
  { change: "period_end", label: "Jump to the end of the period (renew, or end a cancelled plan)", when: () => true },
  { change: "payment_failed", label: "A payment fails", when: (s) => s.status !== "past_due" },
  { change: "payment_recovered", label: "The overdue payment goes through", when: (s) => s.status === "past_due" },
  { change: "refund", label: "Refund the last payment", when: () => true },
  { change: "cancel_now", label: "End the plan now", when: () => true },
];

/**
 * The stand-in for the Stripe Customer Portal (`STRIPE_DRIVER=fake`). Every button makes the fake
 * send signed webhooks; what you then see on the Billing page is the webhook handler's work.
 */
export default async function FakePortalPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const sessionId = one(params.session);
  const { session } = await requireFakeStripe(sessionId);
  if (session.kind !== "portal") return null;

  const subscriptionId = await findFakeSubscriptionForCustomer(session.customerId);
  const current = subscriptionId ? await loadFakeSubscription(subscriptionId) : null;
  const state = current?.state;
  const buttons = (list: PortalButton[]) =>
    state &&
    list
      .filter((button) => button.when(state))
      .map((button) => (
        <li key={button.change}>
          <BillingActionForm action={fakePortalAction} label={button.label} pendingText="Sending the result…" variant="secondary" describedAs={button.label} fields={{ session: sessionId, change: button.change }} />
        </li>
      ));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <PageHeader title="Manage your plan" description="Stand-in for Stripe's customer portal." actions={<LinkButton href={session.returnPath}>Back to Billing</LinkButton>} />
      <Callout tone="warning" title="This is a stand-in for Stripe">
        <p>You are on a local test page. No card is involved and no money moves. Invoices live in the real portal only.</p>
      </Callout>
      {one(params.done) && (
        <Callout tone="success" title="Done" live="status">
          <p>The webhooks for that change have been delivered. Go back to Billing to see the result.</p>
        </Callout>
      )}
      {!state || !current ? (
        <Callout tone="info" title="No running plan">
          <p>There is nothing to manage. Choose a plan from the Billing page first.</p>
        </Callout>
      ) : (
        <>
          <Card as="section" aria-labelledby="portal-plan">
            <CardTitle id="portal-plan">Current plan</CardTitle>
            <p className="mt-3">
              {formatPence(current.pricePence)} {current.interval === "year" ? "a year" : "a month"}. Status: {state.status}
              {state.cancelAtPeriodEnd ? ", set to end" : ""}. Current period ends {formatDate(state.periodEnd)}. Extra places: {state.extraSeats}.
            </p>
            <ul className="mt-4 flex flex-col gap-3">{buttons(CUSTOMER)}</ul>
          </Card>
          <Card as="section" aria-labelledby="portal-simulate">
            <CardTitle id="portal-simulate">Make something happen</CardTitle>
            <p className="mt-3">Things a real customer cannot press, for trying each path locally.</p>
            <ul className="mt-4 flex flex-col gap-3">{buttons(SIMULATE)}</ul>
          </Card>
        </>
      )}
    </main>
  );
}
