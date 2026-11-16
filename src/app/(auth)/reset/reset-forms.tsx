"use client";

import Link from "next/link";
import { ActionForm, Callout, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { requestPasswordResetAction, resetPasswordAction } from "../signin/actions";

/** Step one: the email address. The answer is the same whether or not it has an account. */
export function ResetRequestForm() {
  const form = useActionForm(requestPasswordResetAction);
  if (form.succeeded) {
    return (
      <Callout tone="success" title="Check your email" live="status">
        <p>If that address has an account, a link to choose a new password is on its way. It works once and lasts an hour.</p>
        <p>Nothing after a few minutes? Look in your junk folder, and check it is the address you signed up with.</p>
      </Callout>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Ask for a reset link">
      <FormError {...form.summaryProps} />
      <Field label="Email address" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Sending…" fullWidth>
        Email me a reset link
      </SubmitButton>
    </ActionForm>
  );
}

/** Step two, from the emailed link: the new password. */
export function NewPasswordForm({ token }: { token: string }) {
  const form = useActionForm(resetPasswordAction);
  if (form.succeeded) {
    return (
      <Callout
        tone="success"
        title="Password changed"
        live="status"
        actions={
          <Link href="/signin?as=parent&notice=reset" className="link">
            Sign in with your new password
          </Link>
        }
      >
        <p>You&apos;ve been signed out everywhere else.</p>
      </Callout>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Finish the reset">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 10 characters. Three random words work well." error={form.fieldError("password")}>
        <PasswordInput name="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Saving…" fullWidth>
        Save new password
      </SubmitButton>
    </ActionForm>
  );
}
