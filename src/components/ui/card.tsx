import type { ComponentProps, ElementType } from "react";
import { cx } from "./cn";

const VARIANTS = {
  /** The default: chunky 2 px ink outline. */
  outline: "border-2 border-ink bg-surface",
  /** Outline plus the flat offset shadow. For the things you want picked up first. */
  raised: "border-2 border-ink bg-surface shadow-raised",
  /** Hairline only. For dense Studio screens and nested groups. */
  plain: "border border-line bg-surface",
  /** Highlighter block. Ink text only. */
  accent: "border-2 border-ink bg-accent text-on-accent",
  /** Quiet tinted panel with no outline. */
  tint: "border-2 border-transparent bg-tint",
} as const;

const PADDING = { none: "", sm: "p-3", md: "p-5", lg: "p-6 sm:p-8" } as const;

export type CardProps = ComponentProps<"div"> & {
  as?: ElementType;
  variant?: keyof typeof VARIANTS;
  padding?: keyof typeof PADDING;
};

/** The basic surface. Pick `as="section"`, `"article"` or `"li"` to match the content. */
export function Card({
  as: Tag = "div",
  variant = "outline",
  padding = "md",
  className,
  ...props
}: CardProps) {
  return (
    <Tag className={cx("rounded-card text-ink", VARIANTS[variant], PADDING[padding], className)} {...props} />
  );
}

type CardTitleProps = ComponentProps<"h2"> & { as?: "h2" | "h3" | "h4" };

export function CardTitle({ as: Tag = "h2", className, ...props }: CardTitleProps) {
  return <Tag className={cx("text-xl font-bold", className)} {...props} />;
}
