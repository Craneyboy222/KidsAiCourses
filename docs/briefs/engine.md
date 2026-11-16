# Brief: AI course creation engine — Tool Radar, drafting, ideas, edit requests, tool watching (test database `platform_test_engine`)

Spec to read in full: Section 3.9 and Section 6.3 in full, Section 8 (provider rules apply to drafting too), Section 14 Radar variables, Section 15 ideas backlog and sample draft, Section 16 engine tests, Section 17 Radar questions.

## Owns
`src/server/radar/**` (source adapters, fetch, dedupe, enrichment, scoring, pipeline), `src/server/ai/draft.ts` and `src/server/ai/draft-fixture.ts` (the only drafting model calls), services `generation.ts`, `ideas.ts`, `edit-request.ts`, `tool-watch.ts`. Jobs for discovery, enrichment, scoring, auto-draft, tool watching and the digest. Pages under `/studio`: `radar` (candidates with score breakdown and sources), `radar/sources`, `radar/settings`, `ideas` (175-idea backlog with filters; draft from an idea), `generate` (on-demand from a tool name or URL, a topic, or an idea), `generation/[jobId]`, `tool-changes` (triage). `content/prompts/draft.*.md`. Fixtures in `tests/fixtures/radar`. Tests in `tests/unit/engine`, `tests/integration/engine`.

## Calls
`createCourse`, `saveRevision`, `validateAgainstDb`, `submitForReview`, `markNeedsReview`, `createCandidateTool`, `getToolBySlug`, `coursesUsingTool`, `safeFetchText`, settings `radar.*` and `drafting.*`, `assertProcessorEnabled`, jobs, notifications, email (`radar_digest`, `tool_change_alert`).

## Requirements
- **Nothing the engine makes is ever published by the engine.** Drafts land as `ai_draft` revisions in the same content model, with editor notes and verify flags, and go to the human review queue. The engine runs as the system actor, which cannot approve or publish. Tools it discovers are created as `candidate` only; terms, ages and prices it reads are recorded as evidence with URLs and marked to verify — never as approved facts. Unknowns stay empty.
- Sources behind one adapter interface, each off until configured: curated RSS and changelog feeds, Product Hunt, GitHub trending or releases, Hacker News, a manual list. `RADAR_FIXTURES=true` (default locally and in tests) reads recorded fixtures and never touches the network. Real fetches use `safeFetchText` with `RADAR_USER_AGENT`, respect robots.txt, rate limit per host, and cache.
- Pipeline: ingest items → dedupe into candidates by vendor domain and name → enrich from the vendor's own pages (pricing, terms, age rules, privacy) → score with `radar.score_weights` (teen relevance, usefulness, momentum, accessibility, safety and age fit, longevity), capped at `radar.age_gate_score_cap` when there is no under-18 route → at or above `radar.score_threshold`, and only if auto-drafting is on and budgets allow, queue a draft. Editors can dismiss, snooze or draft manually.
- Drafting: staged generation (outline → modules and steps → setup guides → quizzes, rubric, ethics checkpoint → hints and coach context) with the versioned prompts, each stage validated and repaired, the result run through `validateCourse`, with remaining issues attached. `AI_PROVIDER_MODE=fixture` uses a deterministic drafting fixture so development and tests need no provider. A real provider needs an approved processor with a DPA. Budgets: `drafting.max_cost_per_draft_pence`, `drafting.monthly_budget_pence`, `drafting.monthly_draft_cap`, kill switch; reaching a budget pauses auto-drafting and alerts admins. Prompt-injection defence: fetched page text is data, quoted and delimited, never instructions; a draft never includes links outside the tool's own domain.
- Guardrails on every draft: the safety rules of Section 15 and the real-people evidence rule; an ethics checkpoint; free-plan completion or a stated parent cost; `minAge` not below the tool's stated minimum; "to verify" flags on every claim about a tool.
- Ideas backlog: list, filter, edit, dismiss, draft from an idea (links the course to the idea and moves its status).
- Request edits: an editor or reviewer asks for changes in plain words on a draft; the engine regenerates the affected parts as a NEW revision with a change summary, keeping human edits where it can; history kept.
- Tool-change watching (daily): re-fetch each approved tool's terms, pricing and age pages; on a meaningful change create a `tool_change_event`, mark guides stale, `markNeedsReview` on affected courses and alert editors. A tightening of age policy puts the tool on hold so Start is blocked until a human triages it; triage is a human-only action.
- Weekly Radar digest email to editors.

## Tests required
Fixture pipeline end to end produces candidates, scores and one draft that parses; the system actor cannot publish or approve; a candidate tool is never approved; age-gated tool capped; budgets and kill switch stop drafting; injection text in a fetched page does not change instructions; robots.txt respected; no network in tests; edit request creates a new revision; tool change flags courses and an age tightening holds Start; idea → draft linkage.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_engine pnpm vitest run tests/unit/engine tests/integration/engine`.
