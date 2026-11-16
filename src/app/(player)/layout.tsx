import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The course player sits outside the learner tab frame: it has its own full-page shell
 * (`PlayerShell`), one focused column and its own `<main>`. This group exists only for that
 * reason; the addresses are still `/learn/...`. Each page checks who is asking.
 */
export default function PlayerLayout({ children }: { children: ReactNode }) {
  return children;
}
