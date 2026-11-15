import type { LucideIcon, LucideProps } from "lucide-react";
import { cx } from "./cn";

const SIZES = { sm: "size-4", md: "size-5", lg: "size-6", xl: "size-8" } as const;

export type IconProps = Omit<LucideProps, "size" | "ref"> & {
  /** A lucide-react icon component, for example `icon={House}`. */
  icon: LucideIcon;
  /** Give a label only when the icon stands alone. Next to visible text, leave it out and the icon is hidden from screen readers. */
  label?: string;
  size?: keyof typeof SIZES;
};

/** Icons come from lucide-react only, sized in rem so they grow with the text-size preference. */
export function Icon({ icon: Glyph, label, size = "md", className, ...props }: IconProps) {
  return (
    <Glyph
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
      strokeWidth={2.25}
      className={cx(SIZES[size], "shrink-0", className)}
      {...props}
    />
  );
}
