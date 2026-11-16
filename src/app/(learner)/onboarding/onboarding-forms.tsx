"use client";

import { ActionForm, Checkbox, FormError, GeneratedAvatar, RadioGroup, SubmitButton, useActionForm } from "@/components/ui";
import { finishOnboardingAction, saveAvatarAction, saveInterestsAction } from "./actions";

/** The 16 interest tags as tick boxes. At least three are needed; the server checks. */
export function InterestsForm({ options, chosen }: { options: Array<{ value: string; label: string }>; chosen: string[] }) {
  const form = useActionForm(saveInterestsAction);
  return (
    <ActionForm action={form.formAction} aria-label="What you're into">
      <FormError {...form.summaryProps} />
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-ink font-bold">Choose at least three</legend>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {options.map((option) => (
            <Checkbox key={option.value} name="interests" value={option.value} label={option.label} defaultChecked={chosen.includes(option.value)} />
          ))}
        </div>
      </fieldset>
      <SubmitButton loading={form.pending} pendingText="Saving…">
        Continue
      </SubmitButton>
    </ActionForm>
  );
}

/** Generated avatars to choose from. Only the seed that draws the shapes is sent. */
export function AvatarForm({ choices, current }: { choices: string[]; current: string }) {
  const form = useActionForm(saveAvatarAction);
  return (
    <ActionForm action={form.formAction} aria-label="Pick an avatar">
      <FormError {...form.summaryProps} />
      <RadioGroup
        legend="Choose one"
        name="avatar"
        layout="row"
        defaultValue={current}
        required
        error={form.fieldError("avatar")}
        options={choices.map((seed, index) => ({
          value: seed,
          label: (
            <span className="inline-flex items-center gap-2">
              <GeneratedAvatar seed={seed} size="lg" />
              <span>{seed === current ? "The one you have now" : `Avatar ${index + 1}`}</span>
            </span>
          ),
        }))}
      />
      <SubmitButton loading={form.pending} pendingText="Saving…">
        Continue
      </SubmitButton>
    </ActionForm>
  );
}

export type ProjectChoice = { slug: string; title: string; tagline: string; whatYouMake: string; estimatedMinutes: number };

/** Up to three courses to start with. None are locked or priced: learners never see prices. */
export function ProjectForm({ choices }: { choices: ProjectChoice[] }) {
  const form = useActionForm(finishOnboardingAction);
  if (choices.length === 0) {
    return (
      <ActionForm action={form.formAction} aria-label="Finish setting up">
        <FormError {...form.summaryProps} />
        <p>You&apos;re all set. Head to your home page and have a look around Explore to find something to make.</p>
        <SubmitButton loading={form.pending} pendingText="Finishing…">
          Go to my home page
        </SubmitButton>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Pick your first project">
      <FormError {...form.summaryProps} />
      <RadioGroup
        legend="Which one first?"
        name="project"
        defaultValue={choices[0]?.slug}
        options={choices.map((course) => ({
          value: course.slug,
          label: course.title,
          description: `${course.whatYouMake || course.tagline} About ${course.estimatedMinutes} minutes.`,
        }))}
      />
      <div className="flex flex-wrap gap-3">
        <SubmitButton loading={form.pending} pendingText="Opening…">
          Start with this one
        </SubmitButton>
        <SubmitButton loading={form.pending} variant="ghost" name="later" value="1" pendingText="Finishing…">
          Decide later
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** "Skip the rest": finishes onboarding with whatever has been saved so far. */
export function SkipRestForm() {
  const form = useActionForm(finishOnboardingAction);
  return (
    <ActionForm action={form.formAction} aria-label="Skip the rest" className="gap-2">
      <FormError {...form.summaryProps} />
      <SubmitButton loading={form.pending} variant="ghost" pendingText="Finishing…">
        Skip the rest
      </SubmitButton>
    </ActionForm>
  );
}
