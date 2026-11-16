"use client";

import { ActionForm, Callout, FormError, SubmitButton, useActionForm } from "@/components/ui";
import { resendApprovalAction } from "../../actions";

/** "Send the email again": twice at most, and the 7-day deadline does not move. */
export function ResendApprovalForm({ emailsSent, canResend }: { emailsSent: number; canResend: boolean }) {
  const form = useActionForm(resendApprovalAction);
  const sent = form.data?.emailsSent ?? emailsSent;
  const allowed = form.data ? form.data.emailsSent < 3 : canResend;

  return (
    <ActionForm action={form.formAction} aria-label="Send the email again">
      <FormError {...form.summaryProps} />
      {form.succeeded && (
        <Callout tone="success" live="status" title="Sent again">
          <p>We&apos;ve emailed your parent or carer a new link. Any earlier link has stopped working.</p>
        </Callout>
      )}
      {allowed ? (
        <SubmitButton loading={form.pending} variant="secondary" pendingText="Sending…">
          Send the email again
        </SubmitButton>
      ) : (
        <p className="text-ink-muted">We&apos;ve sent the email {sent} times, which is the most we can send. Ask them to check their inbox and junk folder.</p>
      )}
    </ActionForm>
  );
}
