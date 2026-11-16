import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { MARKETING_NAV, MarketingShell } from "@/components/layout";
import { ServiceWorkerRegistration } from "@/components/marketing/service-worker";
import { env } from "@/env";
import { BRAND_NAME } from "@/lib/brand";
import { londonYearMonth } from "@/lib/dates";
import { homeLinkFor, isUnder18Learner } from "@/lib/marketing/site";
import { getCtx } from "@/server/context";
import { t } from "@/server/copy";

/**
 * Relative addresses in the metadata of every public page (canonical links, Open Graph) are
 * resolved against the site's own address.
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  openGraph: { siteName: BRAND_NAME, locale: "en_GB", type: "website" },
};

/**
 * The frame of every public page: header, `<main>`, footer. Pages inside render no `<main>` of
 * their own and exactly one `<h1>`.
 *
 * A signed-in visitor gets one link to their own pages in place of "Sign in" and "Get started".
 * Nobody is redirected from here: the public pages are the same pages for everyone, so a crawler
 * and a parent see the same thing.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx();
  const account = homeLinkFor(ctx.actor) ?? undefined;
  // A learner under 18 is never shown prices, so the link to them is left out of their menu.
  const nav = isUnder18Learner(ctx.actor) ? MARKETING_NAV.filter((item) => item.href !== "/pricing") : MARKETING_NAV;
  const cookieNote = await t(ctx, "marketing.cookie_note");

  return (
    <MarketingShell
      year={londonYearMonth(ctx.now).year}
      nav={nav}
      account={account}
      footerNote={
        <p>
          {cookieNote}{" "}
          <Link href="/legal/cookies" className="link font-normal">
            Cookie notice
          </Link>
        </p>
      }
    >
      {children}
      {/* Production builds only: a development server changes its files on every edit. */}
      <ServiceWorkerRegistration enabled={env.NODE_ENV === "production"} />
    </MarketingShell>
  );
}
