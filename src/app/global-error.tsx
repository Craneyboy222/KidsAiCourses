"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { applyA11yPrefsToDocument, readA11yCookie } from "@/components/ui/a11y-prefs";
import { buttonStyles } from "@/components/ui/button-styles";
import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails, so it brings its own
 * <html>, <body> and styles. It is kept dependency-light on purpose: system
 * fonts, plain elements, and the saved theme re-applied from the cookie.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const prefs = readA11yCookie();
    if (prefs) applyA11yPrefsToDocument(prefs);
  }, [error]);

  return (
    <html lang="en-GB" data-theme="light" data-reading="default" data-text="100" data-motion="auto">
      <body>
        <title>Something went wrong</title>
        <main
          id="main"
          className="max-w-measure mx-auto flex min-h-dvh flex-col justify-center gap-4 px-4 py-12"
        >
          <h1>Something went wrong</h1>
          <p className="text-lg">
            The page couldn&apos;t load. This one is on us, not you, and nothing in your account has changed.
          </p>
          <p>Try again. If that doesn&apos;t work, wait a minute and reload the page.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              data-button=""
              className={buttonStyles({ variant: "primary" })}
              onClick={() => retry()}
            >
              Try again
            </button>
            {/* A full page load on purpose: the app shell is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" data-button="" className={buttonStyles({ variant: "secondary" })}>
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
