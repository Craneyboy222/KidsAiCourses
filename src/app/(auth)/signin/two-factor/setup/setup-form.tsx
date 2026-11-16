"use client";

import { ActionForm, Callout, Field, FormError, Input, PasswordInput, SubmitButton, useActionForm } from "@/components/ui";
import { confirmTwoFactorSetupAction, startTwoFactorSetupAction } from "../../actions";

/** `ABCD EFGH IJKL …`: easier to copy by hand into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * Two parts. First the password, which gives the key for the authenticator app and ten backup
 * codes. Then the first code from the app, which proves it is set up; only then is two-step on.
 */
export function TwoFactorSetupForm({ next }: { next: string }) {
  const start = useActionForm(startTwoFactorSetupAction);
  const confirm = useActionForm(confirmTwoFactorSetupAction);
  const enrolment = start.data;

  if (!enrolment) {
    return (
      <ActionForm action={start.formAction} aria-label="Start two-step set-up">
        <FormError {...(confirm.error ? confirm.summaryProps : start.summaryProps)} />
        <Field label="Your password" hint="We ask again so that nobody else can switch this on for you." error={start.fieldError("password")}>
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton loading={start.pending} pendingText="Starting…" fullWidth>
          Start set-up
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">1. Add this site to your authenticator app</h2>
        <p>In the app, choose to add an account and enter this key by hand.</p>
        <p className="rounded-control border-ink bg-tint border-2 px-3 py-2 font-mono text-lg font-bold break-all" data-testid="totp-secret">
          {grouped(enrolment.secret)}
        </p>
        <p className="text-sm">
          On this device?{" "}
          <a href={enrolment.totpUri} className="link">
            Open my authenticator app
          </a>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">2. Save your backup codes</h2>
        <Callout tone="warning" title="Keep these somewhere safe, away from your phone">
          <p>Each code signs you in once if you lose your phone. This is the only time they are shown.</p>
        </Callout>
        <ul className="rounded-control border-ink bg-surface grid grid-cols-2 gap-x-4 gap-y-1 border-2 p-3 font-mono" aria-label="Backup codes">
          {enrolment.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">3. Enter the code the app shows</h2>
        <ActionForm action={confirm.formAction} aria-label="Confirm your first code">
          <FormError {...confirm.summaryProps} title="That didn't work" />
          <input type="hidden" name="next" value={next} />
          <Field label="Six-digit code" hint="It changes every 30 seconds." error={confirm.fieldError("code")}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={8} required />
          </Field>
          <SubmitButton loading={confirm.pending} pendingText="Checking…" fullWidth>
            Turn on two-step sign-in
          </SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
