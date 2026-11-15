import type { ComponentProps } from "react";
import { cx } from "./cn";
import { controlStyles } from "./field";

export type TextareaProps = ComponentProps<"textarea">;

/** A multi-line text box. Wrap it in Field for the label, hint and error. */
export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return <textarea rows={rows} className={cx(controlStyles, "min-h-24 resize-y", className)} {...props} />;
}
