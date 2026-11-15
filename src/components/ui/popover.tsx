"use client";

import { X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cn";
import { closeButtonStyles } from "./dialog";

export type PopoverProps = {
  /** The button that opens the popover. */
  trigger: ReactNode;
  /** Shown as a heading and used as the accessible name. */
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/** A small floating panel for extra detail or a few controls (Radix). It is not modal: Escape or a click outside closes it. */
export function Popover({
  trigger,
  title,
  children,
  align = "start",
  side = "bottom",
  open,
  onOpenChange,
  className,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={title}
          align={align}
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className={cx(
            "rounded-card border-ink bg-surface text-ink shadow-raised data-[state=open]:animate-fade-in z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 border-2 p-4 outline-none",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-bold">{title}</p>
            <PopoverPrimitive.Close aria-label="Close" className={closeButtonStyles}>
              <X aria-hidden="true" className="size-5" strokeWidth={2.5} />
            </PopoverPrimitive.Close>
          </div>
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
