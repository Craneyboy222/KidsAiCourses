import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cn";

export type AiLabelProps = {
  /** The label text. Keep it short and literal. */
  children?: ReactNode;
  /** A plain-English line shown after the label, for example "Coach can get things wrong. Check anything important." */
  detail?: ReactNode;
  className?: string;
};

/**
 * The "AI-generated" label. It must sit with every Coach reply and any other
 * AI output shown to a learner or parent (spec Section 9, transparent AI labelling).
 */
export function AiLabel({ children = "AI-generated", detail, className }: AiLabelProps) {
  return (
    <span className={cx("text-ink inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}>
      <span className="border-ink bg-surface inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 font-bold whitespace-nowrap">
        <Sparkles aria-hidden="true" className="size-4" strokeWidth={2.5} />
        {children}
      </span>
      {detail && <span className="text-ink-muted">{detail}</span>}
    </span>
  );
}
