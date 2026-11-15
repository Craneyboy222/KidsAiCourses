# Architecture

Single Next.js 16 app (App Router, TypeScript strict). Postgres via Drizzle. No microservices. `PLATFORM_SPEC.md` is the source of truth; `docs/DECISIONS.md` records where the lead resolved an ambiguity; `docs/SPEC_INDEX.txt` maps spec headings to line numbers.

## Layers

```
src/app/**            Pages, layouts, Server Actions (actions.ts), Route Handlers (api/**)
src/components/**     UI. ui/ is the design-system kit; feature folders compose it
src/server/services   Business logic. The only layer that writes to the database
src/server/<kernel>   context, authz, audit, settings, flags, ratelimit, crypto, email, storage, notifications, jobs, copy
src/server/ai         The only place a model provider is called (proxy.ts = Coach, draft.ts = course drafting)
src/server/radar      Tool Radar source adapters and pipeline
src/server/db         Drizzle client and schema
src/content           Zod course schema and validators (shared client/server)
src/lib               Pure helpers safe for the client (dates, formatting, brand)
```

Request path for every mutation and handler: `requireSession()` → `assertCan(actor, action, resource)` → rate limit → service. Pages call services directly for reads, with the same authz check.

## Rendering and caching

`cacheComponents` is off (D9). Every signed-in route is dynamic and reads the session per request. Marketing pages may use `revalidate`. Nothing derived from a learner is ever cached across requests. In Next 16 `params` and `searchParams` are Promises, and middleware is `src/proxy.ts`; read `node_modules/next/dist/docs/` before using an API you are unsure of.

`src/proxy.ts` does optimistic redirects only (signed-out → `/signin`). Real authorisation is always in the page, action or handler.

## Identity

Better Auth owns `user`, `session`, `account`, `verification`, `two_factor`. Our `user` row adds `kind` (`learner` | `parent` | `staff`), `status`, `username` (citext, unique, nullable). Learner and parent are exclusive on one account. Staff roles live in `staff_role`. IDs are UUIDs everywhere.

Learners have no email address. Parents and staff sign in with email (password or magic link); learners with username and password. Staff need TOTP and sessions last 12 hours.

`Actor` is the authorisation subject, resolved once per request:

```ts
type Actor =
  | { type: "anonymous" }
  | { type: "system"; job: string }
  | { type: "learner"; userId: string; familyId: string | null; safetyBand: SafetyBand; age: number; status: UserStatus }
  | { type: "parent"; userId: string; familyId: string; status: UserStatus }
  | { type: "staff"; userId: string; roles: StaffRole[]; twoFactorVerified: boolean };
```

## Courses and versions

- `course` is the stable identity (slug, origin, status, pointers to the published and working versions).
- `course_version` holds one revision. **`snapshot jsonb` is the canonical content** and always parses with the Zod `Course` schema (drafts may carry validation issues, recorded in `validation jsonb`).
- Draft revisions exist only as snapshots. Every save, inline edit or AI regeneration inserts a new `course_version` row with `revision + 1`; earlier revisions are kept and can be restored.
- On approval the publish service **materialises** the snapshot into `module`, `lesson`, `step`, `quiz`, `quiz_question`, `rubric_criterion`, `course_tool`, `tool_guide`, `tool_guide_step` in one transaction, and the version becomes immutable. Progress rows reference materialised `step.id`. `step.disabled` allows urgent take-down of one step without a new version.
- `enrolment.course_version_id` pins the learner to the version they started.
- Tool display facts are never copied into a course: they are read from `tool` at request time by `toolSlug`.
- Staff preview renders a draft snapshot through the real course page and player. Preview progress lives in the preview session only: no enrolment, analytics, certificate or parent-visible record is written.

## Safety-critical paths (each has unit and end-to-end tests)

| Path | Module |
|---|---|
| Age: under-13 block, `safetyBand`, `minAge` gate | `services/age.ts`, `services/catalogue.ts` |
| Start gate: tool policy, parent approval, entitlement, parent blocks, caps | `services/start-gate.ts` |
| Coach pipeline (11 stages) | `src/server/ai/proxy.ts` |
| Crisis script and safeguarding case | `src/server/ai/crisis.ts`, `services/safeguarding.ts` |
| Submission checks and moderation | `services/submission.ts`, `services/moderation.ts` |
| Publish: human approval record required | `services/publish.ts` |
| Draft secrecy: preview tokens, staff 2FA | `services/preview.ts` |
| Outbound fetch safety (links, Radar, enrichment) | `src/server/net/safe-fetch.ts` |

## Jobs

Jobs are plain async functions `(ctx: Ctx, payload) => Promise<Result>` in `src/server/jobs/*.ts`, registered in `src/server/jobs/registry.ts`. Inngest wraps them for scheduling and retries; `/api/jobs/[name]` with `CRON_SECRET` is the fallback. Tests call the functions directly. All jobs are idempotent and write a `job_run` row.

## Providers behind adapters

Every external service sits behind an interface with a local default, so the app runs and tests pass with no third-party account: email (`console`), storage (`local` under `.data/`), AI gateway (`fixture`), moderation (`rules` — local keyword and pattern classifier), people detection (`manual`), Stripe (test keys or the `fake` driver), Radar sources (fixtures). A provider is only switched on by environment variable **and** an approval recorded in Studio.
