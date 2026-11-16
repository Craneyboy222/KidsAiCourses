import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { BrandMark } from "@/components/layout";
import { ReloadButton } from "@/components/marketing/reload-button";

export const metadata: Metadata = { title: "You're offline", robots: { index: false, follow: false } };

/**
 * The page the service worker shows when a page cannot be loaded because there is no connection.
 * The worker fetches it once, signed out, and keeps that copy, so it must stay the same for
 * everyone: it reads no session and no data, and links nowhere that needs the network to make sense.
 * It stands outside the marketing layout for the same reason.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <header className="mb-8">
        <BrandMark />
      </header>
      <main id="main" tabIndex={-1} className="flex w-full max-w-md flex-col gap-6 outline-none">
        <div className="rounded-card border-ink bg-surface flex flex-col gap-4 border-2 p-6 sm:p-8">
          <span className="border-ink bg-accent text-on-accent flex size-12 items-center justify-center rounded-full border-2">
            <WifiOff aria-hidden="true" className="size-6" strokeWidth={2.25} />
          </span>
          <h1 className="text-3xl font-bold">You&apos;re offline</h1>
          <p>We can&apos;t reach the internet from this device right now, so this page couldn&apos;t load.</p>
          <p>Anything you had already saved is safe. Check your Wi-Fi or mobile data, then try again.</p>
          <ReloadButton />
        </div>
      </main>
    </div>
  );
}
