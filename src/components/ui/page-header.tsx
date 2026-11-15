import type { ReactNode } from "react";
import { cx } from "./cn";

export type PageHeaderProps = {
  /** The page's one and only `<h1>`. */
  title: ReactNode;
  description?: ReactNode;
  /** Usually `<Breadcrumbs />`. */
  breadcrumbs?: ReactNode;
  /** Small line above the title, for example a category or a status badge. */
  eyebrow?: ReactNode;
  /** Buttons for the page's main actions. */
  actions?: ReactNode;
  className?: string;
};

/** The top of a page: breadcrumbs, the h1, a short description and the main actions. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx("flex flex-col gap-3", className)}>
      {breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow && (
            <div className="text-ink-muted flex flex-wrap items-center gap-2 text-sm font-bold">
              {eyebrow}
            </div>
          )}
          <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
          {description && <p className="max-w-measure text-ink-muted text-lg">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
