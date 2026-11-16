"use client";

import { ActionForm, Callout, Checkbox, FormError, GeneratedAvatar, RadioGroup, SubmitButton, useActionForm } from "@/components/ui";
import { markNoticesReadAction, saveSettingsAvatarAction, saveSettingsInterestsAction } from "./actions";

function Saved({ show, children }: { show: boolean; children: string }) {
  if (!show) return null;
  return (
    <Callout tone="success" live="status">
      <p>{children}</p>
    </Callout>
  );
}

export function InterestsSettingsForm({ options, chosen, minimum }: { options: Array<{ value: string; label: string }>; chosen: string[]; minimum: number }) {
  const form = useActionForm(saveSettingsInterestsAction);
  return (
    <ActionForm action={form.formAction} aria-label="Your interests">
      <FormError {...form.summaryProps} />
      <Saved show={form.succeeded}>Interests saved. Your suggestions will follow them.</Saved>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-ink font-bold">What you&apos;re into (choose at least {minimum})</legend>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {options.map((option) => (
            <Checkbox key={option.value} name="interests" value={option.value} label={option.label} defaultChecked={chosen.includes(option.value)} />
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton loading={form.pending} pendingText="Saving…">
          Save interests
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AvatarSettingsForm({ choices, current }: { choices: string[]; current: string }) {
  const form = useActionForm(saveSettingsAvatarAction);
  return (
    <ActionForm action={form.formAction} aria-label="Your avatar">
      <FormError {...form.summaryProps} />
      <Saved show={form.succeeded}>Avatar saved.</Saved>
      <RadioGroup
        legend="Pick an avatar"
        hint="Made from shapes and colours. We never use photos."
        name="avatar"
        layout="row"
        defaultValue={current}
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
      <div>
        <SubmitButton loading={form.pending} pendingText="Saving…">
          Save avatar
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MarkNoticesReadForm() {
  const form = useActionForm(markNoticesReadAction);
  return (
    <form action={form.formAction} className="flex flex-col gap-2">
      <FormError {...form.summaryProps} />
      <div>
        <SubmitButton variant="secondary" pendingText="Marking…">
          Mark all as read
        </SubmitButton>
      </div>
    </form>
  );
}
