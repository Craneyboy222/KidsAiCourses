"use client";

import { ActionForm, Callout, Checkbox, Field, FormError, Input, SubmitButton, useActionForm } from "@/components/ui";
import { cancelDeletionAction, deleteChildAction, deleteFamilyAction, requestExportAction } from "../privacy/actions";

/** Asks for a download of one child's data. */
export function ExportForm({ learnerId, nickname, inProgress }: { learnerId: string; nickname: string; inProgress: boolean }) {
  const form = useActionForm(requestExportAction);
  if (form.succeeded || inProgress) {
    return (
      <p role="status" className="font-bold">
        We&apos;re putting {nickname}&apos;s download together. We&apos;ll email you when it&apos;s ready, usually within a few minutes.
      </p>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label={`Download ${nickname}'s data`}>
      <FormError {...form.summaryProps} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <div>
        <SubmitButton variant="secondary" loading={form.pending} pendingText="Asking…">
          Download {nickname}&apos;s data
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Starts the 14-day deletion of one child's account. */
export function DeleteChildForm({ learnerId, nickname, undoDays }: { learnerId: string; nickname: string; undoDays: number }) {
  const form = useActionForm(deleteChildAction);
  if (form.data) {
    return (
      <Callout tone="warning" title={`${nickname}'s account will be deleted on ${form.data.deleteOn}`} live="status">
        <p>The account is closed now and they have been signed out. Nothing has been deleted yet: you can undo this from this page until that date. We&apos;ve emailed you a confirmation.</p>
      </Callout>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label={`Delete ${nickname}'s account`} className="gap-3">
      <FormError {...form.summaryProps} fieldLabels={{ confirm: "Confirmation" }} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <Checkbox
        name="confirm"
        label={`I have read what will be deleted, and I want to delete ${nickname}'s account`}
        description={`It closes straight away. You then have ${undoDays} days to change your mind.`}
        error={form.fieldError("confirm")}
      />
      <div>
        <SubmitButton variant="danger" loading={form.pending} pendingText="Starting…">
          Delete {nickname}&apos;s account
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Starts the 14-day deletion of the whole family account. */
export function DeleteFamilyForm({ undoDays }: { undoDays: number }) {
  const form = useActionForm(deleteFamilyAction);
  if (form.data) {
    return (
      <Callout tone="warning" title={`Your family account will be deleted on ${form.data.deleteOn}`} live="status">
        <p>
          Your children&apos;s accounts are closed now. You can still sign in until that date, and undo this from this page. Nothing has been deleted yet. We&apos;ve emailed you a confirmation.
        </p>
      </Callout>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label="Delete the whole family account" className="gap-3">
      <FormError {...form.summaryProps} fieldLabels={{ confirm: "Confirmation", confirmWord: "Type DELETE" }} />
      <Checkbox
        name="confirm"
        label="I have read what will be deleted, and I want to delete my family account and every child's account in it"
        description={`Children's accounts close straight away. You then have ${undoDays} days to change your mind.`}
        error={form.fieldError("confirm")}
      />
      <Field label="Type DELETE to confirm" error={form.fieldError("confirmWord")} className="max-w-xs">
        <Input name="confirmWord" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </Field>
      <div>
        <SubmitButton variant="danger" loading={form.pending} pendingText="Starting…">
          Delete the whole family account
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Undo a deletion that is still inside its window. */
export function UndoDeletionForm({ requestId, label }: { requestId: string; label: string }) {
  const form = useActionForm(cancelDeletionAction);
  if (form.succeeded) {
    return (
      <p role="status" className="font-bold">
        Cancelled. Nothing was deleted.
      </p>
    );
  }
  return (
    <ActionForm action={form.formAction} aria-label={label}>
      <FormError {...form.summaryProps} />
      <input type="hidden" name="requestId" value={requestId} />
      <div>
        <SubmitButton loading={form.pending} pendingText="Cancelling…">
          {label}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
