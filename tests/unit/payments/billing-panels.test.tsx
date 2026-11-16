import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BillingOverviewPanel, billingNoticeFrom } from "@/components/billing/billing-overview";
import { PlanChoicePanel } from "@/components/billing/plan-choice";
import type { BillingOverview, PlanOffer } from "@/server/services/billing";
import { axeViolations } from "../ui/axe-helper";

/**
 * The two billing panels, rendered from data. The amounts used here are deliberately odd ones
 * that appear nowhere else, to show that what is on screen is whatever the plan data says.
 */
const action = async () => null;
const copy = { cardWhy: "WHY-COPY", cardWhat: "WHAT-COPY", cardAlternative: "ALT-COPY", nothingDeleted: "KEPT-COPY", hostedByStripe: "STRIPE-COPY" };

const offer: PlanOffer = {
  planKey: "family",
  name: "Family",
  description: "Every course.",
  highlights: ["Up to 4 learners"],
  seats: 4,
  trialDays: 7,
  options: [
    { interval: "month", pricePence: 1234, founding: true, standardPricePence: 1777, lockMonths: 12 },
    { interval: "year", pricePence: 9876, founding: false, standardPricePence: 9876, lockMonths: null },
  ],
  extraSeatMonthlyPence: 321,
  pricesArePlaceholders: true,
};

const base: BillingOverview = {
  account: { familyId: "f", userId: "u", kind: "parent", homePath: "/parent/billing", plansPath: "/parent/billing/plans" },
  plan: { key: "free", name: "Free" },
  status: "none",
  seats: { used: 1, total: 2, extra: 0 },
  subscription: null,
  canManage: false,
  canChoosePlan: true,
  offers: [offer],
  ageAssurance: { level: "none", checkedAt: null, needed: true, waitingFor: ["Maya"] },
};
const actions = { openPortal: action, startCardCheck: action };

describe("BillingOverviewPanel", () => {
  it("on Free: the plan, places in use, no payment due, an upgrade link, and the card check with its explanation", async () => {
    const { container } = render(<BillingOverviewPanel overview={base} notice={null} actions={actions} copy={copy} />);
    expect(screen.getByRole("heading", { name: "Your plan: Free" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("The Free plan costs nothing.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the Family plan" })).toHaveAttribute("href", "/parent/billing/plans");
    expect(screen.queryByRole("button", { name: /Manage/ })).not.toBeInTheDocument();

    const card = screen.getByRole("region", { name: "Card check for Coach" });
    expect(within(card).getByText("Maya")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Why we ask" })).toBeInTheDocument();
    expect(within(card).getByText("WHY-COPY")).toBeInTheDocument();
    expect(within(card).getByText("WHAT-COPY")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Check my card (no charge)" })).toBeInTheDocument();
    // No price on the overview at all: prices live on the plan choice.
    expect(container.textContent).not.toMatch(/£/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("on a trial: next payment date, the founding rate's end date, and Manage for the Stripe portal", () => {
    const overview: BillingOverview = {
      ...base,
      plan: { key: "family", name: "Family" },
      status: "trialing",
      seats: { used: 3, total: 5, extra: 1 },
      canManage: true,
      canChoosePlan: false,
      offers: [],
      ageAssurance: { level: "card_authorisation", checkedAt: new Date("2026-11-16T10:00:00Z"), needed: false, waitingFor: [] },
      subscription: { interval: "month", isFounding: true, foundingLockedUntil: new Date("2027-11-16T10:00:00Z"), trialEndsAt: new Date("2026-11-23T10:00:00Z"), nextPaymentAt: new Date("2026-11-23T10:00:00Z"), endsAt: null, pastDue: null, comped: false },
    };
    render(<BillingOverviewPanel overview={overview} notice="checkout_success" actions={actions} copy={copy} />);
    expect(screen.getByText("Free trial")).toBeInTheDocument();
    expect(screen.getByText("3 of 5")).toBeInTheDocument();
    expect(screen.getByText("23 November 2026")).toBeInTheDocument();
    expect(screen.getByText(/held until 16 November 2027/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage plan, card and invoices" })).toBeInTheDocument();
    expect(screen.getByText("You're on the Family plan.")).toBeInTheDocument();
    expect(screen.getByText(/Done on 16 November 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See the/ })).not.toBeInTheDocument();
  });

  it("says when a cancelled plan ends, and warns about an overdue payment with the date access changes", () => {
    const cancelled: BillingOverview = {
      ...base,
      plan: { key: "family", name: "Family" },
      status: "active",
      canManage: true,
      canChoosePlan: false,
      subscription: { interval: "year", isFounding: false, foundingLockedUntil: null, trialEndsAt: null, nextPaymentAt: null, endsAt: new Date("2026-12-16T10:00:00Z"), pastDue: null, comped: false },
    };
    const { unmount } = render(<BillingOverviewPanel overview={cancelled} notice={null} actions={actions} copy={copy} />);
    expect(screen.getByText("Your plan has been cancelled and ends on 16 December 2026.")).toBeInTheDocument();
    unmount();

    const overdue: BillingOverview = { ...cancelled, status: "past_due", subscription: { ...cancelled.subscription!, endsAt: null, pastDue: { graceEndsAt: new Date("2026-12-23T10:00:00Z"), inGrace: true } } };
    render(<BillingOverviewPanel overview={overdue} notice={null} actions={actions} copy={copy} />);
    expect(screen.getByText("Your last payment didn't go through")).toBeInTheDocument();
    expect(screen.getByText(/Nothing changes until 23 December 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update your card" })).toBeInTheDocument();
  });

  it("the message chosen from the address is only a message", () => {
    expect(billingNoticeFrom({ checkout: "success" })).toBe("checkout_success");
    expect(billingNoticeFrom({ card: ["checked", "x"] })).toBe("card_checked");
    expect(billingNoticeFrom({ checkout: "paid", plan: "family" })).toBeNull();
  });
});

describe("PlanChoicePanel", () => {
  it("shows the prices it is given, the founding rate beside the usual one, the trial and the promo box", async () => {
    const { container } = render(<PlanChoicePanel overview={base} cancelled={false} startCheckout={action} copy={copy} />);
    expect(screen.getByRole("radio", { name: /Monthly: £12\.34 a month/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Yearly: £98\.76 a year/ })).toBeInTheDocument();
    expect(screen.getByText(/held for 12 months\. The usual rate is £17\.77 a month/)).toBeInTheDocument();
    expect(screen.getByText(/£49\.32 less over a year/)).toBeInTheDocument();
    expect(screen.getByText(/Extra places are £3\.21 a month each/)).toBeInTheDocument();
    expect(screen.getByText("7 days free to start")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Promo code/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start free trial on Stripe" })).toBeInTheDocument();
    expect(screen.getByText(/STRIPE-COPY/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers nothing to buy when a plan is already running or none is on sale", () => {
    const { unmount } = render(<PlanChoicePanel overview={{ ...base, canChoosePlan: false, plan: { key: "family", name: "Family" } }} cancelled={false} startCheckout={action} copy={copy} />);
    expect(screen.getByText("You're already on the Family plan")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    unmount();
    render(<PlanChoicePanel overview={{ ...base, offers: [] }} cancelled={true} startCheckout={action} copy={copy} />);
    expect(screen.getByText("Paid plans aren't on sale just yet")).toBeInTheDocument();
  });
});
