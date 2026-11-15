import { useId, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cn";
import { FieldError, firstError, type FieldErrorValue } from "./field";

export type CheckboxProps = Omit<ComponentProps<"input">, "type" | "children"> & {
  label: ReactNode;
  /** Smaller supporting text under the label. */
  description?: ReactNode;
  error?: FieldErrorValue;
};

/** A native checkbox with its label. The whole row is the click target (at least 44 px tall). */
export function Checkbox({ label, description, error, className, id, ...props }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? `${auto}-check`;
  const message = firstError(error);
  const descriptionId = description ? `${auto}-description` : undefined;
  const errorId = message ? `${auto}-error` : undefined;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <FieldError id={errorId}>{message}</FieldError>
      <div className="flex min-h-11 items-start gap-3 py-2">
        <input
          {...props}
          id={inputId}
          type="checkbox"
          className="check mt-0.5"
          aria-describedby={
            [props["aria-describedby"], descriptionId, errorId].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={message ? true : props["aria-invalid"]}
        />
        <div className="flex min-w-0 flex-col">
          <label htmlFor={inputId} className="text-ink font-bold">
            {label}
          </label>
          {description && (
            <span id={descriptionId} className="text-ink-muted text-sm">
              {description}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
