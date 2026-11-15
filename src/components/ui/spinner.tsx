import { LoaderCircle } from "lucide-react";
import { cx } from "./cn";

const SIZES = { sm: "size-4", md: "size-5", lg: "size-8" } as const;

type SpinnerProps = {
  /** Read to screen readers, and shown beside the spinner when `showLabel` is set. */
  label?: string;
  showLabel?: boolean;
  size?: keyof typeof SIZES;
  /** Inside a control that already announces its own state (for example a loading Button). */
  decorative?: boolean;
  className?: string;
};

/** A loading indicator with a text label. The spin stops under reduced motion, so the label does the talking. */
export function Spinner({
  label = "Loading",
  showLabel = false,
  size = "md",
  decorative = false,
  className,
}: SpinnerProps) {
  const glyph = (
    <LoaderCircle
      aria-hidden="true"
      focusable="false"
      strokeWidth={2.5}
      className={cx(SIZES[size], "shrink-0 animate-spin")}
    />
  );
  if (decorative) return <span className={cx("inline-flex", className)}>{glyph}</span>;
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 font-bold", className)}>
      {glyph}
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}
