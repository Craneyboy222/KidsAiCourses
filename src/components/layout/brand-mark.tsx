import Link from "next/link";
import { cx } from "@/components/ui/cn";
import { BRAND_NAME } from "@/lib/brand";

/** The abstract mark: three overlapping workshop shapes. No text, no face. Matches public/icons/icon.svg. */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cx("size-9 shrink-0", className)}
    >
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="11"
        className="fill-primary stroke-ink"
        strokeWidth="2.5"
      />
      <circle cx="19" cy="28" r="10" className="fill-accent stroke-ink" strokeWidth="2.5" />
      <rect
        x="24"
        y="11"
        width="14"
        height="14"
        rx="3"
        transform="rotate(12 31 18)"
        className="fill-surface stroke-ink"
        strokeWidth="2.5"
      />
    </svg>
  );
}

export type BrandMarkProps = {
  /** Where the mark links to: the home of the current area. */
  href?: string;
  /** Hide the name on narrow screens to save room. The link keeps its accessible name. */
  compact?: boolean;
  className?: string;
};

/** The mark plus the brand name, linking to the home of the current area. The name comes from `BRAND_NAME` only. */
export function BrandMark({ href = "/", compact = false, className }: BrandMarkProps) {
  return (
    <Link
      href={href}
      data-button=""
      className={cx(
        "rounded-control text-ink inline-flex min-h-11 items-center gap-2 text-lg font-bold no-underline",
        className,
      )}
    >
      <BrandGlyph />
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{BRAND_NAME}</span>{" "}
      <span className="sr-only">home</span>
    </Link>
  );
}
