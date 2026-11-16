"use client";

import { ActionForm, Callout, Field, FormError, PasswordInput, RadioGroup, SubmitButton, useActionForm } from "@/components/ui";
import { resetPasswordAction } from "../children/[id]/actions";

/**
 * A parent resets their child's password (spec 3.1). Two ways: a one-time code, so the child
 * chooses a password nobody else knows, or a password the parent sets now.
 */
export function ResetPasswordForm({ learnerId, nickname, username }: { learnerId: string; nickname: string; username: string }) {
  const form = useActionForm(resetPasswordAction);
  const done = form.data;

  if (done?.mode === "code") {
    return (
      <Callout tone="success" title="The old password no longer works" live="status">
        <p>
          Give {nickname} this one-time code. They enter it at <strong>/join</strong> with their username, <strong>{username}</strong>, and choose a new password:
        </p>
        <p className="rounded-control border-ink bg-surface w-fit border-2 px-4 py-2 font-mono text-2xl font-bold tracking-widest" data-testid="reset-code">
          {done.code}
        </p>
        <p>It works once, until {done.expiresOn}. We&apos;ve also emailed it to you, because this is the only time it is shown here. They have been signed out everywhere.</p>
      </Callout>
    );
  }
  if (done?.mode === "password") {
    return (
      <Callout tone="success" title="The new password is set" live="status">
        <p>
          {nickname} has been signed out everywhere. They sign in with their username, <strong>{username}</strong>, and the password you chose.
        </p>
      </Callout>
    );
  }

  return (
    <ActionForm action={form.formAction} aria-label={`Reset ${nickname}'s password`} className="gap-4">
      <FormError {...form.summaryProps} fieldLabels={{ password: "New password" }} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <RadioGroup
        legend="How would you like to reset it?"
        name="mode"
        defaultValue="code"
        options={[
          { value: "code", label: "Give them a one-time code", description: `${nickname} chooses their own new password. Best if you are not together right now.` },
          { value: "password", label: "Set a new password myself", description: "Type it below, then tell them what it is." },
        ]}
      />
      <Field label="New password" optional hint="Only needed if you are setting it yourself. At least 10 characters; a few unrelated words work well." error={form.fieldError("password")} className="max-w-md">
        <PasswordInput name="password" autoComplete="new-password" />
      </Field>
      <p className="text-ink-muted text-sm">Either way, the old password stops working now and {nickname} is signed out on every device. We can never show you their current password.</p>
      <div>
        <SubmitButton variant="secondary" loading={form.pending} pendingText="Resetting…">
          Reset password
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
