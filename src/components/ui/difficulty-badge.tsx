import { cx } from "./cn";

export type Difficulty = "starter" | "builder" | "pro";

const LEVELS: Record<Difficulty, { label: string; bars: 1 | 2 | 3; hint: string }> = {
  starter: { label: "Starter", bars: 1, hint: "Level 1 of 3" },
  builder: { label: "Builder", bars: 2, hint: "Level 2 of 3" },
  pro: { label: "Pro", bars: 3, hint: "Level 3 of 3" },
};

export type DifficultyBadgeProps = { level: Difficulty; className?: string };

/** Starter, Builder or Pro: the word, plus one to three filled bars, plus "Level n of 3" for screen readers. */
export function DifficultyBadge({ level, className }: DifficultyBadgeProps) {
  const { label, bars, hint } = LEVELS[level];
  return (
    <span
      className={cx(
        "border-ink bg-surface text-ink inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-0.5 text-sm font-bold whitespace-nowrap",
        className,
      )}
    >
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cx(
              "border-ink w-1.5 rounded-sm border",
              n === 1 ? "h-2" : n === 2 ? "h-3" : "h-4",
              n <= bars ? "bg-ink" : "bg-surface",
            )}
          />
        ))}
      </span>
      {label} <span className="sr-only">({hint})</span>
    </span>
  );
}
