import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/link-button";
import { BRAND_NAME } from "@/lib/brand";
import { LEGAL_PAGES } from "@/lib/marketing/site";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

export type ShellLink = { href: string; label: string };

export const MARKETING_NAV: ShellLink[] = [
  { href: "/courses", label: "Courses" },
  { href: "/parents", label: "For parents" },
  { href: "/pricing", label: "Pricing" },
  { href: "/safety", label: "Safety" },
  { href: "/help", label: "Help" },
];

/** The six legal pages, at the addresses fixed by decision D16. */
export const MARKETING_LEGAL_LINKS: ShellLink[] = LEGAL_PAGES.map((page) => ({
  href: `/legal/${page.slug}`,
  label: page.label,
}));

export const MARKETING_HELP_LINKS: ShellLink[] = [
  { href: "/help", label: "Help centre" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/safety", label: "Staying safe" },
  { href: "/parents", label: "Information for parents" },
];

export type MarketingShellProps = {
  children: ReactNode;
  nav?: ShellLink[];
  legalLinks?: ShellLink[];
  helpLinks?: ShellLink[];
  signInHref?: string;
  getStartedHref?: string;
  /** Year shown in the footer. Passed in by the layout so the shell never reads the clock. */
  year: number;
  /** Optional strip above the header, for example a service notice. */
  notice?: ReactNode;
  /**
   * For a signed-in visitor: one link to their own pages ("Go to your home"), shown in place of
   * "Sign in" and "Get started". The layout decides; the shell never reads the session.
   */
  account?: ShellLink;
  /** Small print under the footer links, for example the short cookie notice. */
  footerNote?: ReactNode;
};

const navLink =
  "inline-flex min-h-11 items-center rounded-control px-3 font-bold text-ink no-underline hover:bg-tint hover:underline hover:underline-offset-4 " +
  "aria-[current=page]:bg-ink aria-[current=page]:text-paper";

/** Public pages: header with navigation, sign in and get started; footer with legal and help links. */
export function MarketingShell({
  children,
  nav = MARKETING_NAV,
  legalLinks = MARKETING_LEGAL_LINKS,
  helpLinks = MARKETING_HELP_LINKS,
  signInHref = "/signin",
  getStartedHref = "/signup/parent",
  year,
  notice,
  account,
  footerNote,
}: MarketingShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      {notice}
      <header className="border-ink bg-surface border-b-2">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
          <BrandMark href="/" />
          <div className="flex items-center gap-2 md:order-last">
            {account ? (
              <LinkButton href={account.href}>{account.label}</LinkButton>
            ) : (
              <>
                <LinkButton href={signInHref} variant="ghost">
                  Sign in
                </LinkButton>
                <LinkButton href={getStartedHref}>Get started</LinkButton>
              </>
            )}
          </div>
          <nav aria-label="Main" className="w-full md:w-auto md:flex-1">
            <ul className="-mx-3 flex flex-wrap gap-x-1 md:mx-0">
              {nav.map((item) => (
                <li key={item.href}>
                  <NavLink href={item.href} className={navLink}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>

      <footer className="border-ink bg-surface border-t-2">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <BrandMark href="/" />
            <p className="text-ink-muted max-w-sm">
              For ages 13 to 18. No ads, and we never sell or share young people&apos;s data.
            </p>
          </div>
          <FooterNav label="Help" links={helpLinks} />
          <FooterNav label="Legal" links={legalLinks} />
        </div>
        <div className="text-ink-muted mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pb-8 text-sm">
          {footerNote}
          <p>
            © {year} {BRAND_NAME}
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterNav({ label, links }: { label: string; links: ShellLink[] }) {
  return (
    <nav aria-label={label}>
      <p className="text-ink font-bold">{label}</p>
      <ul className="mt-2 flex flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="link text-ink inline-flex min-h-9 items-center font-normal">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
