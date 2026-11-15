# Design direction — "Bright workshop"

The brief leaves visual design to the build. This is the direction, applied consistently.

## Idea

A maker's workbench, not a classroom. Light, flat and bold: warm paper background, near-black ink, chunky rounded cards with a 2 px ink outline, sticker-style badges, generous type. It should feel like a tool a 16-year-old would choose, and a 13-year-old can read at a glance. No gradients-on-everything, no mascots, no stock photos of children.

Three registers share one token set:

- **Learner**: most colour and personality. Category colour blocks, sticker badges, big primary actions.
- **Parent**: calmer. Same shapes, neutral surfaces, colour only for status.
- **Studio**: dense and plain. Tables, filters, left navigation. Function over charm.

## Tokens

Defined as CSS variables in `src/app/globals.css` and exposed to Tailwind 4 via `@theme`.

| Token | Light | Use |
|---|---|---|
| `--paper` | `#FBFAF7` | Page background |
| `--surface` | `#FFFFFF` | Cards |
| `--ink` | `#14141F` | Text, outlines |
| `--ink-muted` | `#55556B` | Secondary text (7:1 on paper) |
| `--line` | `#D9D7CF` | Hairlines |
| `--primary` | `#4B32D4` | Primary actions (white text, 7.5:1) |
| `--accent` | `#C6F432` | Highlighter blocks, always with ink text |
| `--success` | `#0B6B43` | |
| `--warning` | `#8A5300` on `#FFE9B0` | |
| `--danger` | `#B3261E` | |
| `--focus` | `#14141F` ring 3 px + 2 px paper offset | Focus on every interactive element |

Dark and high-contrast themes redefine the same variables (`data-theme="dark" | "contrast"`). Category colours are six fixed hues used as blocks behind ink text, always paired with the category name and an icon.

Radius: 14 px cards, 10 px controls, full for badges. Spacing on a 4 px scale. Shadows are a flat 0 3px 0 ink offset on raised buttons and cards, removed in reduced-motion and contrast modes.

## Type

- Default: **Atkinson Hyperlegible** (self-hosted, OFL), system stack fallback. Base 17 px, line-height 1.55, headings tight and heavy.
- **Dyslexia-friendly reading mode** (`data-reading="dyslexia"`): Lexend, 1.8 line-height, wider letter and word spacing, 60ch measure, left-aligned, no italics or all-caps, cream background, underlined links.
- **Text size** (`data-text="100|112|125|150"`): scales the root font size. Layouts use `rem` and must not break at 150 %.

## Layout

- Learner: bottom tab bar on phones, left rail from 900 px. Tabs: Home, Explore, Portfolio, Settings.
- Course player: one focused column (max 72ch), a step list that collapses to a progress bar on phones, Coach as a side sheet on wide screens and a bottom sheet on phones. The player stays usable while an external tool is open in another tab.
- Parent: top bar with a child switcher that is present on every parent screen.
- Studio: fixed left navigation grouped by Content, Safety, People, Business, System.

## Motion

Short and purposeful (120–200 ms), no parallax, no autoplay. Everything honours `prefers-reduced-motion` and the stored reduced-motion preference.

## Performance budget (4 GB Chromebook)

No web-font download beyond two self-hosted families, no animation libraries, no client state library, minimal client components. Targets: LCP < 2.5 s, INP < 200 ms, CLS < 0.1.

## Preferences

Text size, theme, reading mode and reduced motion persist per user (`learner_profile.a11y`, or a cookie when signed out) and are applied on `<html>` before first paint to avoid a flash.
