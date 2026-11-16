"use client";

import { ActionForm, FormError, SubmitButton, useActionForm } from "@/components/ui";
import { markNoticesReadAction } from "../notices/actions";

/** "Mark as read" for one notice, or for all of them when `id` is `all`. */
export function MarkReadForm({ id, label, describedBy }: { id: string; label: string; describedBy?: string }) {
  const form = useActionForm(markNoticesReadAction);
  return (
    <ActionForm action={form.formAction}>
      <FormError {...form.summaryProps} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant={id === "all" ? "secondary" : "ghost"} size="sm" loading={form.pending} pendingText="Saving…" aria-describedby={describedBy}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
