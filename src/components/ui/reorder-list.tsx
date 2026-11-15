"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonStyles } from "./button-styles";

export type ReorderItem = {
  id: string;
  /** Plain-text name, used in the button labels and the spoken announcement. */
  label: string;
  /** Optional richer content to show instead of the plain label. */
  content?: ReactNode;
};

export type ReorderListProps = {
  /** Names the list, for example "Lessons in this module". */
  label: string;
  items: ReorderItem[];
  /** Called with the items in their new order. The parent owns the order. */
  onReorder: (items: ReorderItem[], move: { id: string; from: number; to: number }) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Reordering with Move up and Move down buttons: no dragging needed, so it
 * works with a keyboard, a switch or a screen reader. Focus stays on the button
 * that was pressed and each move is announced.
 */
export function ReorderList({ label, items, onReorder, disabled = false, className }: ReorderListProps) {
  const [announcement, setAnnouncement] = useState("");
  const refocus = useRef<{ id: string; direction: "up" | "down" } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Moving a DOM node drops focus in most browsers, so put it back on the same button after the re-render.
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-reorder-id]") ?? [];
    for (const button of buttons) {
      if (button.dataset.reorderId === target.id && button.dataset.direction === target.direction)
        button.focus();
    }
  }, [items]);

  function move(index: number, direction: "up" | "down") {
    const to = direction === "up" ? index - 1 : index + 1;
    const item = items[index];
    if (disabled || !item || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(index, 1);
    next.splice(to, 0, item);
    refocus.current = { id: item.id, direction };
    setAnnouncement(`${item.label} moved ${direction}. Now ${to + 1} of ${items.length}.`);
    onReorder(next, { id: item.id, from: index, to });
  }

  const moveButton = buttonStyles({
    variant: "secondary",
    size: "sm",
    iconOnly: true,
    className: "shadow-none active:translate-y-0",
  });

  return (
    <div className={className}>
      <ol ref={listRef} aria-label={label} className="flex flex-col gap-2">
        {items.map((item, index) => {
          const first = index === 0;
          const last = index === items.length - 1;
          return (
            <li
              key={item.id}
              className="rounded-control border-ink bg-surface text-ink flex items-center gap-3 border-2 p-2 pl-3"
            >
              <span aria-hidden="true" className="text-ink-muted w-6 shrink-0 text-sm font-bold">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">{item.content ?? item.label}</div>
              <div className="flex shrink-0 gap-2">
                {/* aria-disabled, not disabled: the button keeps focus when an item reaches the top or bottom. */}
                <button
                  type="button"
                  data-reorder-id={item.id}
                  data-direction="up"
                  aria-label={`Move ${item.label} up`}
                  aria-disabled={first || disabled || undefined}
                  onClick={() => move(index, "up")}
                  className={moveButton}
                >
                  <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  data-reorder-id={item.id}
                  data-direction="down"
                  aria-label={`Move ${item.label} down`}
                  aria-disabled={last || disabled || undefined}
                  onClick={() => move(index, "down")}
                  className={moveButton}
                >
                  <ArrowDown aria-hidden="true" className="size-4" strokeWidth={2.5} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
