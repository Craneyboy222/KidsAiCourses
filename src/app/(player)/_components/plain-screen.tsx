import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout";

/** A quiet full page for the moments there is no step to show: a stop, a notice. One `<main>`, one `<h1>`. */
export function PlainScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-ink bg-surface border-b-2 px-4 py-3">
        <BrandMark href="/home" />
      </header>
      <main id="main" tabIndex={-1} className="max-w-measure mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-10 outline-none">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {children}
      </main>
    </div>
  );
}
