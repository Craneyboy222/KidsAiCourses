"use client";

import { ConsentFields, type ConsentFieldItem } from "@/app/(auth)/_components/consent-fields";
import { ActionForm, Callout, Checkbox, Field, FormError, Input, RadioGroup, SubmitButton, useActionForm } from "@/components/ui";
import { confirmIndependenceAction, removeParentLinkAction, requestIndependenceAction } from "./actions";

/** Step 1: their own email address. Only an 18-year-old ever sees this form. */
export function RequestIndependenceForm() {
  const form = useActionForm(requestIndependenceAction);
  return (
    <ActionForm action={form.formAction} aria-label="Add your email address">
      <FormError {...form.summaryProps} />
      {form.succeeded && (
        <Callout tone="success" title="Check your email" live="status">
          <p>We&apos;ve sent a link to that address. Open it on this device while you&apos;re signed in. It lasts 24 hours, and nothing changes until you confirm on the next page.</p>
        </Callout>
      )}
      <Field label="Your own email address" hint="We send a link to confirm it. Afterwards you use it to reset your password." error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Sending…">
        Email me a confirmation link
      </SubmitButton>
    </ActionForm>
  );
}

/** Step 2: their own consents, the parent link, and one explicit "yes". */
export function ConfirmIndependenceForm({ token, parentLinked, consents }: { token: string; parentLinked: boolean; consents: ConsentFieldItem[] }) {
  const form = useActionForm(confirmIndependenceAction);
  return (
    <ActionForm action={form.formAction} aria-label="Take over your account" className="gap-6">
      <FormError {...form.summaryProps} fieldLabels={{ parentLink: "Link to your parent or carer", understood: "Confirmation" }} />
      <input type="hidden" name="token" value={token} />
      <ConsentFields items={consents} fieldError={form.fieldError} audience="self" />
      {parentLinked ? (
        <RadioGroup
          legend="Your link to your parent or carer"
          name="parentLink"
          required
          defaultValue="keep"
          error={form.fieldError("parentLink")}
          options={[
            { value: "keep", label: "Stay linked for now", description: "They still see your progress and their plan still covers you. You can remove the link later." },
            { value: "remove", label: "Have an account of my own", description: "You leave their family and move to the Free plan. They stop seeing anything. Your work stays with you." },
          ]}
        />
      ) : (
        <input type="hidden" name="parentLink" value="remove" />
      )}
      <Checkbox name="understood" required label="Yes, I want to run my own account" description="Your parent or carer will be told that you have done this." error={form.fieldError("understood")} />
      <SubmitButton loading={form.pending} pendingText="Saving…">
        Take over my account
      </SubmitButton>
    </ActionForm>
  );
}

/** For someone who stayed linked: leave the parent's family later. */
export function RemoveParentLinkForm() {
  const form = useActionForm(removeParentLinkAction);
  return (
    <ActionForm action={form.formAction} aria-label="Remove the link to your parent or carer">
      <FormError {...form.summaryProps} />
      <Checkbox name="confirm" required label="Yes, remove the link" description="This can't be undone from here." error={form.fieldError("confirm")} />
      <SubmitButton loading={form.pending} variant="danger" pendingText="Removing…">
        Remove the link
      </SubmitButton>
    </ActionForm>
  );
}
