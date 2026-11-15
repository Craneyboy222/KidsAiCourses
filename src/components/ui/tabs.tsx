"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cn";

export type TabItem = {
  value: string;
  label: ReactNode;
  /** Usually `<Icon icon={...} size="sm" />`. */
  icon?: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  /** Names the set of tabs for screen readers, for example "Course sections". */
  label: string;
  tabs: TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

/**
 * Tabs (Radix): arrow keys move between tabs, Tab moves into the panel. The
 * selected tab is filled as well as coloured, so the state does not depend on colour.
 */
export function Tabs({ label, tabs, defaultValue, value, onValueChange, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={value === undefined ? (defaultValue ?? tabs[0]?.value) : undefined}
      value={value}
      onValueChange={onValueChange}
      className={cx("flex flex-col gap-4", className)}
    >
      <TabsPrimitive.List aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cx(
              "border-ink bg-surface text-ink hover:bg-tint inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 py-1.5 font-bold",
              "data-[state=active]:bg-ink data-[state=active]:text-paper disabled:opacity-60",
            )}
          >
            {tab.icon}
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} value={tab.value} className="rounded-card">
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
