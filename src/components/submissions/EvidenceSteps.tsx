// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import type { PlayerMode } from "@/components/course/types";
import { Callout } from "@/components/ui";
import type { ProjectBrief, Rubric } from "@/content/schema";
import { getCtx } from "@/server/context";
import { tDefault } from "@/server/copy";
import { isAppError } from "@/server/errors";
import { getSubmissionState, type SubmissionState } from "@/server/services/submission";
import { EvidenceForm } from "./EvidenceForm";
import { EvidencePreview } from "./EvidencePreview";

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

const EVIDENCE_KINDS = ["link", "screenshot", "file", "video"] as const;
type Kind = (typeof EVIDENCE_KINDS)[number];

const kindsFrom = (config: Record<string, unknown>): Kind[] => (Array.isArray(config.evidence) ? EVIDENCE_KINDS.filter((kind) => (config.evidence as unknown[]).includes(kind)) : []);
const textFrom = (value: unknown): string => (typeof value === "string" ? value : "");

/** The learner's own state for this step. A refusal (not their enrolment, a switched-off step) becomes a message, not a crash. */
async function loadState(enrolmentId: string, stepId: string): Promise<{ ok: true; state: SubmissionState } | { ok: false; message: string }> {
  try {
    return { ok: true, state: await getSubmissionState(await getCtx(), { enrolmentId, stepId }) };
  } catch (error) {
    if (!isAppError(error)) throw error;
    return { ok: false, message: error.message };
  }
}

async function EvidenceStep({ props, type }: { props: EvidenceStepProps; type: "upload" | "submit" }) {
  const { mode, stepId, config, rubric, brief } = props;
  const hint = textFrom(type === "submit" ? config.evidenceHint : config.hint);

  // A staff preview of a draft shows what a learner will see and records nothing at all (spec 6.3).
  if (mode.kind === "preview" || stepId === null) {
    return <EvidencePreview type={type} kinds={kindsFrom(config)} hint={hint} rubric={type === "submit" ? rubric : null} />;
  }

  const loaded = await loadState(mode.enrolmentId, stepId);
  if (!loaded.ok) {
    return (
      <Callout tone="warning" title="This step isn't available right now">
        {loaded.message}
      </Callout>
    );
  }
  return <EvidenceForm state={loaded.state} hint={hint} deliverables={type === "submit" ? brief.deliverables : []} criteria={type === "submit" ? rubric.criteria : []} urgentHelp={tDefault("report.danger.help")} />;
}

/** Mid-course `upload` step: each piece of evidence is checked as soon as it is added. */
export async function UploadStep(props: EvidenceStepProps) {
  return <EvidenceStep props={props} type="upload" />;
}

/** Final `submit` step: rubric self-check, evidence, and the "awaiting review" state. */
export async function SubmitStep(props: EvidenceStepProps) {
  return <EvidenceStep props={props} type="submit" />;
}
