import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cx } from "./cn";
import { controlStyles } from "./field";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = ComponentProps<"select"> & {
  /** Either pass `options`, or `<option>` children. */
  options?: SelectOption[];
  /** A first, empty choice such as "Choose a month". */
  placeholder?: string;
};

/**
 * The native `<select>`, styled. Native is deliberate: it is the most reliable
 * picker on Chromebooks, phones and with screen readers.
 */
export function Select({ options, placeholder, className, children, ...props }: SelectProps) {
  return (
    <span className="relative block w-full">
      <select className={cx(controlStyles, "appearance-none pr-10", className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-ink pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2"
        strokeWidth={2.5}
      />
    </span>
  );
}
