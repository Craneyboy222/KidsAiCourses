"use client";

import { startTransition, type ComponentProps, type FormEvent } from "react";
import { cx } from "./cn";

export type ActionFormProps = Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  /** `form.formAction` from `useActionForm`. */
  action: (formData: FormData) => void;
};

/**
 * `<form action={…}>` that keeps what was typed when the action fails.
 *
 * React clears an uncontrolled form as soon as its action finishes, whatever the result, so a
 * rejected password would also wipe the username beside it. This form sends the same `FormData`
 * to the same action itself, which leaves the fields alone. Without JavaScript it is an ordinary
 * form posting to the Server Action.
 *
 * `useFormStatus` does not see a submission made this way, so pass the pending flag to the
 * button: `<SubmitButton loading={form.pending}>`.
 */
export function ActionForm({ action, className, children, ...props }: ActionFormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    // Passing the button keeps its name and value in the data, as a native submission would.
    const formData = submitter ? new FormData(event.currentTarget, submitter) : new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }
  return (
    <form {...props} action={action} onSubmit={handleSubmit} className={cx("flex flex-col gap-5", className)}>
      {children}
    </form>
  );
}
