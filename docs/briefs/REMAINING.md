# Brief: what is built and what is left (16 November 2026)

This brief replaces the queue in `goal-engine-plan.md` and overrides the "Tests" and "Verify"
sections of every other brief in this folder. Read `HANDOVER.md` first for how to run the project.

## Owner's standing instructions (16 November 2026)

1. **Finish the build.** Work through the queue below in order.
2. **Do not write or run tests.** No new test files, no `pnpm test`, no Playwright suites. Checks
   allowed per slice: `pnpm typecheck`, `pnpm lint` on the files you touched, `pnpm content:check`
   if content changed, one `pnpm build`, and opening the pages in the running site as the right
   kind of user. Existing tests stay in the repo; do not delete them, and do not repair ones your
   change breaks: list them in the report instead.
3. **Do not author any more courses.** The catalogue stops at the five in `content/courses/`.
   `courses-a.md`, `courses-b.md` and `e2e.md` are parked.
4. **Ask before**: any paid service, new data processor or AI provider; pushing to `main`;
   deploying; sending anything; deleting anything outside the working tree.
5. On any ambiguity take the reading that is safer for children, record it in
   `docs/DECISIONS.md`, and carry on.

## Built and committed (branch `build/launch`)

| Area | State |
|---|---|
| Foundation: schema (90 tables), auth, authz matrix, audit, settings, jobs, storage, email, flags | Done |
| UI kit (57 components), shells, design tokens | Done |
| Content model, validation (52 rules), course store, review and publish services | Done |
| Accounts, family, consent, age assurance, teen sign-up and parent approval | Done |
| Catalogue, course pages, course player, quizzes, progress, usage limits | Done |
| Tools, start gates, submissions, evidence checks, moderation services, portfolio, certificates | Done |
| AI Coach: guardrail pipeline, credits, endpoints, 353 eval cases | Done, with the caveat below |
| Payments: plans, entitlements, unlock requests, billing pages, webhook | Done on the fake Stripe driver only |
| Parent area: dashboard, child pages, controls, approvals, notices, privacy, data export and deletion | Done |
| Marketing site, help centre, legal drafts, robots, sitemap, service worker | Done |
| Seed data, placeholder media, retention sweep, compliance and operations docs | Done |
| Five starter courses and 175 imported course ideas | Done (stops here) |
| Production build (`pnpm build`) | Passed for the first time on 16 November 2026 |

## Not built: the queue, in order

Run at most two at once, and never the integration pass alongside a slice that edits the same
learner or parent pages.

1. **Integration pass** — `integration.md`. Closes the gaps between slices. It was started and
   stopped about a minute in, so treat it as not started. Skip its "regression test" and "Verify"
   instructions (rule 2). The items that matter most:
   - reflection and ethics text is not yet screened for crisis signals;
   - the launch gate passes on unreviewed legal drafts and must not;
   - `/learn/[courseSlug]/complete` does not exist;
   - certificates are not issued when an enrolment completes;
   - `content/pages/**` and `content/prompts/**` are read from disk at run time and need
     `outputFileTracingIncludes` so a hosted build includes them;
   - there is no way to create the first staff account in production.
2. **Studio core** — `studio-core.md`. Nothing exists: `src/app/(studio)` is absent and staff
   sign-in lands on a 404.
3. **Studio safety** — `studio-safety.md`. Fills the `safeguarding.ts` contract
   (`openSafeguardingCase`, `countSafetyNoticesForLearner`), which still throws `notImplemented`;
   callers tolerate that today.
4. **Studio content** — `studio-content.md`. Fills the `preview.ts` contract (`resolvePreview`),
   which still throws `notImplemented`.
5. **AI course creation engine** — `engine.md`. Tool Radar, drafting, ideas, edit requests. Drafts
   are never published without a human approving them.
6. **Independent review** — a fresh agent that has not seen the build reads the spec against the
   running site and lists what is missing or wrong. Report only; fixes follow as a separate step.

Parked by the owner: ten further starter courses (`courses-a.md`, `courses-b.md`) and the
end-to-end, accessibility and performance gate (`e2e.md`).

## Known weaknesses to carry forward

- **Coach crisis detection is rule-based and misses unfamiliar phrasing** (20 of 30 to 45 of 52
  caught in trials). Coach must not open to real children until the safeguarding lead has
  reviewed it and a real classifier is in place.
- **Never exercised**: the real Stripe driver, S3 storage, the service worker, CI
  (`.github/workflows/ci.yml`), any hosted deployment.
- `pnpm format:check` fails on about 345 files. Formatting only; not blocking.
- The legal pages are drafts with many points marked ⚖️ for a lawyer.
- Sign-up is closed by default and stays closed until the launch-readiness checklist passes.

## Decisions waiting for the owner (none blocks the queue)

Listed in full in `docs/OPEN_QUESTIONS.md`. The main ones: whether a moderator views every image
and video until an image-check provider is approved, or uploads are switched off; whether a
parent's data export includes the child's private writing; refund behaviour, the seven-day grace
period, one trial per family, and when the founding price lock ends.
