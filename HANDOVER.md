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

## First job: get it running on this laptop, without touching anything else on it

**The owner has other Node and Postgres projects on this laptop. Nothing done for this project
may change or affect them.** These rules are absolute; if one cannot be met, stop and ask.

- Work only inside this repository's folder. Do not read, edit or run anything in other projects.
- **Install nothing system-wide and upgrade nothing.** No `brew install`, `brew upgrade`,
  `npm install -g`, `corepack enable`, no change to the default Node version, no edits to shell
  profiles, global git config, `~/.npmrc` or any other file outside this folder.
- **Node**: use the Node already on the machine if it is version 22 or later. If it is older, or
  a version manager would need its default changed, stop and ask. Run pnpm without installing it
  globally: `npx -y pnpm@10.28.0 <command>` (written as `pnpm` below).
- **Postgres**: do not use, stop, restart, reconfigure or upgrade any Postgres server that is
  already on the machine, and do not create roles or databases in it. This project gets its own
  private server: its own data folder inside this repository and its own port, started from
  Postgres programs already installed. If none are installed, stop and ask.
- **Ports**: check a port is free before using it. This project uses 5544 for its database and
  3410 for the site; if either is taken, pick another free one. Never take 3000 or 5432.
- **Processes**: stop only processes you started yourself, by their process id. Never stop
  something by name (`pkill node`, `killall postgres`) or by a port you did not open.
- `pnpm db:reset` wipes whatever database `DATABASE_URL` points at. Before running it, print the
  address and confirm it is this project's private server on port 5544.
- Before the first command that installs or starts anything, tell the owner in plain words what
  you found on the machine and exactly what you are about to do.

```bash
# from the repository folder; .pgdata and .env.local are git-ignored
npx -y pnpm@10.28.0 install                  # dependencies go into this folder only

initdb -D .pgdata -U kidsai --auth=trust     # private database server, in this folder
pg_ctl -D .pgdata -o "-p 5544 -c listen_addresses=localhost" -l .pgdata/server.log start
createdb -h localhost -p 5544 -U kidsai kidsai_dev

cp .env.example .env.local                   # then set the values below
pnpm db:migrate
pnpm db:seed                                 # prints every seeded account
pnpm dev -p 3410                             # http://localhost:3410
```

Stop the private database with `pg_ctl -D .pgdata stop`. Add `.pgdata/` to `.gitignore` before
creating it. These steps were written in the cloud workspace and have not been run on a Mac:
the project was built against Postgres 16, so if the installed programs are a different major
version, say so before going ahead.

The old `.env.local` was deliberately not copied across. Set at least:

- `APP_ENV=local`, `DATABASE_URL=postgres://kidsai@localhost:5544/kidsai_dev`
- `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` = `http://localhost:3410` (sign-in fails if these do not match the port)
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
