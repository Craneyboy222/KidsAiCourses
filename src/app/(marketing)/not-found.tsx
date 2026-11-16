import type { Metadata } from "next";
import { PublicPage } from "@/components/marketing/prose-page";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/**
 * A public address that does not exist: an unknown help article, legal page or course. Shown
 * inside the site frame, so the menu and footer are still there. No `<main>` of its own.
 */
export default function MarketingNotFound() {
  return (
    <PublicPage>
      <PageHeader eyebrow="Error 404" title="We can't find that page" description="The link might be out of date, or the page may have moved or been taken down." />
      <p className="max-w-measure">Check the address for typos, or use one of these to find your way. Nothing in your account has changed.</p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/">Go to the home page</LinkButton>
        <LinkButton href="/courses" variant="secondary">
          Browse the courses
        </LinkButton>
        <LinkButton href="/help" variant="secondary">
          Help centre
        </LinkButton>
      </div>
    </PublicPage>
  );
}
