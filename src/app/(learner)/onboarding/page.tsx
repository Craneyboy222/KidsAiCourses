import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { A11yPreferences, LinkButton, PageHeader, Stepper, type StepperStep } from "@/components/ui";
import { getCtx } from "@/server/context";
import { INTEREST_TAGS } from "@/content/schema";
import { INTEREST_LABELS, LEARNER_ONBOARDING_STEPS, MIN_INTERESTS, getFirstProjectChoices, getLearnerOnboarding, newAvatarChoices, type LearnerOnboardingStep } from "@/server/services/onboarding";
import { resolveAfterSignIn } from "@/server/services/sign-in";
import { saveAccessibilityAction } from "./actions";
import { AvatarForm, InterestsForm, ProjectForm, SkipRestForm } from "./onboarding-forms";

export const metadata: Metadata = { title: "Set up your account", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

const STEP_LABELS: Record<LearnerOnboardingStep, string> = {
  interests: "What you're into",
  avatar: "Your avatar",
  accessibility: "Make it easier to read",
  project: "Your first project",
};

/**
 * Learner onboarding (spec 3.1): interests first, then a generated avatar, accessibility
 * preferences and a first project. Short, and everything after interests can be skipped.
 *
 * No `<main>` here: the learner layout (owned by the learning slice) provides the page frame.
 */
export default async function LearnerOnboardingPage({ searchParams }: { searchParams: Search }) {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect("/signin?next=%2Fonboarding");
  // Parents and staff have their own homes. A learner who is waiting or paused cannot be set up yet.
  if (ctx.actor.type !== "learner" || ctx.actor.status !== "active") redirect((await resolveAfterSignIn(ctx)).path);

  const state = await getLearnerOnboarding(ctx);
  const asked = (await searchParams).step;
  const wanted = LEARNER_ONBOARDING_STEPS.find((step) => step === asked);
  // Interests come first: nothing later can be opened until three are saved.
  const step: LearnerOnboardingStep = state.canSkip ? (wanted ?? "interests") : "interests";

  const order = LEARNER_ONBOARDING_STEPS;
  const steps: StepperStep[] = order.map((id, index) => ({
    id,
    label: STEP_LABELS[id],
    status: id === step ? "current" : index < order.indexOf(step) ? "done" : "upcoming",
    href: state.canSkip && id !== step ? `/onboarding?step=${id}` : undefined,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader title={`Hi ${state.nickname}. Let's set things up`} description="Four quick steps. After the first one you can skip the rest and come back to them in Settings." />
      <Stepper steps={steps} orientation="horizontal" />

      {step === "interests" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">What are you into?</h2>
          <p className="text-ink-muted">Pick at least {MIN_INTERESTS}. We use them to suggest projects you&apos;ll actually want to make. You can change them later.</p>
          <InterestsForm options={INTEREST_TAGS.map((tag) => ({ value: tag, label: INTEREST_LABELS[tag] }))} chosen={state.interests} />
        </section>
      )}

      {step === "avatar" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Pick an avatar</h2>
          <p className="text-ink-muted">These are made from shapes and colours. We never use photos, so nobody can tell who you are from your avatar.</p>
          {/* The first choice is the one they have now; the rest are fresh each time the page loads. */}
          <AvatarForm choices={[state.avatarSeed, ...newAvatarChoices(5)]} current={state.avatarSeed} />
        </section>
      )}

      {step === "accessibility" && (
        <section className="flex flex-col gap-4">
          <A11yPreferences initial={state.a11y} onSave={saveAccessibilityAction} />
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/onboarding?step=project">Continue</LinkButton>
          </div>
        </section>
      )}

      {step === "project" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Pick your first project</h2>
          <p className="text-ink-muted">Something to make first, chosen from what you said you&apos;re into. You can pick a different one any time from Explore.</p>
          <ProjectForm choices={await getFirstProjectChoices(ctx)} />
        </section>
      )}

      {state.canSkip && step !== "project" && (
        <div className="border-line flex flex-wrap items-center gap-3 border-t-2 pt-4">
          <SkipRestForm />
          <p className="text-ink-muted text-sm">
            You can finish these later in{" "}
            <Link href="/settings" className="link">
              Settings
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
