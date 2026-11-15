"use client";
// CONTRACT — owner: Coach slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import type { PlayerMode } from "@/components/course/types";

export type CoachPanelProps = {
  mode: PlayerMode;
  courseSlug: string;
  stepKey: string;
  stepTitle: string;
  /** Tiered hints for the step. "I'm stuck" offers these first, before any model call (spec 3.2). */
  hints: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The Coach sheet inside the course player. Placeholder until the Coach slice lands. */
export function CoachPanel(_props: CoachPanelProps) {
  return null;
}
