import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cn";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

export type ParentNavItem = { href: string; label: string; exact?: boolean; current?: boolean };

export const PARENT_NAV: ParentNavItem[] = [
  { href: "/parent", label: "Dashboard", exact: true },
  { href: "/parent/approvals", label: "Approvals" },
  { href: "/parent/notices", label: "Notices" },
  { href: "/parent/billing", label: "Billing" },
  { href: "/parent/privacy", label: "Privacy" },
  { href: "/parent/settings", label: "Settings" },
];

export type ParentChildLink = {
  id: string;
  /** The child's nickname. */
  nickname: string;
  /** Seed for the generated avatar: the child's user id. */
  avatarSeed: string;
  /** Where choosing this child goes: usually the same screen for that child. */
  href: string;
};

export type ParentShellProps = {
  children: ReactNode;
  /** Every child in the family. The switcher is always shown, even with none (it then offers "Add a child"). */
  childLinks: ParentChildLink[];
  /** The child currently being viewed, if the screen is about one child. */
  currentChildId?: string;
  /** Number of approvals waiting. Shown as a count beside Approvals, with the number in words for screen readers. */
  approvalsCount?: number;
  addChildHref?: string;
  /** Account notices above the page. */
  notices?: ReactNode;
  /** Optional control at the end of the top bar, for example a sign-out button. */
  account?: ReactNode;
  nav?: ParentNavItem[];
  footer?: ReactNode;
};

const navLink =
  "inline-flex min-h-11 items-center gap-2 rounded-control px-3 font-bold text-ink no-underline hover:bg-tint hover:underline hover:underline-offset-4 " +
  "aria-[current=page]:bg-ink aria-[current=page]:text-paper";

const childLink =
  "inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-surface py-1 pr-4 pl-1.5 font-bold text-ink no-underline hover:bg-tint " +
  "aria-[current=true]:bg-ink aria-[current=true]:text-paper";

/**
 * The parent frame: a calm top bar with Dashboard, Approvals (with a count),
 * Notices, Billing, Privacy and Settings, and beneath it a child switcher that
 * is on every parent screen: each child by nickname, plus "Add a child".
 */
export function ParentShell({
  children,
  childLinks,
  currentChildId,
  approvalsCount = 0,
  addChildHref = "/parent/children/new",
  notices,
  account,
  nav = PARENT_NAV,
  footer,
}: ParentShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-ink bg-surface border-b-2">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <BrandMark href="/parent" />
          {account && <div className="ml-auto md:order-last">{account}</div>}
          <nav aria-label="Main" className="w-full md:w-auto md:flex-1">
            <ul className="-mx-3 flex flex-wrap gap-x-1 md:mx-0">
              {nav.map((item) => {
                const showCount = item.href === "/parent/approvals" && approvalsCount > 0;
                return (
                  <li key={item.href}>
                    <NavLink href={item.href} exact={item.exact} current={item.current} className={navLink}>
                      {item.label}
                      {showCount && " "}
                      {showCount && (
                        <span className="border-ink bg-accent text-on-accent inline-flex min-w-6 items-center justify-center rounded-full border-2 px-1.5 text-sm font-bold">
                          {approvalsCount} <span className="sr-only">waiting</span>
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="border-line bg-paper border-t-2">
          <nav
            aria-label="Your children"
            className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
          >
            <p aria-hidden="true" className="text-ink-muted text-sm font-bold">
              {childLinks.length > 0 ? "Viewing" : "No children yet"}
            </p>
            <ul className="flex flex-wrap items-center gap-2">
              {childLinks.map((child) => (
                <li key={child.id}>
                  <Link
                    href={child.href}
                    data-button=""
                    aria-current={child.id === currentChildId ? "true" : undefined}
                    className={childLink}
                  >
                    <GeneratedAvatar seed={child.avatarSeed} size="sm" />
                    {child.nickname}
                  </Link>
                </li>
              ))}
              <li>
                <Link href={addChildHref} data-button="" className={cx(childLink, "border-dashed pl-3")}>
                  <Plus aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />
                  Add a child
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      {notices && (
        <section aria-label="Notices" className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-4">
          {notices}
        </section>
      )}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:py-8"
      >
        {children}
      </main>
      {footer && (
        <footer className="border-line text-ink-muted mx-auto w-full max-w-6xl border-t-2 px-4 py-6 text-sm">
          {footer}
        </footer>
      )}
    </div>
  );
}
