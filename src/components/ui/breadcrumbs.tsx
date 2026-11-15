import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cx } from "./cn";

export type Crumb = { label: string; href?: string };

export type BreadcrumbsProps = {
  /** Accessible name of the nav. Change it only if a page has more than one breadcrumb trail. */
  label?: string;
  /** From the top level down. The last item is the current page and is not a link. */
  items: Crumb[];
  className?: string;
};

/** Shows where a page sits. The current page is marked with `aria-current="page"`. */
export function Breadcrumbs({ items, label = "Breadcrumb", className }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight aria-hidden="true" className="text-ink-muted size-4 shrink-0" />}
              {last || !item.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cx("py-1", last ? "text-ink font-bold" : "text-ink-muted")}
                >
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="link inline-flex min-h-6 items-center py-1 font-normal">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
