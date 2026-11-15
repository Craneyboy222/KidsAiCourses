// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import type { ReportTarget } from "@/server/services/reports";

export type ReportControlProps = { target: ReportTarget; /** Icon-only button for tight spaces; it still has an accessible name. */ compact?: boolean; label?: string };

/**
 * The Report control that sits on every step, course, project and AI output (spec 3.10),
 * including "Someone is in danger". Placeholder until the submissions slice lands.
 */
export function ReportControl(_props: ReportControlProps) {
  return null;
}
