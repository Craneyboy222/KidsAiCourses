"use client";

import { CircleCheck, Info, OctagonAlert, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cn";

export type ToastTone = "info" | "success" | "danger";

export type ToastOptions = {
  /** Short and specific: "Project saved". */
  title: string;
  /** Optional second line: what to do next. */
  description?: string;
  tone?: ToastTone;
  /**
   * Milliseconds before it goes away. Defaults to 6 seconds for info and success.
   * Errors stay until dismissed, so nobody misses them. The timer pauses on hover and focus.
   */
  duration?: number | null;
};

type ToastRecord = Required<Pick<ToastOptions, "title" | "tone">> &
  Pick<ToastOptions, "description"> & { id: number; duration: number | null };

/** A tiny module-level store: no provider, no context, no state library. */
let toasts: ToastRecord[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastRecord[] = [];

function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a toast. Safe to call from any client event handler; `<Toaster />` must be mounted once (it is, in the root layout). */
export function toast(options: ToastOptions): number {
  const tone = options.tone ?? "info";
  const id = nextId++;
  const duration = options.duration === undefined ? (tone === "danger" ? null : 6000) : options.duration;
  toasts = [...toasts, { id, title: options.title, description: options.description, tone, duration }];
  emit();
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** `const { toast } = useToast()` then `toast({ title: "Saved", tone: "success" })`. */
export function useToast(): { toast: typeof toast; dismiss: typeof dismissToast } {
  return { toast, dismiss: dismissToast };
}

const TONES: Record<ToastTone, { box: string; icon: string; Glyph: typeof Info; word: string }> = {
  info: { box: "border-ink", icon: "text-info", Glyph: Info, word: "Information" },
  success: { box: "border-ink", icon: "text-success", Glyph: CircleCheck, word: "Success" },
  danger: { box: "border-danger", icon: "text-danger", Glyph: OctagonAlert, word: "Error" },
};

function ToastCard({ record }: { record: ToastRecord }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { box, icon, Glyph } = TONES[record.tone];

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function start() {
    stop();
    if (record.duration !== null) timer.current = setTimeout(() => dismissToast(record.id), record.duration);
  }

  useEffect(() => {
    if (record.duration === null) return;
    const handle = setTimeout(() => dismissToast(record.id), record.duration);
    timer.current = handle;
    return () => clearTimeout(handle);
  }, [record.id, record.duration]);

  return (
    <li
      onPointerEnter={stop}
      onPointerLeave={start}
      className={cx(
        "rounded-card bg-surface text-ink shadow-raised animate-fade-in pointer-events-auto flex items-start gap-3 border-2 p-3 pl-4",
        box,
      )}
    >
      <Glyph aria-hidden="true" className={cx("mt-0.5 size-5 shrink-0", icon)} strokeWidth={2.5} />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{record.title}</p>
        {record.description && <p className="text-ink-muted text-sm">{record.description}</p>}
      </div>
      <button
        type="button"
        aria-label={`Dismiss: ${record.title}`}
        onClick={() => dismissToast(record.id)}
        onFocus={stop}
        onBlur={start}
        className="rounded-control text-ink hover:bg-tint -mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center"
      >
        <X aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </button>
    </li>
  );
}

function announcementFor(list: ToastRecord[], assertive: boolean): ReactNode {
  const latest = [...list].reverse().find((t) => (t.tone === "danger") === assertive);
  if (!latest) return null;
  return `${TONES[latest.tone].word}: ${latest.title}${latest.description ? `. ${latest.description}` : ""}`;
}

/**
 * Renders toasts and announces them. Mount once, in the root layout.
 *
 * Two `aria-live` regions stay in the page the whole time (polite for info and
 * success, assertive for errors) and receive the newest message; the visible
 * cards are a separate list, so dismissing one never re-reads the others.
 * Toasts never take focus and never hold actions: put actions in the page.
 */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcementFor(list, false)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcementFor(list, true)}
      </div>
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-3 top-3 z-[80] sm:right-4 sm:left-auto sm:w-96"
      >
        <ol className="flex flex-col gap-2">
          {list.map((record) => (
            <ToastCard key={record.id} record={record} />
          ))}
        </ol>
      </section>
    </>
  );
}
