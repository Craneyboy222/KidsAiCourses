import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardTitle, LinkButton, PageHeader, Stepper, type StepperStep } from "@/components/ui";
import { PARENT_VIEW_PARENT_HIDDEN_KEYS, PARENT_VIEW_PARENT_SEES_KEYS, SAFETY_HOW_IT_WORKS_KEYS } from "@/content/copy/en-GB";
import { requireParent } from "@/server/context";
import { tMany } from "@/server/copy";
import { plan } from "@/server/db";
import { getParentOnboarding } from "@/server/services/onboarding";

export const metadata: Metadata = { title: "Getting started" };

/**
 * Parent onboarding (spec Section 4, "Parent-first sign-up"): read how safety and outside tools
 * work, choose Free or the Family trial, add a child, complete the consent centre. Each step
 * shows whether it is done, and the page can be left and come back to at any time.
 */
export default async function ParentOnboardingPage() {
  const ctx = await requireParent();
  const state = await getParentOnboarding(ctx);
  const copy = await tMany(ctx, [
    "safety.how_it_works.title",
    "safety.how_it_works.intro",
    ...SAFETY_HOW_IT_WORKS_KEYS,
    "parent_view.title.parent",
    "parent_view.intro.parent",
    ...PARENT_VIEW_PARENT_SEES_KEYS,
    ...PARENT_VIEW_PARENT_HIDDEN_KEYS,
  ]);
  // Plans are data (spec 3.7). Names and descriptions only here: prices live on the Billing page.
  const plans = await ctx.db
    .select({ key: plan.key, name: plan.name, description: plan.description, seats: plan.seats, trialDays: plan.trialDays })
    .from(plan)
    .where(eq(plan.active, true))
    .orderBy(asc(plan.position));
  const current = plans.find((p) => p.key === state.plan);
  const waiting = state.children.filter((child) => !child.consentComplete);

  const steps: StepperStep[] = [
    { id: "safety", label: "How safety and outside tools work", status: "done", href: "#safety" },
    { id: "plan", label: "Choose Free or the Family trial", status: "done", href: "#plan" },
    { id: "child", label: "Add a child", status: state.hasChildren ? "done" : "current", href: "#child" },
    { id: "consent", label: "Give the permissions the account needs", status: state.complete ? "done" : state.hasChildren ? "current" : "upcoming", href: state.hasChildren ? "#consent" : undefined },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Getting started"
        description="Four short steps and your child can begin. You can stop at any point and pick up where you left off."
        actions={state.complete ? <LinkButton href="/parent">Go to your dashboard</LinkButton> : undefined}
      />
      <Stepper steps={steps} orientation="horizontal" />

      <Card as="section" id="safety" className="flex flex-col gap-4">
        <CardTitle>1. {copy["safety.how_it_works.title"]}</CardTitle>
        <p className="max-w-measure">{copy["safety.how_it_works.intro"]}</p>
        <ul className="max-w-measure flex list-disc flex-col gap-2 pl-5">
          {SAFETY_HOW_IT_WORKS_KEYS.map((key) => (
            <li key={key}>{copy[key]}</li>
          ))}
        </ul>
        <h3 className="text-lg font-bold">{copy["parent_view.title.parent"]}</h3>
        <p className="max-w-measure">{copy["parent_view.intro.parent"]}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="font-bold">You can see</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {PARENT_VIEW_PARENT_SEES_KEYS.map((key) => (
                <li key={key}>{copy[key]}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-bold">Stays private to your child</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {PARENT_VIEW_PARENT_HIDDEN_KEYS.map((key) => (
                <li key={key}>{copy[key]}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-sm">
          <Link href="/safety" className="link">
            Read the full safety overview
          </Link>
        </p>
      </Card>

      <Card as="section" id="plan" className="flex flex-col gap-4">
        <CardTitle>2. Choose Free or the Family trial</CardTitle>
        <p className="max-w-measure">
          You are on the <strong>{current?.name ?? "Free"}</strong> plan, which is a fine place to start: nothing to pay and no card needed. You can start a Family trial now or at any time later.
        </p>
        {plans.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2">
            {plans.map((p) => (
              <li key={p.key} className="rounded-card border-line flex flex-col gap-1 border-2 p-4">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {p.name}
                  {p.key === state.plan && <Badge tone="success">Your plan</Badge>}
                </p>
                {p.description && <p className="text-ink-muted">{p.description}</p>}
                <p className="text-sm">
                  Room for {p.seats} {p.seats === 1 ? "learner" : "learners"}
                  {p.trialDays > 0 ? `, with a ${p.trialDays}-day trial` : ""}.
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/parent/billing" variant="secondary">
            See plans and start a trial
          </LinkButton>
          <LinkButton href="#child" variant="ghost">
            Stay on Free for now
          </LinkButton>
        </div>
      </Card>

      <Card as="section" id="child" className="flex flex-col gap-4">
        <CardTitle>3. Add a child</CardTitle>
        <p className="max-w-measure">A nickname, the month and year they were born, and a made-up username. We never ask for your child&apos;s email address, full name, school or a photo.</p>
        {state.children.length > 0 && (
          <ul className="flex flex-col gap-2">
            {state.children.map((child) => (
              <li key={child.learnerId} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{child.nickname}</span>
                <Badge tone={child.consentComplete ? "success" : "warning"}>{child.consentComplete ? "Ready" : "Waiting for permissions"}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div>
          <LinkButton href="/parent/children/new" variant={state.hasChildren ? "secondary" : "primary"}>
            {state.hasChildren ? "Add another child" : "Add a child"}
          </LinkButton>
        </div>
      </Card>

      <Card as="section" id="consent" className="flex flex-col gap-4">
        <CardTitle>4. Give the permissions the account needs</CardTitle>
        <p className="max-w-measure">Three permissions are needed for an account to work, and two more are your choice. Each one is explained in plain English, and you can change your mind later.</p>
        {!state.hasChildren && <p className="text-ink-muted">Add a child first, then come back here.</p>}
        {state.hasChildren && waiting.length === 0 && <p className="font-bold">All done. Every child&apos;s permissions are in place.</p>}
        {waiting.length > 0 && (
          <ul className="flex flex-col gap-2">
            {waiting.map((child) => (
              <li key={child.learnerId}>
                <LinkButton href={`/parent/children/${child.learnerId}/consent`}>Review {child.nickname}&apos;s permissions</LinkButton>
              </li>
            ))}
          </ul>
        )}
        {state.complete && (
          <div>
            <LinkButton href="/parent">Go to your dashboard</LinkButton>
          </div>
        )}
      </Card>
    </div>
  );
}
