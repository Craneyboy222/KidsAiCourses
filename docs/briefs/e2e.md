# Brief: End-to-end, accessibility and performance gate (test database `platform_test_e2e`)

Spec to read in full: Section 16 (testing) and Section 20 (definition of done), plus Section 3.10 accessibility and performance targets.

## Owns
`tests/e2e/**`, `tests/a11y/**`, `tests/helpers/e2e-*.ts`, `playwright.config.ts`, `scripts/lighthouse.ts`. You may fix defects you find anywhere in the app, keeping each fix minimal and adding a regression test; list every fix in your report.

## Requirements
- Global setup: reset and migrate `platform_test_e2e`, seed it (`scripts/seed.ts` logic), build once (`next build`) and serve with `.env.test` and fixture providers. No real AI, Stripe, email or Radar source is ever called.
- Journeys, each as its own spec with accessible-name selectors: under-13 blocked and nothing stored; parent sign-up, add child, consent; teen-first sign-up, parent approval, activation; invite code; learner onboarding; first course from catalogue to first completed step; age gate by direct URL; parent tool approval unblocks Start; quiz; Coach hint ladder, refusal to do homework, crisis script and case; time cap and quiet hours; submission by link auto-accepted; image upload held for review, then accepted by a moderator; certificate issued and verified; a teen never sees a price anywhere; parent upgrade through the fake Stripe driver and webhook; parent controls; data export and delete with undo; staff sign-in with 2FA; course edit, review, publish; preview secrecy; inline edit; take-down; Radar fixture run to a draft in the review queue; settings and launch-readiness gate; another family's data is unreachable.
- Accessibility: axe-core on every route in every area (signed out, learner, parent, each staff role), light, dark and contrast themes, dyslexia mode and 150% text at phone width: zero serious or critical violations. Keyboard-only run of the first-course journey. Visible focus throughout.
- Performance: Lighthouse on the home page, catalogue, a course page and the player with a mid-range mobile profile; report LCP, INP proxy (TBT) and CLS against the targets and fix what misses.
- Run everything, fix failures, and repeat until green. Report honestly what passes, what was fixed, and anything still failing with its output.

## Verify
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm content:check`, `pnpm build`, `pnpm test:e2e`, `pnpm test:a11y` — paste the real summary lines of each.
