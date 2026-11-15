import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { A11yPreferences, Card, Markdown, PageHeader, THEMES, type Theme } from "@/components/ui";
import { A11Y_COOKIE, parseA11yPrefs } from "@/components/ui/a11y-prefs";
import { Demos } from "./demos";
import { Gallery } from "./gallery";
import { assertKitAvailable } from "./guard";

export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };

const THEME_NAMES: Record<Theme, string> = {
  light: "Light theme",
  dark: "Dark theme",
  contrast: "High-contrast theme",
};
const SHELLS = ["marketing", "auth", "learner", "parent", "studio", "player"] as const;

const READING_SAMPLE = `Reading mode changes the *typeface*, the spacing and the line length, not just the colours.

Lines are shorter, there is more room between lines, letters and words, nothing is in italics or capitals, and [links are underlined](/dev/kit).`;

/**
 * The kit showcase, for visual checks and axe. Development and test only: see `assertKitAvailable`.
 * Static components are rendered three times, once per theme. Overlays and other interactive
 * components follow the page theme: change it with the preferences panel at the top.
 */
export default async function KitPage() {
  assertKitAvailable();
  const prefs = parseA11yPrefs((await cookies()).get(A11Y_COOKIE)?.value);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-8 outline-none"
    >
      <PageHeader
        title="UI kit"
        description="Every component in every variant, in all three themes. For visual checks and automated accessibility checks. Not available in production."
      />

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <A11yPreferences initial={prefs} />
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl">Layout shells</h2>
          <p className="text-ink-muted">Each shell on its own page, with sample content.</p>
          <ul className="flex flex-col">
            {SHELLS.map((shell) => (
              <li key={shell}>
                <Link href={`/dev/kit/shells/${shell}`} className="link inline-flex min-h-9 items-center">
                  {shell.charAt(0).toUpperCase() + shell.slice(1)} shell
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="flex flex-col gap-6">
        <h2>Interactive components</h2>
        <Demos />
      </section>

      {THEMES.map((theme) => (
        <section
          key={theme}
          data-theme={theme}
          data-kit-theme={theme}
          className="rounded-card border-ink flex flex-col gap-8 border-2 p-4 sm:p-6"
        >
          <h2>{THEME_NAMES[theme]}</h2>
          <Gallery theme={theme} />
        </section>
      ))}

      <section
        data-theme="light"
        data-reading="dyslexia"
        className="rounded-card border-ink flex flex-col gap-4 border-2 p-4 sm:p-6"
      >
        <h2>Dyslexia-friendly reading mode</h2>
        <Markdown topHeadingLevel={3}>{READING_SAMPLE}</Markdown>
      </section>
    </main>
  );
}
