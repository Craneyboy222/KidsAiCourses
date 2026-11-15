import { cx } from "./cn";

type SkipLinkProps = { href?: string; children?: React.ReactNode; className?: string };

/** First focusable thing on every page: jumps keyboard users past the navigation. */
export function SkipLink({ href = "#main", children = "Skip to main content", className }: SkipLinkProps) {
  return (
    <a
      href={href}
      data-button=""
      className={cx(
        "focus:rounded-control focus:border-ink focus:bg-accent focus:text-on-accent sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:border-2 focus:px-4 focus:py-3 focus:font-bold",
        className,
      )}
    >
      {children}
    </a>
  );
}
