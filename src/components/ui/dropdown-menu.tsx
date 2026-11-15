"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cn";

export type DropdownMenuProps = {
  /** The button that opens the menu. It must have a visible label or an `aria-label`. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * A menu of actions (Radix). Arrow keys move, typing jumps to an item, Escape closes.
 *
 * ```tsx
 * <DropdownMenu trigger={<Button variant="secondary">Actions</Button>}>
 *   <DropdownMenuItem onSelect={rename}>Rename</DropdownMenuItem>
 *   <DropdownMenuSeparator />
 *   <DropdownMenuItem tone="danger" onSelect={remove}>Delete</DropdownMenuItem>
 * </DropdownMenu>
 * ```
 */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
  open,
  onOpenChange,
  className,
}: DropdownMenuProps) {
  return (
    // Not modal: the page behind is not hidden from assistive technology while the menu is open.
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cx(
            "rounded-control border-ink bg-surface text-ink shadow-raised data-[state=open]:animate-fade-in z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-48 overflow-y-auto border-2 p-1.5",
            className,
          )}
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

const itemStyles =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-base select-none " +
  "data-[highlighted]:bg-tint data-[highlighted]:underline data-[highlighted]:underline-offset-4 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60";

export type DropdownMenuItemProps = Omit<ComponentProps<typeof DropdownMenuPrimitive.Item>, "asChild"> & {
  icon?: ReactNode;
  /** `danger` adds weight and colour. Name the action clearly too: colour is not the only cue. */
  tone?: "default" | "danger";
};

export function DropdownMenuItem({
  icon,
  tone = "default",
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={cx(itemStyles, tone === "danger" && "text-danger font-bold", className)}
      {...props}
    >
      {icon}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

/** A menu item that navigates. Pass one link element as the child: `<DropdownMenuLinkItem><Link href="/settings">Settings</Link></DropdownMenuLinkItem>`. */
export function DropdownMenuLinkItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DropdownMenuPrimitive.Item asChild className={cx(itemStyles, "no-underline", className)}>
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DropdownMenuPrimitive.Label className={cx("text-ink-muted px-3 py-1.5 text-sm font-bold", className)}>
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DropdownMenuPrimitive.Separator className={cx("bg-line my-1.5 h-0.5", className)} />;
}
