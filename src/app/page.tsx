import { BRAND_NAME } from "@/lib/brand";

/** Placeholder. The marketing home page replaces this file. */
export default function HomePage() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="max-w-measure mx-auto flex min-h-dvh flex-col justify-center gap-3 px-4 outline-none"
    >
      <h1>{BRAND_NAME}</h1>
      <p className="text-ink-muted">The home page is on its way.</p>
    </main>
  );
}
