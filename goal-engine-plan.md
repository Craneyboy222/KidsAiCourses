# Execution plan — launch platform

**Goal.** Build the launch platform in `PLATFORM_SPEC.md` in full, as a single Next.js app, until complete.
**Classification.** HYBRID: SAAS_TOOL + CONTENT_PLATFORM + AUTOMATION_SYSTEM (course creation engine).
**Feasibility.** GO, with one adjustment: live deployment and third-party accounts wait for owner approval. Everything runs locally against real Postgres with mocked or fixture providers.
**Strategy.** Sequential foundation, then parallel vertical slices, then a full gate.

## Success criteria (how completion is verified)

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm content:check` all exit 0.
2. `pnpm db:migrate && pnpm db:seed` builds an explorable environment on a clean database.
3. `pnpm build` succeeds.
4. Playwright journeys in Section 16 pass against a running app.
5. axe-core reports zero serious or critical violations on every route.
6. Coach evals meet the Section 8 thresholds on fixtures.
7. A fresh-context reviewer checks the build against the spec feature list (61 features) and reports gaps; gaps are fixed or logged.

## Phases

| # | Phase | Output | Verify |
|---|---|---|---|
| 1 | Foundation | Scaffold, tooling, env, schema + migrations, authz, content schema, UI kit, layouts, auth, audit, settings, test harness | typecheck, lint, migrate on clean DB, unit tests |
| 2 | Accounts, family, consent | Sign-up flows, under-13 block, invites, safety bands, staff 2FA, consent centre | unit + e2e sign-up journeys |
| 3 | Learning | Catalogue, course page, player, progress, quizzes, hints, caps | e2e first course, age gate by URL |
| 4 | Tools and submissions | Tool Register, guides, approvals, evidence, moderation, portfolio, certificates | e2e tool approval, submission moderation |
| 5 | Coach | Proxy, credits, crisis pathway, evals | stage tests, concurrency test, evals |
| 6 | Parents and payments | Dashboard, controls, data requests, Stripe | webhook fixtures, "teen never sees prices" |
| 7 | Studio | CMS, queues, settings, audit, staff | authz matrix, take-down e2e |
| 8 | Course creation engine | Radar, drafting, on-demand, review, preview, tool watch | engine tests with mocked sources |
| 9 | Seed content | 15 courses, tools, ideas, help, legal, emails | `content:check`, seed run |
| 10 | Compliance and operations | Retention job, compliance docs, runbooks, launch-readiness gate | unit tests, docs present |
| 11 | Full gate | All suites, a11y, performance, independent review | criteria 1–7 |
| 12 | Deployment readiness | Vercel config, env docs, go-live checklist. **Not deployed without approval.** | build passes; checklist reviewed |

Phases 2–9 depend on phase 1. Phases 2–8 run as parallel slices with separate file ownership; phase 9 runs alongside them.

## Build order (revised 16 November 2026)

The owner asked for the learner-facing path first, so a clickable site exists as early as possible. Two workstreams run at a time to stay inside the usage limit.

1. Accounts (finishing) and Learning (catalogue, course page, player)
2. Tools, start gate, submissions, portfolio, certificates; the remaining starter courses
3. Seed data and placeholder assets — **first clickable build**: sign up, browse, take a course, submit
4. Payments; Parents
5. Marketing site, help and legal drafts
6. Studio core; Studio content; Studio safety
7. Course creation engine
8. End-to-end, accessibility and performance gate; independent review
