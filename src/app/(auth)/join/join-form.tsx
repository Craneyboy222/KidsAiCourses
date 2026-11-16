"use client";

import { ActionForm, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { redeemInviteAction } from "./actions";

/** Code, username and a new password. Used at `/join` and, with the code filled in, at `/join/[inviteCode]`. */
export function JoinForm({ code = "" }: { code?: string }) {
  const form = useActionForm(redeemInviteAction);
  return (
    <ActionForm action={form.formAction} aria-label="Join with a code">
      <FormError {...form.summaryProps} fieldLabels={{ code: "Code", username: "Username", password: "New password" }} />
      <Field label="Your code" hint="8 letters and numbers, like ABCD-EFGH. Capitals and the dash don't matter." error={form.fieldError("code")}>
        <Input name="code" defaultValue={code} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} required />
      </Field>
      <Field label="Your username" hint="The one your parent or carer chose with you." error={form.fieldError("username")}>
        <Input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      </Field>
      <Field label="Choose a password" hint="At least 10 characters. Three random words work well. Keep it to yourself." error={form.fieldError("password")}>
        <PasswordInput name="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton loading={form.pending} pendingText="Setting your password…" fullWidth>
        Set my password and sign in
      </SubmitButton>
    </ActionForm>
  );
}
