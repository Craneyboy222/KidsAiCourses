import { Badge, Callout, Card, CardTitle, LinkButton, Stat, StatGroup } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { BillingOverview } from "@/server/services/billing";
import { BillingActionForm, type BillingAction } from "./billing-forms";

/**
 * The billing page's content: current plan, seats, next payment date, upgrade, manage, and the
 * card check for age assurance. A Server Component.
 *
 * WHO MAY SEE THIS. Only a parent, a carer or an 18-year-old who owns their own account. The
 * `overview` prop can only come from `getBillingOverview`, which refuses everyone else, so there
 * is no way to render this for a learner under 18. No price is written in this file: every amount
 * comes from the plan data on the next page.
 */
export type BillingNotice = "checkout_success" | "card_checked" | "card_cancelled" | null;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** What the address says the person has just come back from. It only chooses a message: it never changes a plan. */
export function billingNoticeFrom(params: Record<string, string | string[] | undefined>): BillingNotice {
  if (first(params.checkout) === "success") return "checkout_success";
  if (first(params.card) === "checked") return "card_checked";
  if (first(params.card) === "cancelled") return "card_cancelled";
  return null;
}

export type BillingOverviewPanelProps = {
  overview: BillingOverview;
  notice: BillingNotice;
  /** The Server Actions from `src/app/(parent)/parent/billing/actions.ts`. */
  actions: { openPortal: BillingAction; startCardCheck: BillingAction };
  /** Wording for the card check, from the copy service so that Studio can change it. */
  copy: { cardWhy: string; cardWhat: string; cardAlternative: string; nothingDeleted: string };
};

const STATUS_BADGE: Record<BillingOverview["status"], { label: string; tone: "neutral" | "success" | "warning" | "info" } | null> = {
  none: null,
  trialing: { label: "Free trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment overdue", tone: "warning" },
  cancelled: { label: "Ended", tone: "neutral" },
};

function nextPaymentLine(overview: BillingOverview): { value: string; detail?: string } {
  const sub = overview.subscription;
  if (!sub) return { value: "None", detail: "The Free plan costs nothing." };
  if (sub.comped) return { value: "None", detail: sub.endsAt ? `This plan was given to you at no charge until ${formatDate(sub.endsAt)}.` : "This plan was given to you at no charge." };
  if (sub.endsAt) return { value: "None", detail: `Your plan has been cancelled and ends on ${formatDate(sub.endsAt)}.` };
  if (sub.pastDue) return { value: "Overdue", detail: "We'll try your card again. You can update it under Manage plan." };
  if (sub.trialEndsAt && sub.nextPaymentAt) return { value: formatDate(sub.nextPaymentAt), detail: "Your first payment, when your free trial ends." };
  if (sub.nextPaymentAt) return { value: formatDate(sub.nextPaymentAt), detail: sub.interval === "year" ? "You're billed once a year." : "You're billed once a month." };
  return { value: "None" };
}

export function BillingOverviewPanel({ overview, notice, actions, copy }: BillingOverviewPanelProps) {
  const { account, subscription: sub, seats, ageAssurance } = overview;
  const badge = STATUS_BADGE[overview.status];
  const next = nextPaymentLine(overview);
  const adult = account.kind === "adult_learner";
  const cardDone = ageAssurance.level === "card_authorisation" || ageAssurance.level === "paid_subscription";

  return (
    <div className="flex flex-col gap-6">
      {notice === "checkout_success" && (
        <Callout tone="success" title="Thank you. That's all done." live="status">
          <p>{overview.plan.key === "free" ? "Your plan will show here in a moment, as soon as Stripe confirms it. Refresh this page if it hasn't changed." : `You're on the ${overview.plan.name} plan.`}</p>
        </Callout>
      )}
      {notice === "card_checked" && (
        <Callout tone="success" title={cardDone ? "Your card has been checked" : "Thanks. We're just confirming your card."} live="status">
          <p>{cardDone ? "Nothing was charged." : "This usually takes a few seconds. Refresh this page to see the result. Nothing has been charged."}</p>
        </Callout>
      )}
      {notice === "card_cancelled" && (
        <Callout tone="info" title="The card check wasn't finished" live="status">
          <p>Nothing was charged and nothing has changed. You can do it whenever you&apos;re ready.</p>
        </Callout>
      )}

      {sub?.pastDue && (
        <Callout
          tone="warning"
          title={sub.pastDue.inGrace ? "Your last payment didn't go through" : "Your plan is on hold because a payment didn't go through"}
          actions={<BillingActionForm action={actions.openPortal} label="Update your card" variant="secondary" describedAs="Update your card" />}
        >
          <p>
            {sub.pastDue.inGrace
              ? `Nothing changes until ${formatDate(sub.pastDue.graceEndsAt)}. Update your card before then to keep your plan.`
              : "Your family is on the Free plan for now. Update your card and your plan comes straight back."}{" "}
            {copy.nothingDeleted}
          </p>
        </Callout>
      )}

      <Card as="section" aria-labelledby="current-plan">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle id="current-plan">Your plan: {overview.plan.name}</CardTitle>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          {sub?.isFounding && <Badge tone="accent">Founding family</Badge>}
        </div>
        <StatGroup className="mt-4">
          <Stat
            label={adult ? "Places" : "Learner places"}
            value={`${seats.used} of ${seats.total}`}
            detail={seats.extra > 0 ? `In use. Includes ${seats.extra} extra ${seats.extra === 1 ? "place" : "places"}.` : "In use."}
          />
          <Stat label="Next payment" value={next.value} detail={next.detail} />
        </StatGroup>
        {sub?.isFounding && sub.foundingLockedUntil && <p className="text-ink-muted mt-4">Your founding-family rate is held until {formatDate(sub.foundingLockedUntil)}.</p>}
        <div className="mt-5 flex flex-wrap items-start gap-3">
          {overview.canChoosePlan && overview.offers.length > 0 && <LinkButton href={account.plansPath}>See the {overview.offers[0]?.name ?? "paid"} plan</LinkButton>}
          {overview.canManage && (
            <BillingActionForm action={actions.openPortal} label={sub && !sub.comped ? "Manage plan, card and invoices" : "Manage card and invoices"} variant="secondary" describedAs="Manage your plan" />
          )}
        </div>
        {overview.canManage && (
          <p className="text-ink-muted mt-4 max-w-measure">
            Changing or cancelling your plan, updating your card and downloading invoices all happen on a secure page run by Stripe. If you cancel, your plan carries on until the end of the time you&apos;ve
            already paid for. {copy.nothingDeleted}
          </p>
        )}
      </Card>

      {!adult && (ageAssurance.needed || cardDone) && (
        <Card as="section" aria-labelledby="card-check">
          <CardTitle id="card-check">Card check for Coach</CardTitle>
          {cardDone ? (
            <p className="mt-3">
              Done{ageAssurance.checkedAt ? ` on ${formatDate(ageAssurance.checkedAt)}` : ""}. An adult&apos;s card has been checked for this family, so there is nothing more to do here.
            </p>
          ) : (
            <div className="mt-3 flex max-w-measure flex-col gap-3">
              <p>
                <strong>{ageAssurance.waitingFor.join(" and ")}</strong> can&apos;t use Coach, the AI helper inside courses, until an adult has done a quick card check. Everything else already works.
              </p>
              <h3 className="text-lg font-bold">Why we ask</h3>
              <p>{copy.cardWhy}</p>
              <h3 className="text-lg font-bold">What happens</h3>
              <p>{copy.cardWhat}</p>
              <p>{copy.cardAlternative}</p>
              <BillingActionForm action={actions.startCardCheck} label="Check my card (no charge)" describedAs="Check my card" />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
