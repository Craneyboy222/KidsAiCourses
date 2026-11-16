import { Check, Lock } from "lucide-react";
import { Badge, Callout, Card, LinkButton } from "@/components/ui";
import { formatPence, pluralise } from "@/lib/format";
import type { PricedPlan, PricingView } from "@/server/services/marketing";

type Viewer = Extract<PricingView, { kind: "plans" }>["viewer"];

const isFree = (plan: PricedPlan): boolean => plan.pricing.monthlyPence === 0 && plan.pricing.annualPence === 0;
const seatsLine = (plan: PricedPlan): string => `Up to ${pluralise(plan.seats, "learner")}`;

function action(plan: PricedPlan, viewer: Viewer): { href: string; label: string } | null {
  switch (viewer) {
    case "visitor":
      return { href: "/signup/parent", label: isFree(plan) ? "Start on Free" : "Get started" };
    case "parent":
      return { href: "/parent/billing/plans", label: "Choose a plan" };
    case "adult_learner":
      return { href: "/settings/billing/plans", label: "Choose a plan" };
    case "staff":
      return null;
  }
}

/**
 * The plans on sale, with prices. Parents, carers, adult learners and visitors only: the pricing
 * page never renders this for a learner under 18 (it has no priced plans to pass in). Every
 * figure comes from the plan data; none is written here.
 */
export function PlanCards({ plans, viewer }: { plans: PricedPlan[]; viewer: Viewer }) {
  const placeholder = plans.some((plan) => plan.pricing.placeholder);
  return (
    <div className="flex flex-col gap-6">
      {placeholder && (
        <Callout tone="warning" title="These prices are not final">
          <p>The prices below have not been confirmed yet. The price shown at checkout is the price you pay.</p>
        </Callout>
      )}
      <ul className="grid gap-5 md:grid-cols-2">
        {plans.map((plan) => {
          const { pricing } = plan;
          const cta = action(plan, viewer);
          return (
            <Card as="li" key={plan.key} variant={plan.fullCatalogue ? "raised" : "outline"} padding="lg" className="flex flex-col gap-4" data-testid={`plan-${plan.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-bold">{plan.name}</h2>
                {plan.fullCatalogue && <Badge tone="accent">Every course</Badge>}
              </div>
              {plan.description && <p className="text-ink-muted">{plan.description}</p>}

              {isFree(plan) ? (
                <p>
                  <span className="text-4xl font-bold">{formatPence(0)}</span> <span className="text-ink-muted">and it stays free</span>
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p>
                    <span className="text-4xl font-bold">{formatPence(pricing.monthlyPence)}</span> <span className="text-ink-muted">a month</span>
                  </p>
                  {pricing.annualPence > 0 && (
                    <p className="text-ink-muted">
                      or <strong className="text-ink">{formatPence(pricing.annualPence)}</strong> a year
                    </p>
                  )}
                </div>
              )}

              {pricing.founding && (pricing.founding.monthlyPence !== null || pricing.founding.annualPence !== null) && (
                <Callout tone="info" title="Founding families">
                  <p>
                    {[
                      pricing.founding.monthlyPence !== null ? `${formatPence(pricing.founding.monthlyPence)} a month` : null,
                      pricing.founding.annualPence !== null ? `${formatPence(pricing.founding.annualPence)} a year` : null,
                    ]
                      .filter((part) => part !== null)
                      .join(" or ")}
                    {pricing.founding.lockMonths ? `, held at that price for ${pluralise(pricing.founding.lockMonths, "month")}.` : "."}
                  </p>
                </Callout>
              )}

              <ul className="flex flex-col gap-2">
                {/* The plan's own highlights usually say how many learners; say it here only if they do not. */}
                {!plan.highlights.some((highlight) => highlight.toLowerCase().startsWith(seatsLine(plan).toLowerCase())) && <PlanPoint>{seatsLine(plan)}</PlanPoint>}
                {pricing.extraSeatMonthlyPence !== null && pricing.extraSeatMonthlyPence > 0 && <PlanPoint>{`Extra places at ${formatPence(pricing.extraSeatMonthlyPence)} a month each`}</PlanPoint>}
                {pricing.trialDays > 0 && <PlanPoint>{`${pricing.trialDays}-day free trial. A card is needed to start it, and a family can have one trial.`}</PlanPoint>}
                {plan.highlights.map((highlight) => (
                  <PlanPoint key={highlight}>{highlight}</PlanPoint>
                ))}
              </ul>

              {cta && (
                <div className="mt-auto pt-2">
                  <LinkButton href={cta.href} variant={plan.fullCatalogue ? "primary" : "secondary"}>
                    {cta.label}
                  </LinkButton>
                </div>
              )}
            </Card>
          );
        })}
      </ul>
    </div>
  );
}

function PlanPoint({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check aria-hidden="true" className="text-success mt-1 size-5 shrink-0" strokeWidth={2.5} />
      <span>{children}</span>
    </li>
  );
}

/**
 * What a learner under 18 sees instead of the pricing page (spec 3.7). It takes no props on
 * purpose: there is no way to hand it a plan or an amount.
 */
export function AskParentAboutPlans() {
  return (
    <Card as="section" variant="raised" padding="lg" className="flex flex-col gap-4" data-testid="ask-parent-about-plans">
      <div className="flex items-start gap-3">
        <span className="border-ink bg-accent text-on-accent flex size-10 shrink-0 items-center justify-center rounded-full border-2">
          <Lock aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-xl font-bold">Plans are looked after by your parent or carer</h2>
          <p>There is nothing you need to do here. Which courses you can open depends on your family&apos;s plan, and that is their side of things.</p>
          <p>
            If a course you want shows a padlock, open it and press <strong>Ask a parent to unlock</strong>. We send them the request and tell you what they say.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/explore">Explore courses</LinkButton>
        <LinkButton href="/help/locked-courses" variant="secondary">
          How unlocking works
        </LinkButton>
      </div>
    </Card>
  );
}
