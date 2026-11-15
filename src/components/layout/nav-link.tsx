"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type NavLinkProps = {
  href: string;
  /** Match this path only, not the pages beneath it. Needed for section roots such as `/parent` and `/studio`. */
  exact?: boolean;
  /** Force the current state instead of reading the URL (showcase and tests). */
  current?: boolean;
  className?: string;
  children: ReactNode;
};

export function isCurrentPath(pathname: string | null, href: string, exact = false): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return !exact && href !== "/" && pathname.startsWith(`${href}/`);
}

/**
 * A navigation link that sets `aria-current="page"` from the URL. This is the
 * only client code in the shells: layouts are not told the pathname, so it has
 * to be read in the browser. Style the current state with `aria-[current=page]:…`.
 */
export function NavLink({ href, exact, current, className, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = current ?? isCurrentPath(pathname, href, exact);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
