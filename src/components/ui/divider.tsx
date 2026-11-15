import type { ReactNode } from "react";
import { cx } from "./cn";

export type DividerProps = {
  /** Optional words in the middle of the line, for example "or". */
  label?: ReactNode;
  className?: string;
};

/** A horizontal rule between groups of content. */
export function Divider({ label, className }: DividerProps) {
  if (!label) return <hr className={cx("border-line border-0 border-t-2", className)} />;
  return (
    <div
      role="separator"
      className={cx("text-ink-muted flex items-center gap-3 text-sm font-bold", className)}
    >
      <span aria-hidden="true" className="bg-line h-0.5 flex-1" />
      {label}
      <span aria-hidden="true" className="bg-line h-0.5 flex-1" />
    </div>
  );
}
