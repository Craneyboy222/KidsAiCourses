import { CircleAlert } from "lucide-react";
import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "./cn";

/** Accepts the `fieldErrors[name]` array from an action result, or a single message. */
export type FieldErrorValue = string | string[] | null | undefined;

export function firstError(error: FieldErrorValue): string | undefined {
  const value = Array.isArray(error) ? error[0] : error;
  return value ? value : undefined;
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
};

export type FieldProps = {
  label: ReactNode;
  /** Help text shown under the label and read out with the control. */
  hint?: ReactNode;
  error?: FieldErrorValue;
  /** Adds "(optional)" to the label. Fields are required unless marked. */
  optional?: boolean;
  /** Keeps the label for screen readers but hides it on screen. Use sparingly, for example a search box with a visible button. */
  hideLabel?: boolean;
  /** Exactly one control: Input, PasswordInput, Textarea, Select or any element that accepts `id` and `aria-*`. */
  children: ReactElement;
  className?: string;
};

/**
 * Wires a label, hint and error to one control: `htmlFor`/`id`,
 * `aria-describedby` (hint then error) and `aria-invalid`. Works in Server
 * Components: it has no state, only `useId`.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  hideLabel = false,
  children,
  className,
}: FieldProps) {
  const auto = useId();
  const child = Children.only(children) as ReactElement<ControlProps>;
  if (!isValidElement(child)) throw new Error("Field needs exactly one control element as its child.");

  const controlId = child.props.id ?? `${auto}-control`;
  const message = firstError(error);
  const hintId = hint ? `${auto}-hint` : undefined;
  const errorId = message ? `${auto}-error` : undefined;
  const describedBy =
    [child.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cx("text-ink font-bold", hideLabel && "sr-only")}>
        {label}
        {optional && " "}
        {optional && <span className="text-ink-muted font-normal">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{message}</FieldError>
      {cloneElement(child, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": message ? true : child.props["aria-invalid"],
      })}
    </div>
  );
}

/** The inline error under a label: icon plus text, prefixed "Error:" for screen readers. */
export function FieldError({
  id,
  children,
  className,
}: {
  id?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} className={cx("text-danger flex items-start gap-1.5 text-sm font-bold", className)}>
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
      <span>
        <span className="sr-only">Error:</span> {children}
      </span>
    </p>
  );
}

/** Shared look for text-like controls. */
export const controlStyles =
  "block w-full min-h-11 rounded-control border-2 border-ink bg-surface px-3 py-2 text-base text-ink " +
  "placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-tint disabled:text-ink-muted " +
  "aria-invalid:border-danger aria-invalid:shadow-[inset_0_0_0_1px_var(--danger)]";
