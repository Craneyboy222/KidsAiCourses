import { useId, type ReactNode } from "react";
import { cx } from "./cn";
import { FieldError, firstError, type FieldErrorValue } from "./field";
import { Select } from "./select";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type MonthYearPickerProps = {
  /** The question, for example "When were you born?". Rendered as the fieldset legend. */
  legend: ReactNode;
  /** Field name prefix. Posts `${name}Month` (1–12) and `${name}Year`. */
  name: string;
  /** Latest year offered, usually the current year. Passed in so the component never reads the clock. */
  maxYear: number;
  /** Earliest year offered. */
  minYear: number;
  hint?: ReactNode;
  error?: FieldErrorValue;
  defaultMonth?: number;
  defaultYear?: number;
  required?: boolean;
  /** For date of birth: lets the browser offer to fill it in. */
  autoComplete?: "bday" | "off";
  className?: string;
};

/**
 * Month and year as two native selects. Used for date of birth: we only ever
 * ask for the month and year, never the day.
 */
export function MonthYearPicker({
  legend,
  name,
  maxYear,
  minYear,
  hint,
  error,
  defaultMonth,
  defaultYear,
  required,
  autoComplete = "off",
  className,
}: MonthYearPickerProps) {
  const auto = useId();
  const message = firstError(error);
  const hintId = hint ? `${auto}-hint` : undefined;
  const errorId = message ? `${auto}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  return (
    <fieldset aria-describedby={describedBy} className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className="text-ink font-bold">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{message}</FieldError>
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label htmlFor={`${auto}-month`} className="text-ink text-sm">
            Month
          </label>
          <Select
            id={`${auto}-month`}
            name={`${name}Month`}
            placeholder="Choose a month"
            defaultValue={defaultMonth ? String(defaultMonth) : ""}
            required={required}
            aria-invalid={message ? true : undefined}
            autoComplete={autoComplete === "bday" ? "bday-month" : "off"}
            options={MONTHS.map((label, i) => ({ value: String(i + 1), label }))}
          />
        </div>
        <div className="flex min-w-32 flex-1 flex-col gap-1">
          <label htmlFor={`${auto}-year`} className="text-ink text-sm">
            Year
          </label>
          <Select
            id={`${auto}-year`}
            name={`${name}Year`}
            placeholder="Choose a year"
            defaultValue={defaultYear ? String(defaultYear) : ""}
            required={required}
            aria-invalid={message ? true : undefined}
            autoComplete={autoComplete === "bday" ? "bday-year" : "off"}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
      </div>
    </fieldset>
  );
}
