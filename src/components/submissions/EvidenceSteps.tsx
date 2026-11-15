// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import type { PlayerMode } from "@/components/course/types";
import type { ProjectBrief, Rubric } from "@/content/schema";

export type EvidenceStepProps = {
  mode: PlayerMode;
  courseId: string;
  courseSlug: string;
  /** The step id in the course JSON. */
  stepKey: string;
  /** The materialised `step.id`; null in a staff preview of a draft. */
  stepId: string | null;
  title: string;
  /** Parsed step config (`upload` or `submit`). */
  config: Record<string, unknown>;
  brief: ProjectBrief;
  rubric: Rubric;
};

/** Mid-course `upload` step. Placeholder until the submissions slice lands. */
export function UploadStep(_props: EvidenceStepProps) {
  return null;
}
/** Final `submit` step: rubric self-check, evidence, and the "awaiting review" state. Placeholder until the submissions slice lands. */
export function SubmitStep(_props: EvidenceStepProps) {
  return null;
}
