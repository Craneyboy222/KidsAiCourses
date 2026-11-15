import { cx } from "./cn";

export type SkeletonProps = {
  /** Size it with classes, for example `h-6 w-40` or `h-32 w-full`. */
  className?: string;
};

/**
 * A still placeholder block for content that is loading. It does not pulse:
 * nothing on the platform moves by itself. Pair a group of skeletons with one
 * `<Spinner label="Loading your projects" />` or a LiveRegion so the wait is announced.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("rounded-control bg-tint block max-w-full", className)} />;
}
