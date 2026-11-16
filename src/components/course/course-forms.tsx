"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { startCourseAction, toggleSavedAction } from "@/app/(learner)/explore/actions";
import { FormError, SubmitButton, useActionForm } from "@/components/ui";

/** The Start button. The server runs the whole start gate; if it says no, the reason is shown here. */
export function StartCourseForm({ slug, label = "Start this project" }: { slug: string; label?: string }) {
  const form = useActionForm(startCourseAction);
  return (
    <form action={form.formAction} className="flex flex-col gap-3">
      <FormError {...form.summaryProps} title="This project can't be started right now" />
      <input type="hidden" name="slug" value={slug} />
      <div>
        <SubmitButton size="lg" pendingText="Getting it ready…">
          {label}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Save for later, and its opposite. A toggle button with its state in words and in `aria-pressed`. */
export function SaveForLaterForm({ courseId, slug, saved }: { courseId: string; slug: string; saved: boolean }) {
  const form = useActionForm(toggleSavedAction);
  const isSaved = form.data ? form.data.saved : saved;
  return (
    <form action={form.formAction} className="flex flex-col gap-2">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="save" value={isSaved ? "0" : "1"} />
      <div>
        <SubmitButton
          variant="secondary"
          aria-pressed={isSaved}
          pendingText="Saving…"
          iconStart={isSaved ? <BookmarkCheck aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} /> : <Bookmark aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />}
        >
          {isSaved ? "Saved for later" : "Save for later"}
        </SubmitButton>
      </div>
    </form>
  );
}
