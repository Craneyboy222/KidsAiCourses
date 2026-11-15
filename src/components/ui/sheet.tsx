"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cn";
import { closeButtonStyles, overlayStyles } from "./dialog";

export type SheetProps = {
  /** Required: the visible title and accessible name. */
  title: ReactNode;
  description?: ReactNode;
  trigger?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which edge it slides from on wide screens. On phones it is always a bottom sheet. */
  side?: "right" | "left";
  /**
   * `false` leaves the page behind usable (no overlay, no focus trap). Use it for
   * Coach, so a learner can read the step and talk to Coach at the same time.
   */
  modal?: boolean;
  className?: string;
};

/** A panel that slides in from the side on wide screens and up from the bottom on phones. */
export function Sheet({
  title,
  description,
  trigger,
  children,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  side = "right",
  modal = true,
  className,
}: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        {modal && <DialogPrimitive.Overlay className={overlayStyles} />}
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          onInteractOutside={modal ? undefined : (event) => event.preventDefault()}
          className={cx(
            "rounded-t-card border-ink bg-surface text-ink fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col border-2 border-b-0 outline-none",
            "data-[state=open]:animate-slide-up",
            "sm:data-[state=open]:animate-slide-in-right sm:inset-y-0 sm:max-h-none sm:w-[26rem] sm:max-w-[90vw] sm:rounded-none sm:border-y-0",
            side === "right"
              ? "sm:right-0 sm:left-auto sm:border-r-0"
              : "sm:right-auto sm:left-0 sm:border-l-0",
            className,
          )}
        >
          <div className="border-ink flex items-start justify-between gap-4 border-b-2 p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-ink-muted text-sm">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close aria-label="Close" className={closeButtonStyles}>
              <X aria-hidden="true" className="size-5" strokeWidth={2.5} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
          {footer && (
            <div className="border-ink flex flex-wrap justify-end gap-3 border-t-2 p-4">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
