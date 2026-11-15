import { OctagonAlert } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cx } from "./cn";

export type FormErrorProps = {
  /** The main message: what happened and what to try. Nothing renders while this is empty. */
  message?: ReactNode;
  title?: ReactNode;
  /** Field-level problems from an action result, listed under the message. */
  fieldErrors?: Record<string, string[]>;
  /** Friendly names for field keys, for example `{ dobYear: "Year of birth" }`. */
  fieldLabels?: Record<string, string>;
  /** Set by `useActionForm().summaryProps`: the hook moves focus to this id when the action fails. */
  id?: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
};

/**
 * The error summary at the top of a form. It is focusable (`tabIndex={-1}`) so
 * `useActionForm` can move focus to it, and it is an alert so it is read out.
 * With `useActionForm`: `<FormError {...form.summaryProps} />`.
 */
export function FormError({
  message,
  title = "There's a problem",
  fieldErrors,
  fieldLabels,
  id,
  ref,
  className,
}: FormErrorProps) {
  if (!message) return null;
  const entries = Object.entries(fieldErrors ?? {}).filter(
    ([key, list]) => key !== "_form" && list.length > 0,
  );
  const formLevel = fieldErrors?._form ?? [];
  return (
    <div
      id={id}
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cx("rounded-card border-danger bg-danger-soft text-ink flex gap-3 border-2 p-4", className)}
    >
      <OctagonAlert aria-hidden="true" className="text-danger mt-0.5 size-6 shrink-0" strokeWidth={2.25} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-bold">{title}</p>
        <p>{message}</p>
        {(entries.length > 0 || formLevel.length > 0) && (
          <ul className="mt-1 list-disc pl-5">
            {formLevel.map((text) => (
              <li key={text}>{text}</li>
            ))}
            {entries.map(([key, list]) => (
              <li key={key}>
                {fieldLabels?.[key] ? <span className="font-bold">{fieldLabels[key]}:</span> : null} {list[0]}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
