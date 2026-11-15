"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";

/** Next.js 16 passes `retry` (re-fetch and re-render the segment) alongside the thrown value. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;

  useEffect(() => {
    // Shows in the browser console for debugging. The server keeps the full error against the same reference.
    console.error(error);
  }, [error]);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="max-w-measure mx-auto flex min-h-dvh flex-col justify-center gap-4 px-4 py-12 outline-none"
    >
      <h1>That didn&apos;t load</h1>
      <p className="text-lg">
        Something went wrong on our side, not yours. Anything you had already saved is still saved.
      </p>
      <p>Try again. If it keeps happening, wait a minute and reload the page, or go back to the home page.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <LinkButton href="/" variant="secondary">
          Go to the home page
        </LinkButton>
      </div>
      {digest && (
        <p className="text-ink-muted text-sm">
          If you ask for help, quote this reference:{" "}
          <span className="text-ink font-mono font-bold">{digest}</span>
        </p>
      )}
    </main>
  );
}
