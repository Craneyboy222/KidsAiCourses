import { cx } from "./cn";

type LiveRegionProps = {
  children?: React.ReactNode;
  /** `polite` waits for the screen reader to finish; `assertive` interrupts. Keep assertive for errors. */
  politeness?: "polite" | "assertive";
  /** Shown on screen as well as announced. Hidden by default. */
  visible?: boolean;
  className?: string;
};

/**
 * Announces async status to screen readers. Keep it mounted and change its
 * children: a region that appears already filled is often not announced.
 */
export function LiveRegion({ children, politeness = "polite", visible = false, className }: LiveRegionProps) {
  return (
    <div
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
      className={cx(!visible && "sr-only", className)}
    >
      {children}
    </div>
  );
}
