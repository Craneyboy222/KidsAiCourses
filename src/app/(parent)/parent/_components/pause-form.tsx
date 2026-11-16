"use client";

import { ActionForm, Callout, Field, FormError, SubmitButton, Textarea, useActionForm } from "@/components/ui";
import { setPausedAction } from "../children/[id]/actions";

export type PauseFormProps = {
  learnerId: string;
  nickname: string;
  paused: boolean;
  /** The reason given when it was paused, if any. */
  reason: string | null;
  maxReason: number;
};

/** Pause now, with a reason the child will see; or switch the account back on. */
export function PauseForm({ learnerId, nickname, paused, reason, maxReason }: PauseFormProps) {
  const form = useActionForm(setPausedAction);
  const nowPaused = form.data ? form.data.paused : paused;

  return (
    <ActionForm action={form.formAction} aria-label={nowPaused ? `Switch ${nickname}'s account back on` : `Pause ${nickname}'s account`} className="gap-4">
      <FormError {...form.summaryProps} fieldLabels={{ reason: "Reason" }} />
      {form.data?.paused === true && (
        <Callout tone="warning" title={`${nickname}'s account is paused`} live="status">
          <p>They have been signed out everywhere, and we&apos;ve told them in the app. Their work is safe.</p>
        </Callout>
      )}
      {form.data?.paused === false && !form.data.waitingForConsent && (
        <Callout tone="success" title={`${nickname}'s account is back on`} live="status">
          <p>They can sign in and carry on where they left off.</p>
        </Callout>
      )}
      {form.data?.paused === false && form.data.waitingForConsent && (
        <Callout tone="warning" title="Your pause is lifted, but the account is still waiting for permissions" live="status">
          <p>{nickname} can use their account once the permissions it needs have been given.</p>
        </Callout>
      )}
      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="intent" value={nowPaused ? "resume" : "pause"} />

      {nowPaused ? (
        <>
          <p>
            {nickname}&apos;s account is paused. They can sign in and see that it is paused{reason ? `, with your note: “${reason}”` : ""}, but they can&apos;t learn, save or send anything until you switch it back on.
          </p>
          <div>
            <SubmitButton loading={form.pending} pendingText="Switching on…">
              Switch the account back on
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <p>Pausing signs {nickname} out straight away, on every device. Everything they have made is kept, and you can switch the account back on at any time.</p>
          <Field label="Reason" optional hint={`${nickname} will see this, so they know why. Up to ${maxReason} characters.`} error={form.fieldError("reason")} className="max-w-xl">
            <Textarea name="reason" rows={2} maxLength={maxReason} />
          </Field>
          <div>
            <SubmitButton variant="secondary" loading={form.pending} pendingText="Pausing…">
              Pause the account now
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
