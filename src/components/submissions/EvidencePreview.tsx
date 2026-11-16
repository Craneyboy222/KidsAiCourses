import { Callout, Card } from "@/components/ui";
import type { Rubric } from "@/content/schema";
import { KIND_LABELS, NO_PEOPLE_RULE } from "./evidence-copy";

/**
 * What a learner will be asked for on an evidence step, shown to staff previewing a draft. It is
 * a description, not a form: a preview sends nothing, stores nothing and issues nothing.
 */
export function EvidencePreview({ type, kinds, hint, rubric }: { type: "upload" | "submit"; kinds: readonly ("link" | "screenshot" | "file" | "video")[]; hint: string; rubric: Rubric | null }) {
  return (
    <Card className="flex flex-col gap-4" data-testid="evidence-preview">
      <Callout tone="info" title="Preview">
        Learners {type === "submit" ? "hand in their project" : "add their evidence"} here. Nothing can be sent from a preview, and nothing is saved.
      </Callout>
      {hint && <p>{hint}</p>}
      <div>
        <p className="font-bold">A learner can send:</p>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {kinds.map((kind) => (
            <li key={kind}>{KIND_LABELS[kind].description}</li>
          ))}
        </ul>
      </div>
      <p className="text-ink-muted">{NO_PEOPLE_RULE}</p>
      {rubric && (
        <div>
          <p className="font-bold">They rate their project against:</p>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {rubric.criteria.map((criterion) => (
              <li key={criterion.id}>{criterion.name}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
