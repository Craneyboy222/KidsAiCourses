"use client";

import { ActionForm, Field, FormError, Input, SubmitButton, useActionForm } from "@/components/ui";
import { verifyTwoFactorAction } from "../actions";

/** One box for the code. `one-time-code` lets password managers and phones fill it in. */
export function TwoFactorForm({ next, method }: { next: string; method: "totp" | "backup" }) {
  const form = useActionForm(verifyTwoFactorAction);
  return (
    <ActionForm action={form.formAction} aria-label="Two-step code">
      <FormError {...form.summaryProps} title="That didn't work" />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="method" value={method} />
      {method === "totp" ? (
        <Field label="Six-digit code" hint="It changes every 30 seconds." error={form.fieldError("code")}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={8} required />
        </Field>
      ) : (
        <Field label="Backup code" error={form.fieldError("code")}>
          <Input name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} required />
        </Field>
      )}
      <SubmitButton loading={form.pending} pendingText="Checking…" fullWidth>
        Continue
      </SubmitButton>
    </ActionForm>
  );
}
