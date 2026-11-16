import { MessageSquareText, Phone } from "lucide-react";
import { useId } from "react";
import type { CrisisContact, CrisisScript } from "@/server/ai/crisis";
import { AiLabel } from "@/components/ui";

/**
 * The fixed crisis script (spec 3.5), shown as its own calm panel. The words come from approved
 * data on the server, never from a model. Every number is a real link, so it can be tapped on a
 * phone, and each link is big enough to hit easily.
 */
function ContactLink({ contact }: { contact: CrisisContact }) {
  const Glyph = contact.action === "text" ? MessageSquareText : Phone;
  const name = contact.action === "text" ? `${contact.name}: ${contact.display}` : `Call ${contact.name} on ${contact.display}`;
  return (
    <a
      href={contact.href}
      aria-label={name}
      className="border-ink bg-surface text-ink rounded-control flex min-h-12 items-center gap-3 border-2 px-4 py-2 font-bold underline underline-offset-4"
    >
      <Glyph aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />
      <span className="flex flex-col">
        <span>
          {contact.name}: {contact.display}
        </span>
        {contact.detail && <span className="text-ink-muted text-sm font-normal no-underline">{contact.detail}</span>}
      </span>
    </a>
  );
}

export function CrisisPanel({ script, label }: { script: CrisisScript; label: string }) {
  // The script can be shown more than once in a thread. So the heading's id is unique each time,
  // and the panel is a named group rather than a landmark region (two regions with one name clash).
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} data-testid="coach-crisis" className="border-info bg-info-soft text-ink rounded-card flex flex-col gap-3 border-2 p-4">
      <h3 id={titleId} className="text-lg font-bold">
        {script.title}
      </h3>
      {script.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <ul className="flex list-none flex-col gap-2 p-0" aria-label="People you can talk to now">
        {script.contacts.map((contact) => (
          <li key={contact.href}>
            <ContactLink contact={contact} />
          </li>
        ))}
      </ul>
      <p className="font-bold">{script.emergency.text}</p>
      <ContactLink contact={script.emergency.contact} />
      <p>{script.closing}</p>
      <AiLabel>{label}</AiLabel>
    </div>
  );
}
