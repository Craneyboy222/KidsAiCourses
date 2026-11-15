import type { ComponentProps, ElementType } from "react";
import { cx } from "./cn";

type VisuallyHiddenProps = ComponentProps<"span"> & { as?: ElementType };

/** Text for screen readers only. Still read aloud, never shown. */
export function VisuallyHidden({ as: Tag = "span", className, ...props }: VisuallyHiddenProps) {
  return <Tag className={cx("sr-only", className)} {...props} />;
}
