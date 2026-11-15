import {
  Activity,
  BadgePoundSterling,
  Bot,
  ChartLine,
  ClipboardCheck,
  FileText,
  Flag,
  GraduationCap,
  Images,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Mail,
  Menu,
  Radar,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Tag,
  ToggleRight,
  UserCog,
  Users,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

export type StudioNavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Whether this member of staff may see the screen. Hidden items are not rendered at all. */
  visible: boolean;
  /** A count of things waiting, for example items in the review queue. */
  badge?: number;
  exact?: boolean;
  current?: boolean;
};

export type StudioNavGroup = { label: string; items: StudioNavItem[] };

const NAV = {
  Content: [
    { key: "courses", href: "/studio/courses", label: "Courses", icon: GraduationCap },
    { key: "review", href: "/studio/review", label: "Review", icon: ClipboardCheck },
    { key: "generate", href: "/studio/generate", label: "Generate", icon: WandSparkles },
    { key: "ideas", href: "/studio/ideas", label: "Ideas", icon: Lightbulb },
    { key: "radar", href: "/studio/radar", label: "Tool Radar", icon: Radar, exact: true },
    { key: "radar-changes", href: "/studio/radar/changes", label: "Tool changes", icon: Activity },
    { key: "tools", href: "/studio/tools", label: "Tool Register", icon: Wrench },
    { key: "assets", href: "/studio/assets", label: "Assets", icon: Images },
    { key: "pages", href: "/studio/pages", label: "Pages", icon: FileText },
    { key: "emails", href: "/studio/emails", label: "Emails", icon: Mail },
  ],
  Safety: [
    { key: "moderation", href: "/studio/moderation", label: "Moderation", icon: Flag },
    { key: "safeguarding", href: "/studio/safeguarding", label: "Safeguarding", icon: Siren },
    { key: "audit", href: "/studio/audit", label: "Audit log", icon: ScrollText },
  ],
  People: [
    { key: "users", href: "/studio/users", label: "Users and families", icon: Users },
    { key: "support", href: "/studio/support", label: "Support", icon: LifeBuoy },
    { key: "staff", href: "/studio/staff", label: "Staff", icon: UserCog },
  ],
  Business: [
    { key: "analytics", href: "/studio/analytics", label: "Analytics", icon: ChartLine },
    { key: "plans", href: "/studio/plans", label: "Plans", icon: BadgePoundSterling },
    { key: "promos", href: "/studio/promos", label: "Promo codes", icon: Tag },
  ],
  System: [
    { key: "ai", href: "/studio/ai", label: "AI controls", icon: Bot },
    { key: "flags", href: "/studio/flags", label: "Feature flags", icon: ToggleRight },
    { key: "settings", href: "/studio/settings", label: "Settings", icon: Settings },
  ],
} as const satisfies Record<
  string,
  ReadonlyArray<{ key: string; href: string; label: string; icon: LucideIcon; exact?: boolean }>
>;

export type StudioNavKey = (typeof NAV)[keyof typeof NAV][number]["key"];

/**
 * Builds the standard Studio navigation (every `/studio/*` screen in the spec),
 * grouped Content, Safety, People, Business, System. `canSee` decides each item
 * from the member of staff's permissions; `badges` adds waiting counts.
 */
export function buildStudioNav(
  canSee: (key: StudioNavKey) => boolean,
  badges: Partial<Record<StudioNavKey, number>> = {},
): StudioNavGroup[] {
  return Object.entries(NAV).map(([label, items]) => ({
    label,
    items: items.map(({ key, ...item }) => ({ ...item, visible: canSee(key), badge: badges[key] })),
  }));
}

export type StudioShellProps = {
  children: ReactNode;
  /** Navigation groups. Items with `visible: false` and groups left empty are not rendered. */
  groups: StudioNavGroup[];
  /** Shown under the marker: who is signed in, for example the staff member's name and role. */
  staffLabel?: ReactNode;
  /** Optional control under the navigation, for example a sign-out button. */
  account?: ReactNode;
  /** Notices above the page, for example the launch-readiness warning. */
  notices?: ReactNode;
};

const navLink =
  "flex min-h-10 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm font-bold text-ink no-underline hover:bg-tint hover:underline hover:underline-offset-4 " +
  "aria-[current=page]:bg-ink aria-[current=page]:text-paper";

function StudioNav({ groups }: { groups: StudioNavGroup[] }) {
  const id = useId();
  const shown = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.visible) }))
    .filter((group) => group.items.length > 0);
  return (
    <nav aria-label="Studio" className="flex flex-col gap-4">
      <NavLink href="/studio" exact className={navLink}>
        <LayoutDashboard
          aria-hidden="true"
          focusable="false"
          className="size-4 shrink-0"
          strokeWidth={2.25}
        />
        Overview
      </NavLink>
      {shown.map((group, index) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p id={`${id}-${index}`} className="text-ink-muted px-2.5 text-xs font-bold">
            {group.label}
          </p>
          <ul aria-labelledby={`${id}-${index}`} className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Glyph, badge, exact, current }) => (
              <li key={href}>
                <NavLink href={href} exact={exact} current={current} className={navLink}>
                  {Glyph && (
                    <Glyph
                      aria-hidden="true"
                      focusable="false"
                      className="size-4 shrink-0"
                      strokeWidth={2.25}
                    />
                  )}
                  <span className="min-w-0 flex-1">{label}</span>{" "}
                  {badge !== undefined && badge > 0 && (
                    <span className="border-ink bg-accent text-on-accent inline-flex min-w-6 items-center justify-center rounded-full border-2 px-1.5 text-xs font-bold">
                      {badge} <span className="sr-only">waiting</span>
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The persistent "Staff area" marker: ink block, shield icon and words, so it never relies on colour. */
export function StaffAreaMarker() {
  return (
    <p
      data-surface="ink"
      className="bg-ink text-paper inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold"
    >
      <ShieldCheck aria-hidden="true" focusable="false" className="size-4 shrink-0" strokeWidth={2.5} />
      Staff area
    </p>
  );
}

/**
 * The Studio frame for staff: a fixed left navigation grouped Content, Safety,
 * People, Business and System, where each item is shown only if its `visible`
 * flag is true, and a "Staff area" marker that is always on screen. Dense and
 * plain on purpose. Below 1024 px the navigation folds into a Menu disclosure.
 */
export function StudioShell({ children, groups, staffLabel, account, notices }: StudioShellProps) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <header className="border-ink bg-surface sticky top-0 z-30 border-b-2 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r-2 lg:border-b-0">
        <div className="lg:border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 lg:flex-col lg:items-start lg:gap-2 lg:border-b-2 lg:py-3">
          <BrandMark href="/studio" compact />
          <div className="flex flex-col items-end gap-0.5 lg:items-start">
            <StaffAreaMarker />
            {staffLabel && <p className="text-ink-muted text-xs">{staffLabel}</p>}
          </div>
        </div>

        {/* Phones and tablets: the same navigation inside a native disclosure, so it needs no JavaScript. */}
        <details className="group border-line border-t-2 lg:hidden">
          <summary className="text-ink hover:bg-tint flex min-h-11 list-none items-center gap-2 px-3 font-bold -outline-offset-4 [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden="true" focusable="false" className="size-5" strokeWidth={2.5} />
            Menu
          </summary>
          <div className="border-line max-h-[70dvh] overflow-y-auto border-t-2 p-3">
            <StudioNav groups={groups} />
            {account && <div className="border-line mt-4 border-t-2 pt-3">{account}</div>}
          </div>
        </details>

        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <StudioNav groups={groups} />
          </div>
          {account && <div className="border-line border-t-2 p-3">{account}</div>}
        </div>
      </header>

      {notices && (
        <section aria-label="Notices" className="flex flex-col gap-3 px-4 pt-4 lg:px-8">
          {notices}
        </section>
      )}
      <main id="main" tabIndex={-1} className="w-full px-4 py-6 outline-none lg:px-8">
        {children}
      </main>
    </div>
  );
}
