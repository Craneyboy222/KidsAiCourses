import { Compass, FolderHeart, House, Settings, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

export type LearnerNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  current?: boolean;
};

export const LEARNER_NAV: LearnerNavItem[] = [
  { href: "/home", label: "Home", icon: House },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/portfolio", label: "Portfolio", icon: FolderHeart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export type LearnerShellProps = {
  children: ReactNode;
  /** The learner's nickname. Never a real name or an email address. */
  nickname: string;
  /** Seed for the generated avatar: the user id. Learners never have photos. */
  avatarSeed: string;
  /** Account notices above the page: paused, quiet hours, a waiting approval. */
  notices?: ReactNode;
  /** Optional control beside the nickname, for example a sign-out button. */
  account?: ReactNode;
  nav?: LearnerNavItem[];
  footer?: ReactNode;
};

const tab =
  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold text-ink no-underline hover:bg-tint " +
  "aria-[current=page]:bg-accent aria-[current=page]:text-on-accent aria-[current=page]:shadow-[inset_0_4px_0_var(--ink)] " +
  "rail:min-h-11 rail:flex-row rail:justify-start rail:gap-3 rail:rounded-control rail:border-2 rail:border-transparent rail:px-3 rail:text-base " +
  "rail:aria-[current=page]:border-ink rail:aria-[current=page]:shadow-none";

/**
 * The learner frame: a bottom tab bar on phones and a left rail from 900 px,
 * with Home, Explore, Portfolio and Settings. It shows the nickname and the
 * generated avatar, and it has no slot for prices: learners never see them.
 */
export function LearnerShell({
  children,
  nickname,
  avatarSeed,
  notices,
  account,
  nav = LEARNER_NAV,
  footer,
}: LearnerShellProps) {
  return (
    <div className="rail:flex-row flex min-h-dvh flex-col">
      <header className="border-ink bg-surface rail:sticky rail:top-0 rail:h-dvh rail:w-60 rail:shrink-0 rail:flex-col rail:flex-nowrap rail:items-stretch rail:justify-start rail:gap-6 rail:border-r-2 rail:border-b-0 rail:p-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 px-4 py-2">
        <BrandMark href="/home" />

        <nav
          aria-label="Main"
          className="border-ink bg-surface rail:static rail:border-t-0 rail:pb-0 fixed inset-x-0 bottom-0 z-40 border-t-2 pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="rail:flex rail:flex-col rail:gap-1 grid auto-cols-fr grid-flow-col">
            {nav.map(({ href, label, icon: Glyph, exact, current }) => (
              <li key={href}>
                <NavLink href={href} exact={exact} current={current} className={tab}>
                  <Glyph
                    aria-hidden="true"
                    focusable="false"
                    className="rail:size-5 size-6 shrink-0"
                    strokeWidth={2.25}
                  />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="rail:mt-auto rail:border-t-2 rail:border-line rail:pt-4 flex min-w-0 items-center gap-2">
          <GeneratedAvatar seed={avatarSeed} size="md" />
          <p className="text-ink min-w-0 truncate font-bold">
            <span className="sr-only">Signed in as</span> {nickname}
          </p>
          {account && <div className="ml-auto">{account}</div>}
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        {notices && (
          <section aria-label="Notices" className="rail:px-8 flex flex-col gap-3 px-4 pt-4">
            {notices}
          </section>
        )}
        {/* Bottom padding keeps the last line clear of the tab bar on phones. */}
        <main
          id="main"
          tabIndex={-1}
          className="rail:px-8 rail:pb-12 mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 outline-none"
        >
          {children}
        </main>
        {footer && (
          <footer className="text-ink-muted rail:px-8 rail:pb-8 px-4 pb-24 text-sm">{footer}</footer>
        )}
      </div>
    </div>
  );
}
