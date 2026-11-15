import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cx } from "./cn";

export type AccordionItem = {
  id: string;
  title: ReactNode;
  content: ReactNode;
  defaultOpen?: boolean;
};

export type AccordionProps = {
  items: AccordionItem[];
  /** Only one section open at a time. Uses the native `name` grouping of `<details>`. */
  exclusive?: boolean;
  className?: string;
};

/**
 * Expandable sections built on native `<details>`: keyboard operable, searchable
 * with find-in-page, and no JavaScript at all, which suits 4 GB Chromebooks.
 */
export function Accordion({ items, exclusive = false, className }: AccordionProps) {
  const group = useId();
  return (
    <div
      className={cx(
        "divide-ink rounded-card border-ink bg-surface text-ink divide-y-2 overflow-hidden border-2",
        className,
      )}
    >
      {items.map((item) => (
        <details key={item.id} name={exclusive ? group : undefined} open={item.defaultOpen} className="group">
          <summary className="hover:bg-tint flex min-h-11 list-none items-center justify-between gap-3 px-4 py-3 font-bold -outline-offset-4 [&::-webkit-details-marker]:hidden">
            <span>{item.title}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 transition-transform duration-150 group-open:rotate-180"
              strokeWidth={2.5}
            />
          </summary>
          <div className="flex flex-col gap-3 px-4 pt-1 pb-4">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
