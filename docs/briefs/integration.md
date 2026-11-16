# Brief: Integration pass — close the gaps between slices (test database `platform_test_misc`)

Run after the learner-facing slices have landed. You may edit any slice's files, keeping each change minimal and adding a regression test. Read docs/OPEN_QUESTIONS.md in full first: it is the list of loose ends.

## Known gaps to close
- No contract in `src/server/services` may still call `notImplemented`. List any that do and say which slice is missing.
- `/learn/[courseSlug]/complete` (spec Section 5): the finish page — what you made, submission status, certificate when issued, what to try next. No streaks or pressure.
- **Reflection and ethics-checkpoint text is not screened.** On save, run it through the crisis detector and rules moderator in `src/server/ai` (`detectCrisis`, `classify`). A crisis signal opens a safeguarding case (`openSafeguardingCase`) and shows the learner the fixed support script; other blocked categories go to the moderation queue. Saving must never fail because screening failed: log loudly and queue for a human instead. Parents never see this text.
- The spend-cap break: register a daily job that calls `endSpendCapBreak` at the start of the next UK day, and notify admins when it does.
- Coach "pause for one learner": make an enforcement restriction from the safety slice stop Coach at stage 1.
- Safeguarding trigger names: the contract accepts `abuse_disclosure`, `exploitation`, `grooming`; check the database enum maps them without loss.
- The retention job must delete `ai_message` rows past `expires_at` (policy keys `tutor_conversation_default`, `tutor_conversation_extended`, `flagged_content`).
- When an enrolment becomes complete, call `issueCertificateIfEligible` (a project accepted before the last step is finished currently gets no certificate until `/certificates` is visited).
- After hand-in the evidence step forces a full page reload; give the player session a `refresh()` instead.
- Parents need a page to read a setup guide for a tool they are asked to approve or operate, and a place to see their own reports.
- Remove stray scratch folders (for example `.smoke/`) or exclude them from lint.
- An adult learner's settings page links to `/settings/billing`; account deletion calls `cancelFamilySubscriptions`.
- Do not use `instanceof` on error classes across route handlers and services (separate bundles): check by name or code.
- Public course pages need the marketing layout's `<main>` and frame.
- Parent pages use `requireParentPage()`.
- Sign-in copies saved accessibility preferences into the cookie; settings saves them back to the profile.
- Take-down notifies enrolled learners and their parents.
- Every `page.tsx` renders for the right kind of user in a running dev server with seeded data (`pnpm db:reset && pnpm db:seed`): walk each area signed in as a 13-year-old, a 16-year-old, an 18-year-old, a parent and each staff role, and fix what breaks.
- Under-18s never see a price on any page or API response: grep for "£" and plan or price fields in every learner-reachable response.

## Verify
`pnpm typecheck`, `pnpm lint`, `pnpm test` (whole suite on your test database), `pnpm content:check`, and one `pnpm build`. Paste the real summary lines and list every fix.
