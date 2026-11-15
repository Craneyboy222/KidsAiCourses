import type { ComponentProps } from "react";
import { cx } from "./cn";
import { controlStyles } from "./field";

export type InputProps = ComponentProps<"input">;

/** A text input. Wrap it in Field for the label, hint and error. */
export function Input({ className, type = "text", ...props }: InputProps) {
  return <input type={type} className={cx(controlStyles, className)} {...props} />;
}
