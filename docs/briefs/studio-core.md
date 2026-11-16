# Brief: Studio core — shell, people, business and system screens (test database `platform_test_studio`)

Spec to read in full: Section 3.8, Section 3.1 roles, the Studio screens in Section 5, Section 9 audit and staff access, the Section 13 admin routes, Section 16 admin tests. Decision D2 (launch readiness).

## Owns
`src/app/(studio)/layout.tsx` (staff session with verified 2FA; `StudioShell` with `buildStudioNav` showing only what `can()` allows; counts for queues wrapped so a failure shows no badge). Pages under `/studio`: overview, `users`, `users/[id]`, `families/[id]`, `staff` (invite, roles), `plans`, `promos`, `pages` and `pages/[id]` (marketing, legal, help and snippet copy with versions and publish), `emails` (templates with preview and test send to self), `flags`, `settings` (generated from `listSettings`, grouped), `ai` (processors with approval and DPA reference, model routes, credit prices, kill switches, today's spend), `launch` (readiness checklist), `audit` (searchable log), `analytics` (aggregates only), `support` (tickets), `jobs` (recent runs, run now). Services under `src/server/services/studio/`. Tests in `tests/unit/studio`, `tests/integration/studio`. Content, review, tools, Radar, moderation and safeguarding screens belong to other slices.

## Calls
Settings, launch readiness, flags, processors, email, jobs, audit, notifications, `createAccount`, plans and promo services from the payments slice, family and consent services.

## Requirements
- The owner can run the whole product from here without a code change. Every mutation checks authz, asks for a reason where it is destructive (`ConfirmDialog` with `requireReason`), and writes an audit entry. Secrets are never shown or stored in settings.
- Users and families: search, view (with the learner placeholder email hidden), lock and unlock, reset password, pause, ban (admin), view consent history, entitlement and age-assurance state, impersonation is NOT built. Staff see the minimum: support cannot read submissions or Coach messages; nobody but the DSL (and the owner by break-glass) reads safeguarding notes.
- Staff: invite by email, roles from `STAFF_ROLES`; only `super_admin` grants `admin`, `dsl` or `super_admin`; forced 2FA enrolment; removing the last `super_admin` is refused.
- Pages CMS: Markdown editing with preview, versions, publish, audiences (teen or adult copy), the fixed legal slugs of D16, help articles, and snippet overrides for in-app copy keys.
- Launch page: each readiness item with its state, who confirmed it and when; confirm and clear by the owner only; the sign-up switch is disabled with the outstanding list until everything passes.
- Analytics: counts and funnels in aggregate (sign-ups, activation, course starts and completions, Coach use, moderation volumes and SLA, spend); no individual learner drill-down, no third-party analytics.
- Dense, plain, keyboard-first tables with server-side pagination and filters.

## Tests required
Authz matrix per screen and action (each role, plus staff without 2FA refused everywhere); privileged-role granting; last owner protected; settings saved and audited; launch gate; page versioning and publish; no secret or placeholder email in any payload.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_studio pnpm vitest run tests/unit/studio tests/integration/studio`.
