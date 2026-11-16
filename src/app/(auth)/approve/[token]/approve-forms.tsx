"use client";

import { ActionForm, Checkbox, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { approveTeenAction, createParentForApprovalAction, declineTeenAction } from "./actions";

/** For a parent with no account yet. The email address is the one the link was sent to: it is never typed here. */
export function CreateParentForm({ token }: { token: string }) {
  const form = useActionForm(createParentForApprovalAction);
  return (
    <ActionForm action={form.formAction} aria-label="Create your parent account">
      <FormError {...form.summaryProps} fieldLabels={{ password: "Password", confirmedAdult: "Confirmation", name: "Your name" }} />
      <input type="hidden" name="token" value={token} />
      <Field label="Your name" optional hint="What we call you in emails. A first name is fine." error={form.fieldError("name")}>
        <Input name="name" autoComplete="given-name" maxLength={80} />
      </Field>
      <Field label="Choose a password" hint="At least 10 characters. Three random words work well." error={form.fieldError("password")}>
        <PasswordInput name="password" autoComplete="new-password" required />
      </Field>
      <Checkbox
        name="confirmedAdult"
        required
        label="I am 18 or over, and I am this child's parent or carer"
        description="Family accounts can only be created by an adult who is responsible for the child."
        error={form.fieldError("confirmedAdult")}
      />
      <SubmitButton loading={form.pending} pendingText="Creating your account…" fullWidth>
        Create my account and continue
      </SubmitButton>
    </ActionForm>
  );
}

/** The signed-in parent's "yes". */
export function ApproveForm({ token, username }: { token: string; username: string }) {
  const form = useActionForm(approveTeenAction);
  return (
    <ActionForm action={form.formAction} aria-label="Approve this account">
      <FormError {...form.summaryProps} title="We couldn't approve that" />
      <input type="hidden" name="token" value={token} />
      <SubmitButton loading={form.pending} pendingText="Approving…" fullWidth>
        Yes, add {username} to my family
      </SubmitButton>
    </ActionForm>
  );
}

/** "No": deletes the pending account. One extra tick, because it cannot be undone. */
export function DeclineForm({ token }: { token: string }) {
  const form = useActionForm(declineTeenAction);
  return (
    <ActionForm action={form.formAction} aria-label="Decline this request">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="token" value={token} />
      <Checkbox name="confirm" required label="Yes, delete this account" description="This can't be undone. They would need to sign up again." error={form.fieldError("confirm")} />
      <SubmitButton loading={form.pending} variant="danger" pendingText="Deleting…">
        Decline and delete the account
      </SubmitButton>
    </ActionForm>
  );
}
