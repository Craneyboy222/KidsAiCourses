# MEMORY

One lesson per entry, summary first. Update rather than duplicate; delete anything proven wrong.

- **Run at most two delegated workstreams at once.** Six in parallel exhausted the account's 5-hour usage limit in about 90 minutes (15 November 2026); three did the same within an hour of the reset (16 November). Each workstream uses roughly half a million tokens.
- **A workstream's files survive an interruption, but the agent itself does not survive a machine restart.** Briefs live in `docs/briefs/`; start a fresh agent pointed at the brief and tell it to audit and finish the partial work.
- **Each parallel workstream needs its own test database.** Prefix vitest with `TEST_DB_NAME=platform_test_<name>`; the databases already exist (accounts, learning, tools, coach, parents, payments, studio, studiocontent, safety, engine, seed, misc, e2e).
- **Next.js here is 16.4 and differs from older versions.** `params` are Promises, middleware is `src/proxy.ts`, and Cache Components is deliberately off (D9). Read `node_modules/next/dist/docs/` before using an unfamiliar API.
- **Better Auth 1.7 cannot store a null email.** Learners hold a hidden `<uuid>@learner.invalid` placeholder; read emails only through `userEmail()`.
- **Postgres is local and not persistent across a machine restart.** `pg_ctlcluster 16 main start`; databases `platform_dev` and `platform_test*`, role `app`/`app`.
- **The spec copy in the repo (`PLATFORM_SPEC.md`) carries the lead's corrections** (D1, D2, D8, D11). The uploaded original does not.
- **Chris works from goals, not step lists, and wants results first.** No pushing, deploying, spending or account creation without his explicit approval; local branch commits are fine.
- **The owner uses the Goal Engine plugin.** Keep `goal-engine-state.json` and `goal-engine-plan.md` current so `/goal-engine:status` and `/goal-engine:resume` work.
- **If every page reloads endlessly in `next dev`** (HMR hash mismatch, seen when two dev servers or an editing workstream share the checkout): restart; if it persists delete `.next/dev`. Never `pkill -f next-server` — it kills other workstreams' servers; kill by port.
- **Seeded local accounts** are listed by `pnpm db:seed`; every password is `SEED_PASSWORD` from `.env.local`; staff two-factor uses the fixed local secret the seed prints.
- **From 16 November 2026 the owner wants no new tests, no test runs and no more courses.** Build only; check with typecheck, lint, one build and the running site. Details in `docs/briefs/REMAINING.md`.
- **The build moved to Claude Code on the owner's laptop on 16 November 2026.** `HANDOVER.md` has the setup; the cloud workspace notes above about Postgres restarts apply only there.
- **The owner's laptop has other Node and Postgres projects; nothing here may affect them.** No system-wide installs or upgrades, no use of the shared Postgres, own private server in `.pgdata/` on port 5544, site on 3410, never ports 3000 or 5432. Rules in `CLAUDE.md` and `HANDOVER.md`.
