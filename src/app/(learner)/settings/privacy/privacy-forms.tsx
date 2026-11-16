"use client";

import { ActionForm, Callout, Checkbox, Field, FormError, Input, SubmitButton, useActionForm } from "@/components/ui";
import { deleteOwnAccountAction, keepOwnAccountAction, requestOwnExportAction } from "./actions";

export function OwnExportForm({ inProgress }: { inProgress: boolean }) {
  const form = useActionForm(requestOwnExportAction);
  if (form.succeeded || inProgress) {
    return (
      <p role="status" className="font-bold">
        We&apos;re putting your download together. It will appear on this page when it&apos;s ready, usually within a few minutes.
      </p>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Download my data">
      <FormError {...form.summaryProps} />
      <div>
        <SubmitButton variant="secondary" loading={form.pending} pendingText="Asking…">
          Download my data
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteOwnAccountForm({ undoDays }: { undoDays: number }) {
  const form = useActionForm(deleteOwnAccountAction);
  if (form.data) {
    return (
      <Callout tone="warning" title={`Your account will be deleted on ${form.data.deleteOn}`} live="status">
        <p>Nothing has been deleted yet. You can still sign in until that date and undo this from this page.</p>
      </Callout>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Delete my account" className="gap-3">
      <FormError {...form.summaryProps} fieldLabels={{ confirm: "Confirmation", confirmWord: "Type DELETE" }} />
      <Checkbox name="confirm" label="I've read what will be deleted, and I want to delete my account" description={`You then have ${undoDays} days to change your mind.`} error={form.fieldError("confirm")} />
      <Field label="Type DELETE to confirm" error={form.fieldError("confirmWord")} className="max-w-xs">
        <Input name="confirmWord" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </Field>
      <div>
        <SubmitButton variant="danger" loading={form.pending} pendingText="Starting…">
          Delete my account
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function KeepOwnAccountForm({ requestId }: { requestId: string }) {
  const form = useActionForm(keepOwnAccountAction);
  if (form.succeeded) {
    return (
      <p role="status" className="font-bold">
        Cancelled. Nothing was deleted, and your account is open again.
      </p>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Keep my account">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="requestId" value={requestId} />
      <div>
        <SubmitButton loading={form.pending} pendingText="Cancelling…">
          Keep my account
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
