import type { ReactNode } from "react";
import { cx } from "./cn";

const TONES = {
  accent: "bg-accent text-on-accent",
  primary: "bg-primary text-on-primary",
  surface: "bg-surface text-ink",
  "cat-1": "bg-cat-1 text-on-cat",
  "cat-2": "bg-cat-2 text-on-cat",
  "cat-3": "bg-cat-3 text-on-cat",
  "cat-4": "bg-cat-4 text-on-cat",
  "cat-5": "bg-cat-5 text-on-cat",
  "cat-6": "bg-cat-6 text-on-cat",
} as const;

const TILT = { left: "-rotate-3", right: "rotate-2", none: "" } as const;

export type StickerProps = {
  children: ReactNode;
  tone?: keyof typeof TONES;
  /** Stickers sit slightly askew, like one slapped on a laptop. */
  tilt?: keyof typeof TILT;
  icon?: ReactNode;
  className?: string;
};

/** The sticker-style badge: thick ink outline, flat shadow, a little tilt. For achievements and "New" flags in learner screens. */
export function Sticker({ children, tone = "accent", tilt = "left", icon, className }: StickerProps) {
  return (
    <span
      className={cx(
        "border-ink shadow-raised inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold",
        TONES[tone],
        TILT[tilt],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
