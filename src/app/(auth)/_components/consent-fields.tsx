import { Checkbox } from "@/components/ui";

export type ConsentFieldItem = {
  key: string;
  title: string;
  /** Plain-English wording, in paragraphs. */
  body: string;
  required: boolean;
  /** Whether the box starts ticked. Required consents never do. */
  defaultChecked?: boolean;
  /** Shown when the wording has changed since it was last agreed to. */
  needsReconsent?: boolean;
  /** What currently stands, for example "Given on 16 November 2026". */
  decided?: string | null;
};

export type ConsentFieldsProps = {
  items: ConsentFieldItem[];
  fieldError: (name: string) => string | undefined;
  /** "your child" for a parent, "you" for an 18-year-old deciding for themselves. */
  audience: "parent" | "self";
  headingLevel?: "h2" | "h3";
};

/**
 * The consent switches, used by the consent centre, adult sign-up and independence. Each consent
 * shows its full wording above its own tick box. Posts `consent.<key>` for each one, and
 * `consentKeys` with the list shown, so the action knows an empty box from a missing one.
 */
export function ConsentFields({ items, fieldError, audience, headingLevel: Heading = "h2" }: ConsentFieldsProps) {
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  const group = (title: string, intro: string, list: ConsentFieldItem[]) =>
    list.length > 0 && (
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Heading className="text-xl font-bold">{title}</Heading>
          <p className="text-ink-muted">{intro}</p>
        </div>
        {list.map((item) => (
          <div key={item.key} className="rounded-card border-ink bg-surface flex flex-col gap-3 border-2 p-4">
            <p className="text-lg font-bold">{item.title}</p>
            {item.decided && <p className="text-ink-muted text-sm">{item.decided}</p>}
            {item.needsReconsent && (
              <p className="rounded-control border-warning bg-warning-soft border-2 px-3 py-2 text-sm font-bold">
                We have updated this wording since it was last agreed to. Please read it and tick the box again.
              </p>
            )}
            {/* The wording is plain paragraphs (checked on import), so no Markdown renderer is needed in the browser. */}
            <div className="max-w-measure flex flex-col gap-3">
              {item.body
                .split(/\n{2,}/)
                .map((paragraph) => paragraph.trim())
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>
            <Checkbox
              name={`consent.${item.key}`}
              defaultChecked={item.defaultChecked === true}
              label={item.required ? `I agree: ${item.title}` : `Switch on: ${item.title}`}
              description={item.required ? "Needed for the account to work." : "Optional. You can change this at any time."}
              error={fieldError(`consent.${item.key}`)}
            />
          </div>
        ))}
      </section>
    );

  return (
    <div className="flex flex-col gap-8">
      <input type="hidden" name="consentKeys" value={items.map((item) => item.key).join(",")} />
      {group(
        "Needed for the account",
        audience === "parent" ? "Your child's account cannot be used until you agree to all of these." : "Your account cannot be used until you agree to all of these.",
        required,
      )}
      {group("Your choice", "These are optional and start switched off. Nothing else changes if you leave them off.", optional)}
    </div>
  );
}
