"use client";

import Link from "next/link";
import { ActionForm, Button, Callout, Field, FormError, Input, MonthYearPicker, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { ConsentFields, type ConsentFieldItem } from "../../_components/consent-fields";
import { adultDetailsAction, teenAgeAction, teenDetailsAction } from "../actions";

export type TeenSignupFormProps = {
  maxYear: number;
  minYear: number;
  consents: ConsentFieldItem[];
  copy: { noEmail: string; deletedAfter7Days: string; lockedUntilApproved: string };
};

const usernameHint = (suggestions: string[]) =>
  `3 to 20 letters, numbers or underscores. Make it up: no real name, school, town or birth year.${suggestions.length > 0 ? ` Ideas: ${suggestions.join(", ")}.` : ""}`;

/**
 * Teen sign-up in two steps. Step one asks only for the birth month and year; the server decides
 * what comes next, and for anyone under 13 nothing further is asked or kept. Step two is the
 * teen form (username, password, a parent's email) or, for an 18-year-old when that is switched
 * on, the adult form with their own email and consents.
 */
export function TeenSignupForm({ maxYear, minYear, consents, copy }: TeenSignupFormProps) {
  const age = useActionForm(teenAgeAction);
  const teen = useActionForm(teenDetailsAction);
  const adult = useActionForm(adultDetailsAction);
  const step = age.data;

  if (adult.succeeded) {
    return (
      <Callout tone="success" title="Check your email" live="status">
        <p>We&apos;ve sent a link to the address you gave. Open it to confirm your email and you&apos;ll be signed in.</p>
        <p>The link works for 24 hours. If nothing arrives in a few minutes, look in your junk folder.</p>
      </Callout>
    );
  }

  if (!step) {
    return (
      <ActionForm action={age.formAction} aria-label="Your age">
        {/* Without JavaScript a problem from the second step lands back here, so it is shown here too. */}
        <FormError {...(teen.error ? teen.summaryProps : adult.error ? adult.summaryProps : age.summaryProps)} />
        <MonthYearPicker
          legend="When were you born?"
          name="birth"
          hint="Just the month and the year. We never ask for the day."
          maxYear={maxYear}
          minYear={minYear}
          required
          autoComplete="bday"
          error={age.fieldError("birth")}
        />
        <SubmitButton loading={age.pending} pendingText="Checking…" fullWidth>
          Continue
        </SubmitButton>
      </ActionForm>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="birthMonth" value={step.birthMonth} />
      <input type="hidden" name="birthYear" value={step.birthYear} />
    </>
  );
  // A plain GET form: it reloads the page, which is what clears the first step, with or without JavaScript.
  const startAgain = (
    <form method="get" action="/signup/teen">
      <Button type="submit" variant="ghost" size="sm">
        Start again
      </Button>
    </form>
  );

  if (step.route === "adult") {
    const adultForm = (
      <ActionForm action={adult.formAction} aria-label="Create your account">
        <FormError {...adult.summaryProps} fieldLabels={{ username: "Username", email: "Email address", password: "Password" }} />
        {hidden}
        <p>You&apos;re 18 or over, so this account is yours to run. You&apos;ll need your own email address.</p>
        <Field label="Username" hint={usernameHint(step.suggestions)} error={adult.fieldError("username")}>
          <Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
        </Field>
        <Field label="Email address" hint="We send a link to confirm it. You also use it to reset your password." error={adult.fieldError("email")}>
          <Input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required />
        </Field>
        <Field label="Password" hint="At least 10 characters. Three random words work well." error={adult.fieldError("password")}>
          <PasswordInput name="password" autoComplete="new-password" required />
        </Field>
        <ConsentFields items={consents} fieldError={adult.fieldError} audience="self" />
        <SubmitButton loading={adult.pending} pendingText="Creating your account…" fullWidth>
          Create my account
        </SubmitButton>
      </ActionForm>
    );
    return (
      <>
        {adultForm}
        {startAgain}
      </>
    );
  }

  return (
    <>
    <ActionForm action={teen.formAction} aria-label="Create your account">
      <FormError {...teen.summaryProps} fieldLabels={{ username: "Username", password: "Password", parentEmail: "Parent or carer's email" }} />
      {hidden}
      <Callout tone="info" title="You'll need a parent or carer to say yes">
        <p>{copy.lockedUntilApproved}</p>
        <p>{copy.deletedAfter7Days}</p>
      </Callout>
      <Field label="Username" hint={usernameHint(step.suggestions)} error={teen.fieldError("username")}>
        <Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
      </Field>
      <Field label="Password" hint="At least 10 characters. Three random words work well." error={teen.fieldError("password")}>
        <PasswordInput name="password" autoComplete="new-password" required />
      </Field>
      <Field
        label="Your parent or carer's email address"
        hint={`${copy.noEmail} We use this address once, to ask them to approve your account.`}
        error={teen.fieldError("parentEmail")}
      >
        <Input name="parentEmail" type="email" autoComplete="off" inputMode="email" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <SubmitButton loading={teen.pending} pendingText="Creating your account…" fullWidth>
        Create my account
      </SubmitButton>
      <p className="text-ink-muted text-sm">
        By carrying on you agree to our{" "}
        <Link href="/legal/community-code" className="link">
          community code
        </Link>
        . Your parent or carer agrees to the rest when they approve your account.
      </p>
    </ActionForm>
    {startAgain}
    </>
  );
}
