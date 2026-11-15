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

| Token                                        | Light                                                                   | Dark                              | High contrast                     | Use                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `--paper`                                    | `#FBFAF7`                                                               | `#12121C`                         | `#FFFFFF`                         | Page background                                       |
| `--surface`                                  | `#FFFFFF`                                                               | `#1C1C2B`                         | `#FFFFFF`                         | Cards, inputs                                         |
| `--tint`                                     | `#F0EEE6`                                                               | `#2A2A3E`                         | `#EBEBEB`                         | Hover fills, table headers, quiet panels              |
| `--ink`                                      | `#14141F`                                                               | `#F5F4EF`                         | `#000000`                         | Text, outlines                                        |
| `--ink-muted`                                | `#53536A`                                                               | `#B8B7CC`                         | `#2B2B2B`                         | Secondary text (7.1:1 on paper in light)              |
| `--line`                                     | `#D9D7CF`                                                               | `#3A3A52`                         | `#000000`                         | Hairlines (decorative only, never a control boundary) |
| `--primary` / `--on-primary`                 | `#4B32D4` / `#FFFFFF`                                                   | `#B3A6FF` / `#14141F`             | `#2A0FA8` / `#FFFFFF`             | Primary actions (7.8:1 in light)                      |
| `--primary-hover`                            | `#3A24B0`                                                               | `#CBC2FF`                         | `#1B0080`                         |                                                       |
| `--link`                                     | `#4B32D4`                                                               | `#B3A6FF`                         | `#2A0FA8`                         | Inline links, always underlined                       |
| `--accent` / `--on-accent`                   | `#C6F432` / `#14141F`                                                   | same                              | `#C6F432` / `#000000`             | Highlighter blocks, always with ink text              |
| `--success` / `--success-soft`               | `#0B6B43` / `#DDF3E7`                                                   | `#6EE0A8` / `#0F3324`             | `#00522F` / `#E6F6EE`             |                                                       |
| `--warning` / `--warning-soft`               | `#8A5300` / `#FFE9B0`                                                   | `#FFD071` / `#3D2C00`             | `#5A3500` / `#FFF0C2`             |                                                       |
| `--danger` / `--danger-soft` / `--on-danger` | `#B3261E` / `#FCE4E1` / `#FFFFFF`                                       | `#FF9E96` / `#45100C` / `#14141F` | `#8F0F08` / `#FDE8E6` / `#FFFFFF` |                                                       |
| `--info` / `--info-soft`                     | `#1D4F91` / `#E2EEFF`                                                   | `#9CCBFF` / `#10304F`             | `#003E7A` / `#E3F0FF`             |                                                       |
| `--cat-1` … `--cat-6` / `--on-cat`           | `#CFC6FF` `#A8DCFF` `#A6EFC9` `#FFD95A` `#FFB3A1` `#FFB8E0` / `#14141F` | same                              | same / `#000000`                  | Category blocks                                       |
| `--focus` / `--focus-gap`                    | `#14141F` / `#FBFAF7`                                                   | `#F5F4EF` / `#12121C`             | `#000000` / `#FFFFFF`             | 3 px ring + 2 px gap on every interactive element     |

`--ink-muted` was `#55556B` in the first draft; that measured 6.94:1 on paper, so it was darkened to `#53536A` to make the 7:1 claim true. Every text and background pair above is asserted at 4.5:1, and every control boundary and state indicator at 3:1, in all three themes and on the cream paper of the reading mode, by `tests/unit/ui/contrast.test.ts`, which reads the values straight out of `globals.css`.

Tailwind's stock palette is switched off (`--color-*: initial`), so only these tokens exist as utilities: `bg-paper`, `text-ink-muted`, `border-ink`, `bg-cat-3`, and so on.

Dark and high-contrast themes redefine the same variables (`data-theme="dark" | "contrast"`). Category colours are six fixed hues used as blocks behind ink text, always paired with the category name and an icon. Each of the 24 launch categories has a fixed hue and icon in `src/components/ui/category-block.tsx`.

The dyslexia-friendly reading mode swaps the light theme's paper for cream (`--paper #FAF3DD`, `--surface #FFFBEE`, `--tint #EFE6C8`); the dark and high-contrast themes keep their own colours and take the typography only.

Radius: 14 px cards (`rounded-card`), 10 px controls (`rounded-control`), full for badges. Spacing on a 4 px scale (Tailwind's default, in rem). Shadows are a flat 0 3px 0 ink offset on raised buttons and cards (`shadow-raised`), removed in reduced-motion and contrast modes through one variable, `--press`, which is also how far a raised button travels when pressed.

## Type

- Default: **Atkinson Hyperlegible** (self-hosted, OFL), system stack fallback. Base 17 px, line-height 1.55, headings tight and heavy.
- **Dyslexia-friendly reading mode** (`data-reading="dyslexia"`): Lexend, 1.8 line-height, wider letter and word spacing, 60ch measure, left-aligned, no italics or all-caps, cream background, underlined links.
- **Text size** (`data-text="100|112|125|150"`): scales the root font size. Layouts use `rem` and must not break at 150 %. Checked at 150 % on a 380 px phone with the reading mode on: nothing scrolls sideways.
- Type scale (rem, so it follows the text-size preference): `text-xs` 0.8125, `text-sm` 0.9, `text-base` 1, `text-lg` 1.15, `text-xl` 1.35, `text-2xl` 1.65, `text-3xl` 2.1, `text-4xl` 2.75. Reading measure: `max-w-measure` (72ch, or 60ch in the reading mode).

## Layout

- Learner: bottom tab bar on phones, left rail from 900 px. Tabs: Home, Explore, Portfolio, Settings.
- Course player: one focused column (max 72ch), a step list that collapses to a progress bar on phones, Coach as a side sheet on wide screens and a bottom sheet on phones. The player stays usable while an external tool is open in another tab.
- Parent: top bar with a child switcher that is present on every parent screen.
- Studio: fixed left navigation grouped by Content, Safety, People, Business, System.

## Motion

Short and purposeful (120–200 ms), no parallax, no autoplay. Everything honours `prefers-reduced-motion` and the stored reduced-motion preference (`data-motion="reduce"`): both switch every animation and transition off. Skeletons are still blocks, not pulses; the only thing that moves by itself is the loading spinner, and it stops too.

## Performance budget (4 GB Chromebook)

No web-font download beyond two self-hosted families, no animation libraries, no client state library, minimal client components. Targets: LCP < 2.5 s, INP < 200 ms, CLS < 0.1.

## Preferences

Text size, theme, reading mode and reduced motion persist per user (`learner_profile.a11y`, or a cookie when signed out) and are applied on `<html>` before first paint to avoid a flash. The cookie is `a11y`, JSON `{ theme, reading, text, motion }`; the root layout reads it on the server and writes the four `data-*` attributes onto `<html>`. `parseA11yPrefs` in `src/components/ui/a11y-prefs.ts` is the one parser for the cookie and the profile column.
