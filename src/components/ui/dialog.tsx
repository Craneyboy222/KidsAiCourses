"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { buttonStyles } from "./button-styles";
import { cx } from "./cn";

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export const overlayStyles = "fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in";
export const closeButtonStyles = buttonStyles({
  variant: "ghost",
  size: "sm",
  iconOnly: true,
  className: "-mt-1 -mr-1",
});

export type DialogProps = {
  /** Required. Every dialog has a visible title, which is also its accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** The element that opens the dialog, usually a Button. Leave out when you control `open` yourself. */
  trigger?: ReactNode;
  children?: ReactNode;
  /** Buttons at the bottom. Wrap one in `<DialogClose>` to make it close the dialog. */
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: keyof typeof SIZES;
  className?: string;
};

/**
 * A modal dialog (Radix). Focus is trapped while it is open, Escape closes it,
 * and focus returns to the trigger afterwards.
 */
export function Dialog({
  title,
  description,
  trigger,
  children,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  size = "md",
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayStyles} />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cx(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto",
            "rounded-card border-ink bg-surface text-ink shadow-raised data-[state=open]:animate-pop-in border-2 p-5 outline-none sm:p-6",
            SIZES[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close" className={closeButtonStyles}>
              <X aria-hidden="true" className="size-5" strokeWidth={2.5} />
            </DialogPrimitive.Close>
          </div>
          {description && (
            <DialogPrimitive.Description className="text-ink-muted">
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-3 pt-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Wrap a Button to make it close the surrounding Dialog or Sheet: `<DialogClose><Button>Done</Button></DialogClose>`. */
export function DialogClose({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}
