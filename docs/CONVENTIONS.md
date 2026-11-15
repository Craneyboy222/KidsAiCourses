# Conventions

Read this before writing code. Keep to it so that parallel work fits together.

## Ground rules

- British English in all user-facing copy, comments and docs. Dates as `15 November 2026`, times in Europe/London, money in GBP stored as integer pence.
- TypeScript strict. No `any` (use `unknown` and narrow). No non-null `!` on data from outside the function.
- Do not add tables, routes or screens for Section 19 future additions.
- No client code calls a model provider. Only `src/server/ai/**` may import the AI SDK.
- Secrets come from `src/env.ts` only. Never read `process.env` elsewhere. Never log secrets or learner free text.
- Never ask a learner for an external tool's password, one-time code or API key, in copy or in code.
- If a requirement is ambiguous, take the reading that is safer for children and add a line to `docs/OPEN_QUESTIONS.md`.
- Do not run `git commit`, `next build` or `next dev` unless your brief says so. Verify with `pnpm typecheck`, `pnpm lint <paths>` and targeted `pnpm vitest run <file>`.
- New dependency? Only if essential. Run `flock /tmp/pnpm.lock pnpm add <pkg>` and add a line (name, purpose, licence) to `docs/DEPENDENCIES.md`. Paid services and new processors are not allowed without the owner's approval.
- Stay inside the files your brief gives you. If you need a change elsewhere, make the smallest possible edit and list it in your final report.

## Services

```ts
// src/server/services/example.ts
import "server-only";
import type { Ctx } from "@/server/context";

export async function doThing(ctx: Ctx, input: DoThingInput): Promise<Thing> {
  assertCan(ctx.actor, "thing.update", { familyId: input.familyId });
  // ctx.db for queries, ctx.now for the clock. Never Date.now() or new Date() in a service.
}
```

- `Ctx = { db, actor, now, requestId, ip? }`. Tests build one with `testCtx()`.
- Services throw `AppError(code, message, { status })`. `message` is safe to show to a teenager: say what happened and what to try.
- Use `ctx.db.transaction` when more than one write must succeed together.
- Every staff mutation, every safeguarding access and every change to consent, entitlement or publication calls `audit(ctx, {...})`.
- Validate input with Zod at the boundary (action or handler). Services may assume parsed input.

## Server Actions and Route Handlers

```ts
// src/app/(parent)/parent/children/actions.ts
"use server";
export async function addChild(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireParent();
    const input = addChildSchema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "children.add", { limit: 10, windowSec: 3600 });
    return addChildService(ctx, input);
  });
}
```

- `runAction` (in `@/server/action`) converts thrown `AppError` and `ZodError` into `{ ok: false, error: { code, message, fieldErrors? } }` and success into `{ ok: true, data }`.
- Route Handlers live under `src/app/api/v1/**` (public API), `src/app/api/public/**`, `src/app/api/webhooks/**`, `src/app/api/jobs/**`. They use `handle(async (req) => ...)` from `@/server/http`, which applies the same error shape `{ error: { code, message } }`.
- Forms work without JavaScript where practical (`<form action={...}>` with `useActionState`).

## Authorisation

- One module: `@/server/authz`. `can(actor, action, resource?)` returns boolean; `assertCan` throws `AppError("forbidden")`.
- Actions are strings `area.verb` listed in `src/server/authz/actions.ts`. Add new ones there with the roles that may perform them. Do not write ad-hoc role checks.
- Ownership is checked through the resource argument (`{ learnerId }`, `{ familyId }`, `{ ownerUserId }`). A learner can act only on their own records; a parent only on their own family; staff by role.
- Every new table holding learner data needs a row in the authz matrix test.

## Database

- Schema in `src/server/db/schema/*.ts`, re-exported from `src/server/db/schema/index.ts`. Tables are `snake_case` singular; TypeScript exports are `camelCase` (`learnerProfile`).
- `id uuid primary key default gen_random_uuid()`, `created_at` and `updated_at timestamptz`. Postgres enums for closed sets; `text` for sets the spec says must stay open (consent keys, notification types, flag rules).
- Append-only tables (`consent_record`, `credit_ledger`, `audit_log`) are never updated or deleted by application code.
- Change the schema, then run `pnpm db:generate` to create a migration. Never edit an applied migration.

## UI

- Use the kit in `src/components/ui`. Do not hand-roll buttons, inputs, dialogs or focus styles. If the kit lacks something, add it to the kit.
- WCAG 2.2 AA is a requirement: labels on every control, visible focus, 24×24 px minimum targets, no drag-only interaction, colour never the only cue, one `<h1>` per page with logical heading order, `aria-live` for async status.
- Server Components by default. Add `"use client"` only for interactivity, and keep client components small.
- Learner-facing copy: teen-friendly and confident, no exclamation-mark pile-ups, never childish. Parent and legal copy: plain English. Errors say what happened and what to try.
- Under-18s never see prices, checkout, invoices or promo entry. Use the `<AskParentToUnlock>` pattern.
- Use `<ExternalToolLink>` for every link to a tool; it applies the allow-list and the leaving-site notice.

## Tests

- `tests/unit/**/*.test.ts(x)`: pure logic and components, no database.
- `tests/integration/**/*.test.ts`: real Postgres (`platform_test`). Use `testCtx()`, the factories in `tests/helpers/factories.ts`, and `resetDb()`.
- `tests/e2e/**/*.spec.ts`: Playwright journeys. `tests/a11y/**`: axe-core.
- Safety-sensitive behaviour needs unit and end-to-end coverage. Every bug fix adds a regression test.
- No test may call a real AI provider, Stripe live mode or a real Radar source. Use fixtures in `tests/fixtures`.

## Final report from a delegated task

Finish with: files created or changed; commands run and their real result (paste the summary line); anything not done; anything changed outside your brief; open questions.
