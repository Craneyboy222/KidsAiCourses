import type { ReactNode } from "react";
import { cx } from "./cn";

const TONES = {
  neutral: "border-ink bg-surface text-ink",
  info: "border-info bg-info-soft text-ink",
  success: "border-success bg-success-soft text-ink",
  warning: "border-warning bg-warning-soft text-ink",
  danger: "border-danger bg-danger-soft text-ink",
  accent: "border-ink bg-accent text-on-accent",
  solid: "border-ink bg-ink text-paper",
} as const;

export type BadgeTone = keyof typeof TONES;

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  /** Usually `<Icon icon={...} size="sm" />`. Status badges should have one: colour is never the only cue. */
  icon?: ReactNode;
  className?: string;
};

/** A small status label. The words carry the meaning; the tone only supports them. */
export function Badge({ children, tone = "neutral", icon, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-sm font-bold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
