import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cn";

const TONES = {
  info: { box: "border-info bg-info-soft", icon: "text-info", Glyph: Info, word: "Information" },
  success: {
    box: "border-success bg-success-soft",
    icon: "text-success",
    Glyph: CircleCheck,
    word: "Success",
  },
  warning: {
    box: "border-warning bg-warning-soft",
    icon: "text-warning",
    Glyph: TriangleAlert,
    word: "Warning",
  },
  danger: {
    box: "border-danger bg-danger-soft",
    icon: "text-danger",
    Glyph: OctagonAlert,
    word: "Important",
  },
} as const;

export type CalloutTone = keyof typeof TONES;

export type CalloutProps = {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons or links shown under the text. */
  actions?: ReactNode;
  /**
   * Set when the callout appears in response to something the person just did,
   * so it is announced: `status` waits its turn, `alert` interrupts.
   */
  live?: "status" | "alert";
  className?: string;
};

/** A message block. Every tone has its own icon shape and a spoken prefix, so colour is never the only cue. */
export function Callout({ tone = "info", title, children, actions, live, className }: CalloutProps) {
  const { box, icon, Glyph, word } = TONES[tone];
  return (
    <div role={live} className={cx("rounded-card text-ink flex gap-3 border-2 p-4", box, className)}>
      <Glyph aria-hidden="true" className={cx("mt-0.5 size-6 shrink-0", icon)} strokeWidth={2.25} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{word}:</span>
        {title && <p className="font-bold">{title}</p>}
        {children && <div className="flex flex-col gap-2">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-3">{actions}</div>}
      </div>
    </div>
  );
}
