import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cx } from "./cn";

export type ProgressBarProps = {
  /** What is being measured, for example "Course progress". */
  label: ReactNode;
  value: number;
  max?: number;
  /** The text equivalent shown beside the bar. Defaults to a percentage; prefer words such as "3 of 8 steps done". */
  valueText?: string;
  hideLabel?: boolean;
  className?: string;
};

/** A progress bar that always comes with its value in text. */
export function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  hideLabel = false,
  className,
}: ProgressBarProps) {
  const id = useId();
  const safeMax = max > 0 ? max : 1;
  const safeValue = Math.min(Math.max(0, value), safeMax);
  const text = valueText ?? `${Math.round((safeValue / safeMax) * 100)}%`;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="text-ink flex items-baseline justify-between gap-3 text-sm font-bold">
        <span id={`${id}-label`} className={hideLabel ? "sr-only" : undefined}>
          {label}
        </span>
        <span aria-hidden="true">{text}</span>
      </div>
      <progress
        className="progress"
        aria-labelledby={`${id}-label`}
        aria-valuetext={text}
        value={safeValue}
        max={safeMax}
      />
    </div>
  );
}

export type StepStatus = "done" | "current" | "upcoming" | "locked";

export type StepperStep = {
  id: string;
  label: ReactNode;
  status: StepStatus;
  /** Makes the step a link. Leave out for locked steps. */
  href?: string;
};

export type StepperProps = {
  steps: StepperStep[];
  orientation?: "vertical" | "horizontal";
  className?: string;
};

const STATUS_WORDS: Record<StepStatus, string> = {
  done: "Done",
  current: "You are here",
  upcoming: "Not started",
  locked: "Locked",
};

/**
 * An ordered list of steps. Each step has a marker with its own shape (tick,
 * filled number, outlined number, padlock) and its status in words for screen readers.
 */
export function Stepper({ steps, orientation = "vertical", className }: StepperProps) {
  return (
    <ol
      className={cx(
        "flex",
        orientation === "vertical" ? "flex-col gap-1" : "flex-row flex-wrap gap-x-4 gap-y-2",
        className,
      )}
    >
      {steps.map((step, index) => {
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cx(
                "border-ink flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                step.status === "done" && "bg-success text-surface",
                step.status === "current" && "bg-ink text-paper",
                step.status === "upcoming" && "bg-surface text-ink",
                step.status === "locked" && "bg-tint text-ink-muted border-dashed",
              )}
            >
              {step.status === "done" ? (
                <Check className="size-4" strokeWidth={3} />
              ) : step.status === "locked" ? (
                <Lock className="size-3.5" strokeWidth={2.5} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cx(
                "min-w-0",
                step.status === "current" && "font-bold",
                step.status === "locked" && "text-ink-muted",
              )}
            >
              <span className="sr-only">Step {index + 1}:</span> {step.label}{" "}
              <span className="sr-only">({STATUS_WORDS[step.status]})</span>
            </span>
          </>
        );
        const rowStyles = "flex min-h-11 items-center gap-3 rounded-control px-2 py-1.5 text-ink";
        return (
          <li key={step.id} aria-current={step.status === "current" ? "step" : undefined}>
            {step.href && step.status !== "locked" ? (
              <Link
                href={step.href}
                className={cx(
                  rowStyles,
                  "hover:bg-tint no-underline hover:underline hover:underline-offset-4",
                )}
              >
                {body}
              </Link>
            ) : (
              <span className={rowStyles}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
