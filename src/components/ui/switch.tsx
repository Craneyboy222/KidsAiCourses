import { useId, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cn";

export type SwitchProps = Omit<ComponentProps<"input">, "type" | "role" | "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/**
 * An on/off setting that takes effect straight away. It is a native checkbox
 * with `role="switch"`, so it works with the keyboard, in forms and without
 * JavaScript. "On" or "Off" is written next to it: position and colour are not the only cues.
 */
export function Switch({ label, description, className, id, ...props }: SwitchProps) {
  const auto = useId();
  const inputId = id ?? `${auto}-switch`;
  const descriptionId = description ? `${auto}-description` : undefined;
  return (
    <div className={cx("flex min-h-11 items-start justify-between gap-4 py-2", className)}>
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
      <span className="flex shrink-0 items-center gap-2">
        <input
          {...props}
          id={inputId}
          type="checkbox"
          role="switch"
          className="switch peer"
          aria-describedby={[props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined}
        />
        <span aria-hidden="true" className="text-ink w-7 text-sm font-bold peer-checked:hidden">
          Off
        </span>
        <span aria-hidden="true" className="text-ink hidden w-7 text-sm font-bold peer-checked:inline">
          On
        </span>
      </span>
    </div>
  );
}
