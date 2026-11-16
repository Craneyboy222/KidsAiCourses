"use client";

import { ActionForm, Callout, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { sendMagicLinkAction, signInEmailAction, signInLearnerAction } from "./actions";

type Props = { next: string };

/** Learners sign in with a username and password. There is no email field anywhere on this form. */
export function LearnerSignInForm({ next }: Props) {
  const form = useActionForm(signInLearnerAction);
  return (
    <ActionForm action={form.formAction} aria-label="Learner sign-in">
      <FormError {...form.summaryProps} title="We couldn't sign you in" />
      <input type="hidden" name="next" value={next} />
      <Field label="Username" error={form.fieldError("username")}>
        <Input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      </Field>
      <Field label="Password" error={form.fieldError("password")}>
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Signing you in…" fullWidth>
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}

/** Parents, carers and the team sign in with an email address and password. */
export function EmailSignInForm({ next }: Props) {
  const form = useActionForm(signInEmailAction);
  return (
    <ActionForm action={form.formAction} aria-label="Parent or carer sign-in">
      <FormError {...form.summaryProps} title="We couldn't sign you in" />
      <input type="hidden" name="next" value={next} />
      <Field label="Email address" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <Field label="Password" error={form.fieldError("password")}>
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Signing you in…" fullWidth>
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}

/** A one-time sign-in link for parents. The message is the same whether or not the address has an account. */
export function MagicLinkForm({ next }: Props) {
  const form = useActionForm(sendMagicLinkAction);
  return (
    <ActionForm action={form.formAction} aria-label="Email me a sign-in link">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="next" value={next} />
      {form.succeeded && (
        <Callout tone="success" title="Check your email" live="status">
          <p>If that address belongs to a parent account, a sign-in link is on its way. It works once, for 10 minutes.</p>
        </Callout>
      )}
      <Field label="Email address for your link" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <SubmitButton loading={form.pending} variant="secondary" pendingText="Sending…" fullWidth>
        Email me a sign-in link
      </SubmitButton>
    </ActionForm>
  );
}
