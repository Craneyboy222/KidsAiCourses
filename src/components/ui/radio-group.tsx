import { useId, type ChangeEventHandler, type ReactNode } from "react";
import { cx } from "./cn";
import { FieldError, firstError, type FieldErrorValue } from "./field";

export type RadioOption = { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean };

export type RadioGroupProps = {
  /** The question. Rendered as the fieldset legend. */
  legend: ReactNode;
  name: string;
  options: RadioOption[];
  hint?: ReactNode;
  error?: FieldErrorValue;
  /** Uncontrolled initial choice. */
  defaultValue?: string;
  /** Controlled choice. Pair with `onChange` in a Client Component. */
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  required?: boolean;
  /** `stack` (default) for full answers, `row` for short choices such as text sizes. */
  layout?: "stack" | "row";
  hideLegend?: boolean;
  className?: string;
};

/**
 * Native radio buttons in a fieldset. Arrow keys move between options for free,
 * and it posts with a plain `<form action>`.
 */
export function RadioGroup({
  legend,
  name,
  options,
  hint,
  error,
  defaultValue,
  value,
  onChange,
  required,
  layout = "stack",
  hideLegend = false,
  className,
}: RadioGroupProps) {
  const auto = useId();
  const message = firstError(error);
  const hintId = hint ? `${auto}-hint` : undefined;
  const errorId = message ? `${auto}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset aria-describedby={describedBy} className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className={cx("text-ink font-bold", hideLegend && "sr-only")}>{legend}</legend>
      {hint && (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{message}</FieldError>
      <div className={cx("flex", layout === "row" ? "flex-row flex-wrap gap-x-5 gap-y-1" : "flex-col")}>
        {options.map((option, index) => {
          const optionId = `${auto}-option-${index}`;
          const descriptionId = option.description ? `${optionId}-description` : undefined;
          return (
            <div key={option.value} className="flex min-h-11 items-start gap-3 py-2">
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                className="check mt-0.5"
                disabled={option.disabled}
                required={required}
                aria-describedby={descriptionId}
                {...(value !== undefined
                  ? { checked: value === option.value, onChange }
                  : { defaultChecked: defaultValue === option.value, onChange })}
              />
              <div className="flex min-w-0 flex-col">
                <label htmlFor={optionId} className="text-ink">
                  {option.label}
                </label>
                {option.description && (
                  <span id={descriptionId} className="text-ink-muted text-sm">
                    {option.description}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
