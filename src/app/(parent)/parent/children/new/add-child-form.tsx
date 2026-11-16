"use client";

import Link from "next/link";
import { ActionForm, Callout, Field, FormError, Input, LinkButton, MonthYearPicker, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { addChildAction } from "../actions";

export type AddChildFormProps = {
  maxYear: number;
  minYear: number;
  suggestions: string[];
  /** How many learners the plan has room for, when that is known. */
  full: { seats: number } | null;
  /** Every place on the plan is in use: show that in place of the form. */
  isFull: boolean;
};

/**
 * The add-a-child form. With a password it goes straight on to the permissions. Without one, the
 * one-time code is shown here, once, with what to do with it.
 */
export function AddChildForm({ maxYear, minYear, suggestions, full, isFull }: AddChildFormProps) {
  const form = useActionForm(addChildAction);
  const added = form.data;

  if (added?.invite) {
    return (
      <div className="flex flex-col gap-5">
        <Callout tone="success" title={`${added.nickname} has been added`} live="status">
          <p>
            Their username is <strong>{added.username}</strong>. Give them this one-time code so they can choose their own password:
          </p>
          <p className="rounded-control border-ink bg-surface w-fit border-2 px-4 py-2 font-mono text-2xl font-bold tracking-widest" data-testid="invite-code">
            {added.invite.code}
          </p>
          <p>
            It works once, until {added.invite.expiresOn}. They enter it at <strong>/join</strong> with their username. We&apos;ve also emailed the code to you, because this is the only time it is shown here.
          </p>
        </Callout>
        <p>One more step: {added.nickname}&apos;s account stays locked until you have given the permissions it needs.</p>
        <div>
          <LinkButton href={`/parent/children/${added.learnerId}/consent?from=new`}>Continue to {added.nickname}&apos;s permissions</LinkButton>
        </div>
      </div>
    );
  }

  if (isFull && full) {
    return (
      <Callout
        tone="warning"
        title="All the places on your plan are in use"
        actions={
          <LinkButton href="/parent/billing" variant="secondary">
            Go to Billing
          </LinkButton>
        }
      >
        <p>
          Your plan has room for {full.seats} {full.seats === 1 ? "learner" : "learners"}. You can add places from your Billing page, or remove a child you no longer need from your{" "}
          <Link href="/parent/privacy" className="link">
            Privacy page
          </Link>
          .
        </p>
      </Callout>
    );
  }

  return (
    <ActionForm action={form.formAction} aria-label="Add a child">
      <FormError {...form.summaryProps} fieldLabels={{ nickname: "Nickname", birth: "Month and year of birth", username: "Username", password: "Password" }} />
      <Field label="Nickname" hint="What we call them on screen and on certificates. A first name or nickname only, not a full name." error={form.fieldError("nickname")}>
        <Input name="nickname" autoComplete="off" maxLength={24} required />
      </Field>
      <MonthYearPicker
        legend="When were they born?"
        name="birth"
        hint="Just the month and the year. We never ask for the day. This sets which courses and tools are suitable for their age."
        maxYear={maxYear}
        minYear={minYear}
        required
        error={form.fieldError("birth")}
      />
      <Field
        label="Username"
        hint={`What they sign in with. 3 to 20 letters, numbers or underscores, and made up: no real name, school, town or birth year.${suggestions.length > 0 ? ` Ideas: ${suggestions.join(", ")}.` : ""}`}
        error={form.fieldError("username")}
      >
        <Input name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} required />
      </Field>
      <Field
        label="Password"
        optional
        hint="Set one now (at least 10 characters), or leave this empty and we'll give you a one-time code so they can choose their own. The code lasts 72 hours."
        error={form.fieldError("password")}
      >
        <PasswordInput name="password" autoComplete="new-password" />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Adding…">
        Add child
      </SubmitButton>
    </ActionForm>
  );
}
