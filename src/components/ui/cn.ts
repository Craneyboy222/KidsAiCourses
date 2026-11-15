import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Teaches tailwind-merge about the design tokens in globals.css, so `rounded-card` and `rounded-full` conflict properly. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["card", "control"],
      shadow: ["raised"],
      container: ["measure"],
      breakpoint: ["rail"],
    },
  },
});

/** Joins class names and lets a later Tailwind class override an earlier one. */
export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
