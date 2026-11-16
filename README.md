# [Platform Name]

A UK learning platform where teenagers aged 13 to 18 build real projects with AI tools, with an AI
Coach that nudges rather than does the work, and with parents in control. One Next.js app
(App Router, TypeScript strict), Postgres through Drizzle, no microservices.

`PLATFORM_SPEC.md` is the source of truth. `docs/DECISIONS.md` records where an ambiguity was
resolved, and `docs/OPEN_QUESTIONS.md` lists what still needs the owner, a lawyer (⚖️) or the
safeguarding lead.

> **Status, 16 November 2026.** Built: accounts and consent, the catalogue and course player, tools
> and submissions, Coach, payments (fake Stripe driver exercised; the real one has never run),
> parent dashboard, marketing and help pages, seed data, retention. Not built: Studio, safeguarding
> cases, the Tool Radar and course drafting engine. Nothing is deployed. See `HANDOVER.md` and
> `docs/briefs/REMAINING.md`.

## Quick start

You need Node 22, pnpm 10, PostgreSQL 16 and (for placeholder videos) ffmpeg.

```bash
pnpm install

# 1. Environment. Both files are git-ignored. .env.example explains every variable.
cp .env.example .env.local        # then set the values marked "required"
cp .env.example .env.test         # APP_ENV=test, NODE_ENV=test, DATABASE_URL=…/platform_test, STAFF_2FA_REQUIRED=false

# 2. Databases (role app/app). On this machine Postgres does not survive a restart:
#    pg_ctlcluster 16 main start
createdb -O app platform_dev && createdb -O app platform_test

# 3. Schema and seed data
pnpm db:migrate
pnpm db:seed                      # also makes the placeholder trailers and sample images

# 4. Run it
pnpm dev                          # http://localhost:3000
```

Sign in at <http://localhost:3000/signin>: the "Learner" tab takes a username, the "Parent or
carer" tab an email address (staff use that tab too).

**On another port**, sign-in needs to be told the address, or it refuses the request as coming
from a site it does not know:

```bash
BETTER_AUTH_URL=http://localhost:3218 NEXT_PUBLIC_APP_URL=http://localhost:3218 pnpm dev -p 3218
```

**If every page keeps reloading** and sign-in never completes (the browser console says
`HMR hash mismatch`): stop the server and start it again. If it still happens, delete the
`.next/dev` folder first; nothing is lost, it is rebuilt on the next request. This was seen twice
on 16 November 2026, both times while other work was changing files in the same folder, and not
on a quiet checkout (`docs/OPEN_QUESTIONS.md`, last section).

`pnpm db:seed` prints a table of accounts when it finishes. Every account uses the password in
`SEED_PASSWORD`. Parents and staff sign in with their email address, learners with their username.

| Who | Sign in with | What to look at |
|---|---|---|
| Owner (`super_admin`) | `OWNER_BOOTSTRAP_EMAIL` | Studio, when its screens land. Needs the two-step code. |
| One account per staff role | `admin@`, `editor@`, `reviewer@`, `safety.reviewer@`, `moderator@`, `dsl@`, `support@example.test` | Needs the two-step code. |
| Parent, Free plan | `parent.free@example.test` | Dashboard; children `pixel_otter` (13) and `quiet_comet` (16) |
| Parent, Family plan | `parent.family@example.test` | Billing through the fake Stripe pages; children `neon_badger` (15) and `solar_wren` (17) |
| Adult learner | `lunar_moth` | An 18-year-old with their own account and billing |
| Pending teen | `turbo_finch` | Waiting for a parent: the approval link is in the seed's console output |

**Two-step sign-in for seeded staff (local only).** Every seeded staff account shares one public
secret, printed against each staff row of the seed's account table (`SEED_TOTP_SECRET` in
`scripts/seed.ts`). Add it to an authenticator app once and it works for all of them. It is
public, so the seed refuses to run anywhere but `APP_ENV=local` or `test`. Staff sign-in works
today and then lands on `/studio`, which answers 404 until Studio is built.

What the seed leaves behind: five published courses (through the real review-and-publish path),
placeholder trailers, captions and sample images, the marketing and help pages and the six legal
pages (drafts, shown with their draft banner locally only), 175 course ideas, part-finished courses, one
accepted submission with a certificate, one submission waiting in the review sample, one accepted
by a moderator, a learner's report, promo codes, retention policies, ten candidate tools marked
"to verify" and one sample AI draft in the review queue. Parts whose slice is not built yet are listed as `skipped: …` and picked up when you
run `pnpm db:seed` again. Start again from nothing with `pnpm db:reset && pnpm db:seed`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | TypeScript strict, ESLint (with `jsx-a11y`), Prettier |
| `pnpm test:unit` | Unit tests (no database) |
| `pnpm test:integration` | Integration tests against real Postgres |
| `pnpm test:e2e` / `pnpm test:a11y` | Playwright journeys and axe-core, against a production build |
| `pnpm content:check [--strict]` | Validates everything in `content/`. `--strict` also fails on anything "to verify before publish" (today: every tool's terms). CI runs both; strict is advisory until the tools are verified |
| `pnpm content:import` | Imports tools, assets and courses as drafts in review. Publishes nothing |
| `pnpm ideas:import` | Loads `content/course-ideas.json` into the ideas backlog |
| `pnpm db:generate` | Creates a migration after a schema change. Never edit an applied migration |
| `pnpm db:migrate` | Applies migrations |
| `pnpm db:seed` | Local seed data (refuses outside `local` and `test`) |
| `pnpm db:reset` | Drops everything and migrates again (refuses in production) |
| `pnpm exec tsx scripts/make-placeholder-assets.ts [--force]` | Stand-in media for assets marked `placeholder: true`. Never overwrites a real file |
| `pnpm exec tsx scripts/schema-doc.ts` | Regenerates `docs/SCHEMA.md` |
| `pnpm eval:coach` | Coach safety evaluations, on fixtures |

Scripts load `.env.local`. Point one at another file with `DOTENV_PATH=.env.test pnpm db:migrate`.

## Test databases

Integration tests wipe and migrate their database before each run, and refuse any database whose
name does not contain `test`. The default is `platform_test`. When several people (or agents) work
at once, each uses their own:

```bash
createdb -O app platform_test_mine
TEST_DB_NAME=platform_test_mine pnpm vitest run tests/integration/seed
```

No test calls a real AI provider, Stripe live mode or a real Radar source: everything external has
a local stand-in (`AI_PROVIDER_MODE=fixture`, `STRIPE_DRIVER=fake`, `EMAIL_PROVIDER=console`,
`STORAGE_PROVIDER=local`, `PEOPLE_DETECTION_PROVIDER=fixture`).

## Where things live

```
PLATFORM_SPEC.md         The specification (docs/SPEC_INDEX.txt maps headings to lines)
content/                 Courses, tools, assets, consents, plans, prompts, the ideas backlog
drizzle/                 Migrations
scripts/                 migrate, reset, seed, importers, placeholder assets, schema doc
src/app/                 Pages, Server Actions, Route Handlers (api/v1, api/webhooks, api/jobs)
src/components/          UI: ui/ is the design-system kit
src/content/             The Zod course schema and validators
src/server/services/     Business logic: the only layer that writes to the database
src/server/<kernel>/     context, authz, audit, settings, flags, email, storage, notifications, jobs
src/server/ai/           The only place a model provider is called
src/server/db/           Drizzle client and schema (docs/SCHEMA.md is generated from it)
tests/                   unit, integration, e2e, a11y, fixtures, helpers
docs/                    Architecture, conventions, decisions, runbook, deployment
docs/compliance/         DPIA template, record of processing, retention schedule, Children's code
                         mapping, Online Safety Act notes, processors, incidents, safeguarding
```

Read `docs/CONVENTIONS.md` before writing code and `docs/ARCHITECTURE.md` for how the pieces fit.
Operations are in `docs/RUNBOOK.md`; going live is in `docs/DEPLOYMENT.md`.

## Rules that are easy to break by accident

- Under-18s never see prices, checkout or invoices, and never have an email address.
- No client code calls a model provider. Secrets are read only in `src/env.ts`.
- A course is published only with a human approval record. The seed's approvals are attestations
  by a script and exist only in local and test databases.
- `consent_record`, `credit_ledger` and `audit_log` are append-only.
- Nothing is deployed, pushed, bought or signed up for without the owner's say-so.
