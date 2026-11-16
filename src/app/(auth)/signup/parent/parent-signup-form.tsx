"use client";

import Link from "next/link";
import { ActionForm, Callout, Checkbox, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { signUpParentAction } from "../actions";

/** The parent sign-up form. On success it is replaced by "check your email". */
export function ParentSignupForm() {
  const form = useActionForm(signUpParentAction);

  if (form.succeeded) {
    return (
      <Callout tone="success" title="Check your email" live="status">
        <p>
          We&apos;ve sent a link to the address you gave. Open it to confirm your email and you&apos;ll be signed in, ready to add your first child.
        </p>
        <p>The link works for 24 hours. If nothing arrives in a few minutes, look in your junk folder.</p>
        <p>
          Already have an account with that address?{" "}
          <Link href="/signin?as=parent" className="link">
            Sign in
          </Link>{" "}
          or{" "}
          <Link href="/reset" className="link">
            reset your password
          </Link>
          .
        </p>
      </Callout>
    );
  }

  return (
    <ActionForm action={form.formAction} aria-label="Create a family account">
      <FormError {...form.summaryProps} fieldLabels={{ email: "Email address", password: "Password", confirmedAdult: "Confirmation", name: "Your name" }} />
      <Field label="Your name" optional hint="What we call you in emails. A first name is fine." error={form.fieldError("name")}>
        <Input name="name" autoComplete="given-name" maxLength={80} />
      </Field>
      <Field label="Email address" hint="We send a link to confirm it. This is your own address, not your child's." error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <Field
        label="Password"
        optional
        hint="At least 10 characters. Leave this empty if you would rather sign in with a link we email you each time."
        error={form.fieldError("password")}
      >
        <PasswordInput name="password" autoComplete="new-password" />
      </Field>
      <Checkbox
        name="confirmedAdult"
        required
        label="I am 18 or over, and I am the parent or carer of the child I will add"
        description="Family accounts can only be created by an adult who is responsible for the child."
        error={form.fieldError("confirmedAdult")}
      />
      <SubmitButton loading={form.pending} pendingText="Creating your account…" fullWidth>
        Create family account
      </SubmitButton>
    </ActionForm>
  );
}
