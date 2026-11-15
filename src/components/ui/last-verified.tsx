import { CalendarCheck } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { cx } from "./cn";

export type LastVerifiedProps = {
  /** When a person last checked this course, guide or tool. */
  date: Date | string | number;
  /** Words before the date. */
  prefix?: string;
  className?: string;
};

/** "Last checked 1 November 2026": the visible freshness date on courses, guides and tools, always in UK time. */
export function LastVerified({ date, prefix = "Last checked", className }: LastVerifiedProps) {
  const iso = new Date(date).toISOString();
  return (
    <span className={cx("text-ink-muted inline-flex items-center gap-1.5 text-sm", className)}>
      <CalendarCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
      <span>
        {prefix} <time dateTime={iso.slice(0, 10)}>{formatDate(date)}</time>
      </span>
    </span>
  );
}
