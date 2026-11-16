import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketingShell } from "@/components/layout";
import { HelpArticleList, HelpSearchForm, helpHref } from "@/components/marketing/help";
import { AskParentAboutPlans, PlanCards } from "@/components/marketing/plans";
import { ProsePage } from "@/components/marketing/prose-page";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { metaDescription, publicPageMetadata } from "@/lib/marketing/metadata";
import type { PricedPlan } from "@/server/services/marketing";
import { axeViolations } from "../ui/axe-helper";

/** Anything that would show money to the reader. */
const MONEY = /£|\bGBP\b|pence|\bprice|per month|a month|a year|checkout|invoice|promo|trial|card\b/i;

const PLANS: PricedPlan[] = [
  { key: "free", name: "Free", description: "Some complete courses.", seats: 2, fullCatalogue: false, highlights: ["Every parent control"], pricing: { monthlyPence: 0, annualPence: 0, founding: null, extraSeatMonthlyPence: null, trialDays: 0, placeholder: true } },
  {
    key: "family",
    name: "Family",
    description: "Every course.",
    seats: 4,
    fullCatalogue: true,
    highlights: ["Every course in the catalogue"],
    pricing: { monthlyPence: 1234, annualPence: 9900, founding: { monthlyPence: 777, annualPence: 6600, lockMonths: 12 }, extraSeatMonthlyPence: 250, trialDays: 7, placeholder: true },
  },
];

describe("the pricing page", () => {
  it("shows a learner under 18 the Ask a parent page, with nothing about money on it", () => {
    const { container } = render(<AskParentAboutPlans />);
    expect(screen.getByRole("heading", { name: "Plans are looked after by your parent or carer" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(MONEY);
    expect(container.innerHTML).not.toMatch(/£|\d+\.\d{2}/);
    expect(screen.getByRole("link", { name: "Explore courses" })).toHaveAttribute("href", "/explore");
    // It cannot be handed a plan or an amount: it takes no props.
    expect(AskParentAboutPlans.length).toBe(0);
  });

  it("shows adults every figure from the plan data, and says when prices are placeholders", () => {
    render(<PlanCards plans={PLANS} viewer="visitor" />);
    const family = screen.getByTestId("plan-family");
    expect(family).toHaveTextContent("£12.34");
    expect(family).toHaveTextContent("£99 a year");
    expect(family).toHaveTextContent("£7.77 a month or £66 a year, held at that price for 12 months.");
    expect(family).toHaveTextContent("Extra places at £2.50 a month each");
    expect(family).toHaveTextContent("7-day free trial");
    expect(family).toHaveTextContent("Up to 4 learners");
    expect(screen.getByTestId("plan-free")).toHaveTextContent("£0 and it stays free");
    expect(screen.getByText("These prices are not final")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start on Free" })).toHaveAttribute("href", "/signup/parent");
  });

  it("sends each kind of adult to the right place to choose a plan", () => {
    const { unmount } = render(<PlanCards plans={PLANS} viewer="parent" />);
    expect(screen.getAllByRole("link", { name: "Choose a plan" })[0]).toHaveAttribute("href", "/parent/billing/plans");
    unmount();
    const adult = render(<PlanCards plans={PLANS} viewer="adult_learner" />);
    expect(screen.getAllByRole("link", { name: "Choose a plan" })[0]).toHaveAttribute("href", "/settings/billing/plans");
    adult.unmount();
    render(<PlanCards plans={PLANS.map((plan) => ({ ...plan, pricing: { ...plan.pricing, placeholder: false } }))} viewer="staff" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("These prices are not final")).toBeNull();
  });

  it("has no accessibility violations in either form", async () => {
    render(
      <main>
        <h1>Pricing</h1>
        <PlanCards plans={PLANS} viewer="visitor" />
        <AskParentAboutPlans />
      </main>,
    );
    expect(await axeViolations()).toEqual([]);
  });
});

describe("the site frame", () => {
  it("offers sign-in and sign-up to a visitor", () => {
    render(
      <MarketingShell year={2026}>
        <h1>Page</h1>
      </MarketingShell>,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup/parent");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("offers a signed-in visitor their own home instead, and shows the cookie note", async () => {
    render(
      <MarketingShell year={2026} account={{ href: "/home", label: "Go to your home" }} footerNote={<p>We only use the cookies this site needs to work.</p>}>
        <h1>Page</h1>
      </MarketingShell>,
    );
    expect(screen.getByRole("link", { name: "Go to your home" })).toHaveAttribute("href", "/home");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
    expect(screen.getByText("We only use the cookies this site needs to work.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy for teens" })).toHaveAttribute("href", "/legal/privacy-teen");
    expect(screen.getByRole("link", { name: "How we use AI" })).toHaveAttribute("href", "/legal/ai-use-policy");
    expect(await axeViolations()).toEqual([]);
  });
});

describe("text pages and help", () => {
  it("renders a page's Markdown under one h1, with the brand name filled in", async () => {
    render(
      <main>
        <ProsePage title="About {{brandName}}" description="What {{brandName}} is." body={"# First\n\nWelcome to {{brandName}}.\n\n# Second\n\n## Detail\n\n- one\n- two"} />
      </main>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(fillBrand("About {{brandName}}"));
    // A `#` in page text is a section under the page's own h1, so it becomes an h2.
    expect(screen.getByRole("heading", { level: 2, name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Detail" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("{{brandName}}");
    expect(await axeViolations()).toEqual([]);
  });

  it("says so when a page's text is unavailable, rather than showing an empty page", () => {
    render(<ProsePage title="Safety" body={null} />);
    expect(screen.getByText("This page is being updated")).toBeInTheDocument();
  });

  it("has a labelled search form that works without JavaScript and keeps the reader filter", async () => {
    const { container } = render(
      <main>
        <h1>Help centre</h1>
        <HelpSearchForm query="invite code" reader="teen" />
        <HelpArticleList articles={[{ slug: "invite-codes", title: "Invite codes", summary: "A one-time code.", topic: "accounts", audience: "everyone", position: 1, body: "" }, { slug: "tool-approvals", title: "Approving tools", summary: "For parents.", topic: "tools", audience: "adult", position: 2, body: "" }]} headingLevel="h2" />
      </main>,
    );
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/help");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("searchbox", { name: "Search the help centre" })).toHaveValue("invite code");
    expect(container.querySelector('input[type="hidden"][name="for"]')).toHaveValue("teen");
    expect(screen.getByRole("link", { name: "For teenagers" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "For parents and carers" })).toHaveAttribute("href", "/help?q=invite+code&for=parent");
    expect(screen.getByRole("link", { name: "Invite codes" })).toHaveAttribute("href", "/help/invite-codes");
    expect(screen.getByText("For parents and carers", { selector: "span" })).toBeInTheDocument();
    expect(helpHref({})).toBe("/help");
    expect(await axeViolations()).toEqual([]);
  });
});

describe("page metadata", () => {
  it("gives a public page a canonical address, Open Graph and a summary card", () => {
    const meta = publicPageMetadata({ title: "Safety", description: "How it works.", path: "/safety" });
    expect(meta.title).toBe("Safety");
    expect(meta.alternates?.canonical).toBe("/safety");
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph).toMatchObject({ url: "/safety", locale: "en_GB", type: "website", description: "How it works." });
    expect(JSON.stringify(meta.openGraph)).toContain("/icons/icon-512.png");
    expect(meta.twitter).toMatchObject({ card: "summary" });
    // Every image comes from this site: no other host is ever named.
    expect(JSON.stringify(meta)).not.toMatch(/https?:\/\//);
  });

  it("marks a page that must not be listed, and gives it no canonical address", () => {
    const meta = publicPageMetadata({ title: "Draft", description: "x", path: "/legal/privacy", index: false });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(publicPageMetadata({ title: "Home title", description: "x", path: "/", absoluteTitle: true }).title).toEqual({ absolute: "Home title" });
  });

  it("cuts a long description at a word", () => {
    const long = "word ".repeat(80);
    const cut = metaDescription(long);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(metaDescription("Short  and\nsweet.")).toBe("Short and sweet.");
  });
});
