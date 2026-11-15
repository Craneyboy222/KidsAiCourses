import type { ReactNode } from "react";
import { cx } from "./cn";

export type EmptyStateProps = {
  title: ReactNode;
  /** Say what will appear here and what to do next. */
  description?: ReactNode;
  /** Usually `<Icon icon={...} size="xl" />`. */
  icon?: ReactNode;
  /** The one obvious next step. */
  action?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
};

/** Shown when a list has nothing in it yet. Always offers a way forward. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "rounded-card border-ink bg-surface text-ink flex flex-col items-center gap-3 border-2 border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span className="border-ink bg-accent text-on-accent flex size-14 items-center justify-center rounded-full border-2">
          {icon}
        </span>
      )}
      <Heading className="text-xl font-bold">{title}</Heading>
      {description && <p className="text-ink-muted max-w-prose">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
