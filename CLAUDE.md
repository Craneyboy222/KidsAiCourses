# Project instructions

@AGENTS.md

A UK online course platform where 13 to 18 year olds learn AI tools through short, project-based
courses, with a guardrailed AI Coach and parents in control. One Next.js app, TypeScript strict,
Postgres through Drizzle. `PLATFORM_SPEC.md` is the source of truth.

## Start of every session

1. Read `HANDOVER.md`, then `docs/briefs/REMAINING.md`, then `MEMORY.md`.
2. Before touching a slice, read its brief in `docs/briefs/` and the docs that brief names.

## Who you are working for

Chris, the owner: a solo, non-technical founder in the UK. He gives goals and constraints, not
step lists. Own each task end to end.

- Lead with the result. Short, plain English, British spelling, UK dates and currency.
- No jargon without a few words of explanation. He does not read code.
- One recommendation with the reason, not a list of options.
- Verified over assumed. Check with a tool or say you do not know. Report only what a command
  or a page in the running site actually showed; say "unverified" otherwise.
- Never end a turn promising what you are about to do. Do it or hand back.
- Push back when he is wrong.

## Approval rules

- **Ask first, every time**: pushing to `main`, deploying, publishing, sending email or messages,
  deleting outside the working tree, spending money, creating accounts or hosted resources, any
  paid service, any new data processor or AI provider.
- **Fine without asking**: local files, commits to `build/launch` and pushes of that branch,
  local database resets, installing project dependencies with pnpm.
- Assessment tasks (review, audit, opinion): report only, change nothing.

## Current standing instructions (16 November 2026)

- Finish the build in the order given in `docs/briefs/REMAINING.md`.
- Do not write or run tests. Allowed checks: `pnpm typecheck`, `pnpm lint`, `pnpm content:check`,
  `pnpm build`, and opening pages in the running site.
- Do not author more courses. The catalogue stops at five.
- Keep the site runnable on this laptop at all times, so the owner can look whenever he likes.

## Product rules that are never traded away

- Under-18s never see a price, on any page or in any API response.
- Parents own family accounts. Consent, controls and billing sit with them.
- AI-drafted course content is never published without a human approving it.
- Sign-up stays closed until the launch-readiness checklist passes.
- On any ambiguity take the reading that is safer for children and record it in
  `docs/DECISIONS.md`.
- No features from Section 19 of the spec (future ideas).

## Working practice

- At most two delegated workstreams at once; each gets a brief on disk.
- Services take `Ctx` and go through `can()` / `assertCan()`; every sensitive action is audited.
- Keep `MEMORY.md` current: one lesson per entry, summary first, update rather than duplicate.
- When a slice lands, update the status table in `docs/briefs/REMAINING.md`.
