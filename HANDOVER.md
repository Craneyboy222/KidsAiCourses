# Handover, 16 November 2026

The build moved from a cloud workspace to Claude Code on the owner's laptop. This file is what a
new session needs to carry on. What is built and what is left: `docs/briefs/REMAINING.md`.

## Where things stand

- Branch `build/launch` is the only branch. Nothing is deployed. No hosted database exists.
- The learner, parent and public sides work end to end on seeded data. Studio (the staff area)
  and the AI course creation engine are not built.
- `pnpm build` passed on 16 November 2026. The full test suite has not been run since the last
  few slices landed, and the owner has said not to run or write tests from here on.
- The owner has only seen screenshots and a static copy of the pages. Getting the real site
  running on his laptop so he can click through it is the first job.

## First job: get it running on this laptop

Needs Node 22, pnpm 10 and PostgreSQL 16 (ffmpeg is optional, for placeholder trailers). Check
what is installed before installing anything, and tell the owner what you are about to install.

```bash
pnpm install
cp .env.example .env.local     # git-ignored; see the values below
createuser app --pwprompt      # password: app   (skip if the role exists)
createdb -O app platform_dev
pnpm db:migrate
pnpm db:seed                   # prints every seeded account
pnpm dev                       # http://localhost:3000
```

The old `.env.local` was deliberately not copied across. Set at least:

- `APP_ENV=local`, `DATABASE_URL=postgres://app:app@localhost:5432/platform_dev`
- `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` = `http://localhost:3000`
- `BETTER_AUTH_SECRET` (32+ random characters), `CRON_SECRET` (16+)
- `SAFEGUARDING_ENCRYPTION_KEY` and `CONTENT_ENCRYPTION_KEY` (`.env.example` gives the format)
- `SEED_PASSWORD` (any password; every seeded account uses it), `OWNER_BOOTSTRAP_EMAIL`
- leave `STRIPE_DRIVER=fake` and the local provider defaults as they are

`src/env.ts` validates all of this at start-up and says exactly what is wrong.

Then give the owner the address and these sign-ins (password is `SEED_PASSWORD`):

| To see | Sign in as |
|---|---|
| A teenager's side | Learner tab, username `neon_badger` (15, mid-course) |
| A parent's side | Parent tab, `parent.family@example.test` |
| A free-plan family | `parent.free@example.test`; children `pixel_otter` (13), `quiet_comet` (16) |
| An adult learner | `lunar_moth` |

Start again from nothing with `pnpm db:reset && pnpm db:seed`.

## Then: continue the build

Follow the queue in `docs/briefs/REMAINING.md`, starting with the integration pass. Each item
has its own brief in `docs/briefs/`. Read before starting any of them:

- `PLATFORM_SPEC.md`: the source of truth. This copy carries the lead's corrections;
  `docs/SPEC_INDEX.txt` maps headings to line numbers.
- `docs/DECISIONS.md` (D1 to D16), `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`,
  `docs/KERNEL_API.md`, `docs/DESIGN.md`, `MEMORY.md`.
- `docs/OPEN_QUESTIONS.md`: every slice's loose ends.

After each slice: typecheck, lint the touched files, one `pnpm build`, open the pages in the
running site, commit to `build/launch`, and tell the owner in a few lines what now works and
what he can click.

## Things that will trip you up

- Next.js here is 16.4: `params` and `searchParams` are Promises, middleware is `src/proxy.ts`,
  Cache Components is off on purpose (D9). See `AGENTS.md`.
- Contract files in `src/server/services` start with `// CONTRACT` and have fixed signatures.
  Two still throw `notImplemented`: `preview.ts` and `safeguarding.ts`.
- Provider SDK imports are only allowed under `src/server/ai`. Lint enforces it.
- Learners hold a hidden placeholder email; read emails only through `userEmail()`.
- Do not use `instanceof` on error classes across route handlers and services; check name or code.
- If every page reloads endlessly in `pnpm dev`, restart it; if that fails delete `.next/dev`.
- The seed refuses to run unless `APP_ENV` is `local` or `test`.
- `goal-engine-plan.md` and `goal-engine-state.json` predate the owner's latest instructions.
  Where they disagree with `docs/briefs/REMAINING.md`, the brief wins.

## Not carried over

- The cloud workspace's local database and uploaded files: recreated by the seed.
- The static preview copy and its capture scripts: no longer needed once the site runs locally.
- Hosting: nothing was created on Vercel or Supabase. Deployment is a later, separate decision
  for the owner (`docs/DEPLOYMENT.md`).
