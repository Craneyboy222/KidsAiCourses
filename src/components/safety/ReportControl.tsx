// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
"use client";

import { sendReportAction } from "@/app/_safety/actions";
import { ReportButton, type ReportReason as ReasonOption } from "@/components/ui";
import type { ReportReason, ReportTarget } from "@/server/services/reports";

export type ReportControlProps = { target: ReportTarget; /** Icon-only button for tight spaces; it still has an accessible name. */ compact?: boolean; label?: string };

const DANGER: ReasonOption & { value: ReportReason } = { value: "someone_in_danger", label: "Someone is in danger", description: "You or someone else might get hurt. This goes straight to our safeguarding lead.", urgent: true };
const GUIDE: ReasonOption & { value: ReportReason } = { value: "guide_mismatch", label: "This doesn't match what I see", description: "The tool's screens look different from the guide." };
const COMMON: (ReasonOption & { value: ReportReason })[] = [
  { value: "wrong_or_broken", label: "Something is wrong or broken", description: "A mistake, a broken link or something that doesn't work." },
  { value: "inappropriate", label: "It's upsetting or not OK", description: "Something here shouldn't be shown to people my age." },
  { value: "bullying", label: "Someone is being unkind", description: "Bullying, threats or pressure." },
  { value: "privacy", label: "A privacy worry", description: "Personal details are showing, or something asks for them." },
  { value: "other", label: "Something else" },
];

const SUBJECTS: Record<ReportTarget["type"], string> = { step: "this step", course: "this course", project: "this project", ai_output: "this Coach reply", guide: "this guide", other: "a problem" };

/** The reasons offered, most likely first for what is being reported. "Someone is in danger" is always there. */
export function reasonsFor(type: ReportTarget["type"]): (ReasonOption & { value: ReportReason })[] {
  if (type === "guide") return [GUIDE, ...COMMON, DANGER];
  if (type === "step") return [...COMMON.slice(0, 1), GUIDE, ...COMMON.slice(1), DANGER];
  return [...COMMON, DANGER];
}

/**
 * The Report control that sits on every step, course, project and AI output (spec 3.10),
 * including "Someone is in danger". Built on the kit's `ReportButton`: choosing the danger reason
 * shows the fixed urgent-help wording straight away, before and after the report is sent.
 */
export function ReportControl({ target, compact = false, label }: ReportControlProps) {
  return (
    <ReportButton
      reasons={reasonsFor(target.type)}
      subject={SUBJECTS[target.type]}
      label={label ?? "Report a problem"}
      iconOnly={compact}
      onSubmit={async ({ reason, details }) => {
        const result = await sendReportAction({ reason, target, note: details });
        if (!result.ok) throw new Error(result.message);
      }}
    />
  );
}
