# MEMORY

One lesson per entry, summary first. Update rather than duplicate; delete anything proven wrong.

- **Run at most two or three delegated workstreams at once.** Six in parallel exhausted the account's 5-hour usage limit in about 90 minutes (15 November 2026) and paused everything until 02:50.
- **Paused workstreams keep their work and can be continued** with a follow-up message to the same agent; do not start a replacement.
- **Each parallel workstream needs its own test database.** Prefix vitest with `TEST_DB_NAME=platform_test_<name>`; the databases already exist (accounts, learning, tools, coach, parents, payments, studio, studiocontent, safety, engine, seed, misc, e2e).
- **Next.js here is 16.4 and differs from older versions.** `params` are Promises, middleware is `src/proxy.ts`, and Cache Components is deliberately off (D9). Read `node_modules/next/dist/docs/` before using an unfamiliar API.
- **Better Auth 1.7 cannot store a null email.** Learners hold a hidden `<uuid>@learner.invalid` placeholder; read emails only through `userEmail()`.
- **Postgres is local and not persistent across a machine restart.** `pg_ctlcluster 16 main start`; databases `platform_dev` and `platform_test*`, role `app`/`app`.
- **The spec copy in the repo (`PLATFORM_SPEC.md`) carries the lead's corrections** (D1, D2, D8, D11). The uploaded original does not.
- **Chris works from goals, not step lists, and wants results first.** No pushing, deploying, spending or account creation without his explicit approval; local branch commits are fine.
- **The owner uses the Goal Engine plugin.** Keep `goal-engine-state.json` and `goal-engine-plan.md` current so `/goal-engine:status` and `/goal-engine:resume` work.
