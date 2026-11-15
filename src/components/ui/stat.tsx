import type { ReactNode } from "react";
import { cx } from "./cn";

export type StatProps = {
  label: ReactNode;
  value: ReactNode;
  /** Context in words, for example "2 more than last week". Never rely on an arrow or colour alone. */
  detail?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

/** A row of figures. Renders a description list, so each value is tied to its label. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-4", className)}>
      {children}
    </dl>
  );
}

/** One figure with its label. Must sit inside StatGroup. */
export function Stat({ label, value, detail, icon, className }: StatProps) {
  return (
    <div
      className={cx(
        "rounded-card border-ink bg-surface text-ink flex flex-col gap-1 border-2 p-4",
        className,
      )}
    >
      <dt className="text-ink-muted flex items-center gap-2 text-sm font-bold">
        {icon}
        {label}
      </dt>
      <dd className="text-3xl leading-tight font-bold">{value}</dd>
      {detail && <dd className="text-ink-muted text-sm">{detail}</dd>}
    </div>
  );
}
