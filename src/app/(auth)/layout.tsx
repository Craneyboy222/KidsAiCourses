import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Sign-up, sign-in, approval, invite and reset pages. Each page draws itself inside `AuthShell`
 * (the shell needs the page's own title), so this layout only sets what they share:
 *
 * - No indexing: none of these pages should be kept by a search engine.
 * - `same-origin` referrer: some of these addresses carry a one-time token or code
 *   (`/approve/[token]`, `/join/[inviteCode]`, `/reset?token=`), which must never be sent to
 *   another site in a Referer header. It must not be `no-referrer`: that makes the browser send
 *   `Origin: null` on a form post, and Next.js then refuses the Server Action, which breaks every
 *   form here for anyone without JavaScript.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
