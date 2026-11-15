/**
 * Layout shells, one per route group. All presentational: no data fetching and
 * no session reads. Pass everything in as props from the route group's layout.
 */
export { BrandGlyph, BrandMark, type BrandMarkProps } from "./brand-mark";
export { NavLink, isCurrentPath, type NavLinkProps } from "./nav-link";
export {
  MARKETING_HELP_LINKS,
  MARKETING_LEGAL_LINKS,
  MARKETING_NAV,
  MarketingShell,
  type MarketingShellProps,
  type ShellLink,
} from "./marketing-shell";
export { AuthShell, type AuthShellProps } from "./auth-shell";
export { LEARNER_NAV, LearnerShell, type LearnerNavItem, type LearnerShellProps } from "./learner-shell";
export {
  PARENT_NAV,
  ParentShell,
  type ParentChildLink,
  type ParentNavItem,
  type ParentShellProps,
} from "./parent-shell";
export {
  StaffAreaMarker,
  StudioShell,
  buildStudioNav,
  type StudioNavGroup,
  type StudioNavItem,
  type StudioNavKey,
  type StudioShellProps,
} from "./studio-shell";
export { PlayerNext, PlayerPrevious, PlayerShell, type PlayerShellProps } from "./player-shell";
