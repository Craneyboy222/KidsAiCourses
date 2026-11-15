"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cn";

export type TooltipProps = {
  /** Short plain text. A tooltip is a hint, never the only place something important is said. */
  content: ReactNode;
  /** One focusable element, for example an IconButton. */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
};

/**
 * A hint on hover and on keyboard focus (Radix). It can be hovered itself and
 * closes with Escape (WCAG 1.4.13). Touch screens do not show tooltips, so the
 * trigger still needs its own label.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={12}
            data-surface="ink"
            className={cx(
              "bg-ink text-paper data-[state=delayed-open]:animate-fade-in z-[70] max-w-64 rounded-md px-3 py-1.5 text-sm font-bold",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
