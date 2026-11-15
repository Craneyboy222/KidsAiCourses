import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { A11Y_COOKIE, a11yHtmlAttributes, parseA11yPrefs, type Theme } from "@/components/ui/a11y-prefs";
import { SkipLink } from "@/components/ui/skip-link";
import { Toaster } from "@/components/ui/toast";
import { BRAND_NAME } from "@/lib/brand";

// Self-hosted fonts (OFL). No request ever goes to Google: next/font/google is not used.
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/atkinson-hyperlegible/700-italic.css";
// Lexend is only downloaded when the dyslexia-friendly reading mode is on.
import "@fontsource-variable/lexend/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description:
    "Learn today's AI tools by making things you actually care about. Short projects for ages 13 to 18, with a portfolio to show for it.",
  applicationName: BRAND_NAME,
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

/** Browser chrome colour: the paper colour of each theme in globals.css. */
const THEME_COLOUR: Record<Theme, string> = { light: "#fbfaf7", dark: "#12121c", contrast: "#ffffff" };

async function readA11yPrefs() {
  const cookieStore = await cookies();
  return parseA11yPrefs(cookieStore.get(A11Y_COOKIE)?.value);
}

export async function generateViewport(): Promise<Viewport> {
  const prefs = await readA11yPrefs();
  // Zoom is never restricted: no maximum-scale, no user-scalable=no.
  return { width: "device-width", initialScale: 1, themeColor: THEME_COLOUR[prefs.theme] };
}

/**
 * The accessibility preferences are read from the `a11y` cookie and written
 * onto <html> on the server, so the first paint already has the right theme,
 * text size, reading mode and motion setting: no flash, and no inline script.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await readA11yPrefs();
  return (
    <html lang="en-GB" {...a11yHtmlAttributes(prefs)}>
      <body>
        <SkipLink />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
