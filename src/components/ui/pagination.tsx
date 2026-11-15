import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "./button-styles";
import { cx } from "./cn";

export type PaginationProps = {
  /** Current page, starting at 1. */
  page: number;
  pageCount: number;
  /** Link-based paging (works without JavaScript): returns the URL for a page. */
  hrefFor?: (page: number) => string;
  /** Button-based paging, for Client Components that hold the page in state. */
  onPageChange?: (page: number) => void;
  /** What is being paged, for the nav's accessible name: "Courses" gives "Courses pages". */
  label?: string;
  className?: string;
};

/** Which page numbers to show: first, last, the current page and its neighbours. `null` marks a gap. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** Previous and Next, page numbers on wider screens, and "Page 2 of 9" in words on every screen. */
export function Pagination({ page, pageCount, hrefFor, onPageChange, label, className }: PaginationProps) {
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);

  const control = (
    target: number,
    content: React.ReactNode,
    opts: { key?: string; current?: boolean; label?: string; edge?: boolean } = {},
  ) => {
    const className = buttonStyles({
      variant: opts.current ? "primary" : "secondary",
      size: "md",
      className: cx(
        !opts.edge && "min-w-11 px-2 shadow-none active:translate-y-0",
        opts.current && "underline underline-offset-4",
      ),
    });
    const common = {
      "aria-label": opts.label,
      "aria-current": opts.current ? ("page" as const) : undefined,
      className,
      "data-button": "",
    };
    return hrefFor ? (
      <Link key={opts.key} href={hrefFor(target)} {...common}>
        {content}
      </Link>
    ) : (
      <button key={opts.key} type="button" onClick={() => onPageChange?.(target)} {...common}>
        {content}
      </button>
    );
  };

  return (
    <nav
      aria-label={label ? `${label} pages` : "Pagination"}
      className={cx("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <div>
        {current > 1 &&
          control(
            current - 1,
            <>
              <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2.5} />
              Previous
            </>,
            { edge: true },
          )}
      </div>
      <ul className="hidden items-center gap-2 sm:flex">
        {pageWindow(current, pageCount).map((p, i) =>
          p === null ? (
            <li key={`gap-${i}`} aria-hidden="true" className="text-ink-muted px-1 font-bold">
              …
            </li>
          ) : (
            <li key={p}>
              {control(p, p, {
                current: p === current,
                label: p === current ? `Page ${p}, current page` : `Page ${p}`,
              })}
            </li>
          ),
        )}
      </ul>
      <p className="text-ink text-sm font-bold sm:sr-only">
        Page {current} of {pageCount}
      </p>
      <div>
        {current < pageCount &&
          control(
            current + 1,
            <>
              Next
              <ChevronRight aria-hidden="true" className="size-5" strokeWidth={2.5} />
            </>,
            { edge: true },
          )}
      </div>
    </nav>
  );
}
