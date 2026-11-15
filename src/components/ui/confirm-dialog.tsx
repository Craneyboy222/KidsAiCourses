"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./button";
import { buttonStyles } from "./button-styles";
import { cx } from "./cn";
import { overlayStyles } from "./dialog";
import { Field } from "./field";
import { FormError } from "./form-error";
import { useControllableState } from "./internal";
import { Textarea } from "./textarea";

export type ConfirmDialogProps = {
  title: ReactNode;
  /** Say exactly what will happen and whether it can be undone. */
  description: ReactNode;
  /** Name the action: "Take down course", not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for anything destructive. */
  tone?: "primary" | "danger";
  trigger?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Asks for a written reason and will not confirm without one. Use for destructive staff actions that are audited. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  /** Shortest reason accepted, in characters. */
  reasonMinLength?: number;
  /**
   * Runs when the person confirms. Receives the reason when `requireReason` is set.
   * If it returns a promise the dialog shows progress, closes when it resolves, and stays open with a message if it rejects.
   */
  onConfirm: (reason?: string) => void | Promise<void>;
  children?: ReactNode;
};

/**
 * A confirmation step (Radix AlertDialog). It does not close on an outside
 * click, and focus starts on Cancel so that Enter never confirms by accident.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  trigger,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  requireReason = false,
  reasonLabel = "Reason",
  reasonHint = "This is saved in the audit log.",
  reasonMinLength = 5,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next) {
      setReason("");
      setReasonError(undefined);
      setFailure(undefined);
    }
    setOpen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = reason.trim();
    if (requireReason && trimmed.length < reasonMinLength) {
      setReasonError(
        trimmed.length === 0
          ? "Give a reason before you continue."
          : `Add a little more detail: at least ${reasonMinLength} characters.`,
      );
      reasonRef.current?.focus();
      return;
    }
    setReasonError(undefined);
    setFailure(undefined);
    try {
      setBusy(true);
      await onConfirm(requireReason ? trimmed : undefined);
      setBusy(false);
      setReason("");
      setOpen(false);
    } catch (error) {
      setBusy(false);
      setFailure(
        error instanceof Error && error.message
          ? error.message
          : "That didn't go through. Nothing has changed — try again.",
      );
    }
  }

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={changeOpen}>
      {trigger && <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayStyles} />
        <AlertDialogPrimitive.Content
          className={cx(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto",
            "rounded-card border-ink bg-surface text-ink shadow-raised data-[state=open]:animate-pop-in border-2 p-5 outline-none sm:p-6",
          )}
        >
          <AlertDialogPrimitive.Title className="text-xl font-bold">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-ink-muted">
            {description}
          </AlertDialogPrimitive.Description>
          {children}
          <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormError message={failure} title="That didn't work" />
            {requireReason && (
              <Field label={reasonLabel} hint={reasonHint} error={reasonError}>
                <Textarea
                  ref={reasonRef}
                  name="reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </Field>
            )}
          </form>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <AlertDialogPrimitive.Cancel className={buttonStyles({ variant: "secondary" })} data-button="">
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            <Button
              type="submit"
              form={formId}
              variant={tone === "danger" ? "danger" : "primary"}
              loading={busy}
              loadingText="Working on it…"
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
