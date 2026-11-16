import { FileText, Film, Image as ImageIcon, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, ExternalToolLink, type BadgeTone } from "@/components/ui";
import type { EvidenceItem } from "@/server/services/submission";
import { KIND_LABELS, STATE_LABELS, formatBytes, type EvidenceKind } from "./evidence-copy";

const KIND_ICONS: Record<EvidenceKind, typeof Link2> = { link: Link2, screenshot: ImageIcon, file: FileText, video: Film };
const STATE_TONES: Record<EvidenceItem["state"], BadgeTone> = { ready: "neutral", awaiting_review: "info", accepted: "success", rejected: "warning" };

/**
 * One piece of evidence. A link is shown as text and is never embedded; it becomes a clickable
 * link (with the leaving-site notice) only when it points at one of the course's own Register
 * tools. A stored file opens through a short-lived signed link, in a new tab.
 */
export function EvidenceItemRow({ item, action }: { item: EvidenceItem; action?: ReactNode }) {
  const Glyph = KIND_ICONS[item.kind];
  return (
    <li>
      <Card padding="sm" variant="plain" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <Glyph aria-hidden="true" className="mt-1 size-5 shrink-0" strokeWidth={2.25} />
            <div className="flex min-w-0 flex-col">
              <span className="font-bold">{KIND_LABELS[item.kind].name}</span>
              {item.kind === "link" && item.url ? (
                // Shown as text. Only a link to one of this course's own tools becomes a link, and never an embed.
                item.linkTool ? (
                  <ExternalToolLink href={item.url} toolName={item.linkTool.name} allowed className="break-all">
                    {item.url}
                  </ExternalToolLink>
                ) : (
                  <span className="break-all">{item.url}</span>
                )
              ) : (
                <span className="text-ink-muted text-sm">{formatBytes(item.sizeBytes)}</span>
              )}
            </div>
          </div>
          <Badge tone={STATE_TONES[item.state]}>{STATE_LABELS[item.state]}</Badge>
        </div>
        {item.message && <p>{item.message}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {item.hasFile && (
            <a className="link" href={`/api/v1/artefacts/${item.id}/download`} target="_blank" rel="noopener noreferrer">
              Open my {KIND_LABELS[item.kind].name.toLowerCase()} <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {action}
        </div>
      </Card>
    </li>
  );
}
