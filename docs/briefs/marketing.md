# Brief: Marketing site, help centre, legal pages, PWA (test database `platform_test_misc`)

Spec to read in full: Section 1 (positioning, non-goals, voice), Section 2 personas, the Marketing screens in Section 5, Section 3.10 (PWA, accessibility, SEO rules), Section 9 transparency and cookies, Section 17 legal questions. Decisions D15 and D16.

## Owns
`src/app/(marketing)/layout.tsx` and pages `/` (replace the placeholder), `/how-it-works`, `/safety`, `/for-parents`, `/pricing`, `/help` and `/help/[slug]`, `/legal/[slug]`, `/radar` (what our crawler is and how to block it), `/offline`. `src/app/robots.ts`, `src/app/sitemap.ts`, `public/sw.js` with its registration, `content/pages/**` (marketing, help and legal page drafts as Markdown with front matter) and `scripts/import-pages.ts`. Tests in `tests/unit/marketing`, `tests/integration/marketing`. The public course pages under `/courses` belong to the learning slice.

## Requirements
- Home explains in one screen what it is, who it is for and that it is safe, with honest claims only: no fake testimonials, no invented numbers, no "trusted by". Calls to action: parents get started; teens can ask a parent. Show real course cards from the catalogue.
- Safety and For parents pages: how accounts, consent, external tools, Coach guardrails, moderation and reporting actually work, written from what the product does.
- Pricing: plans from `listPublicPlans` (payments slice; if it is not there yet, read the `plan` table through a tiny local function and say so). A signed-in under-18 visiting `/pricing` sees the "Ask a parent" page, not prices.
- Legal pages render published `page` rows by the D16 slugs. Write careful DRAFTS for privacy (adult), privacy (teen, in plain words a 13-year-old can follow), terms, cookies, community code and AI use policy, with every legal decision marked `⚖️ TO CONFIRM` and a banner "Draft — not yet reviewed by a lawyer". The importer loads them as drafts, never published, so the launch-readiness gate stays closed until a human publishes them.
- Help centre: at least 15 real articles from how the product works (accounts, invite codes, consent, tools and approvals, Coach, energy, time caps, submissions and review, certificates, data download and deletion, reporting a concern, billing for parents). Teen and parent audiences.
- SEO: marketing, public course and help pages are indexable with good metadata and Open Graph; everything signed-in, `/verify`, `/approve`, `/join` and previews are `noindex` and excluded from the sitemap.
- Cookies: strictly necessary only (session, accessibility preferences, age-gate flag). No analytics or advertising cookies, so no consent banner — a short cookie notice instead. No third-party scripts, fonts or embeds.
- PWA: installable; the service worker caches only the static shell and the `/offline` page. It must never cache HTML or API responses for signed-in areas, and it clears its caches on sign-out.
- WCAG 2.2 AA; fast on a 4 GB Chromebook; no layout shift; images with dimensions and alt text; no stock photos of children.

## Tests required
Under-18 never sees a price on `/pricing`; legal drafts import unpublished; sitemap excludes private routes; robots rules; service worker never caches a protected path (unit test of the routing function); help search.

## Verify
typecheck; eslint on your paths; your vitest paths; dev server on port 3213: `/`, `/safety`, `/pricing`, `/help`, `/legal/privacy` (draft banner or not-published state) return sensible responses.
