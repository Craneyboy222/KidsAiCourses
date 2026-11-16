"use client";

import { ConsentFields, type ConsentFieldItem } from "@/app/(auth)/_components/consent-fields";
import { ActionForm, Callout, Checkbox, FormError, SubmitButton, useActionForm } from "@/components/ui";
import { saveConsentsAction } from "../../actions";

export type ConsentFormProps = {
  learnerId: string;
  nickname: string;
  from: "approval" | "";
  /** The account is active: withdrawing a needed permission would pause it. */
  accountInUse: boolean;
  items: ConsentFieldItem[];
};

/** The consent centre form for one child. */
export function ConsentForm({ learnerId, nickname, from, accountInUse, items }: ConsentFormProps) {
  const form = useActionForm(saveConsentsAction);
  const saved = form.data;

  return (
    <ActionForm action={form.formAction} aria-label={`${nickname}'s permissions`} className="gap-6">
      <FormError {...form.summaryProps} fieldLabels={{ confirmPause: "Confirmation" }} />
      {saved?.activated && (
        <Callout tone="success" title={`${nickname}'s account is ready`} live="status">
          <p>Thank you. They can sign in and get started, and we&apos;ve let them know.</p>
        </Callout>
      )}
      {saved?.paused && (
        <Callout tone="warning" title={`${nickname}'s account is now paused`} live="status">
          <p>They have been signed out, and we&apos;ve told them why in the app. Their work is safe. Give the permission again at any time to switch the account back on.</p>
        </Callout>
      )}
      {saved && !saved.activated && !saved.paused && (
        <Callout tone={saved.missingRequired.length > 0 ? "warning" : "success"} title={saved.missingRequired.length > 0 ? "Saved, but the account is still locked" : "Saved"} live="status">
          <p>
            {saved.missingRequired.length > 0
              ? `${saved.missingRequired.length === 1 ? "One needed permission is" : `${saved.missingRequired.length} needed permissions are`} still to be given. Tick ${saved.missingRequired.length === 1 ? "it" : "each one"} below and save again.`
              : "Your choices have been recorded."}
          </p>
        </Callout>
      )}

      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="from" value={from} />
      <ConsentFields audience="parent" fieldError={form.fieldError} items={items} />

      {accountInUse && (
        <div className="rounded-card border-line flex flex-col gap-1 border-2 p-4">
          <p className="font-bold">Withdrawing a needed permission</p>
          <p className="text-ink-muted">
            If you untick one of the three needed permissions, {nickname}&apos;s account is paused and they are signed out straight away. Their work is kept. Tick the box below to confirm that is what you want.
          </p>
          <Checkbox name="confirmPause" label={`Yes, pause ${nickname}'s account`} description="Only needed if you are unticking a needed permission." error={form.fieldError("confirmPause")} />
        </div>
      )}

      <SubmitButton loading={form.pending} pendingText="Saving…">
        Save permissions
      </SubmitButton>
    </ActionForm>
  );
}
