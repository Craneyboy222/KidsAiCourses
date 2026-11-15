import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/link-button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="max-w-measure mx-auto flex min-h-dvh flex-col justify-center gap-4 px-4 py-12 outline-none"
    >
      <p className="text-ink-muted font-bold">Error 404</p>
      <h1>We can&apos;t find that page</h1>
      <p className="text-lg">The link might be out of date, or the page may have moved or been taken down.</p>
      <p>
        Check the address for typos, or head back to the home page and find your way from there. Nothing in
        your account has changed.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <LinkButton href="/">Go to the home page</LinkButton>
        <LinkButton href="/help" variant="secondary">
          Get help
        </LinkButton>
      </div>
    </main>
  );
}
