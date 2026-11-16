# Slice briefs

One file per workstream, kept on disk so that work can be picked up again after an interruption.
Every brief assumes you have read docs/CONVENTIONS.md, docs/ARCHITECTURE.md, docs/DECISIONS.md,
docs/KERNEL_API.md, docs/DESIGN.md and MEMORY.md, and that PLATFORM_SPEC.md is the source of truth
(docs/SPEC_INDEX.txt maps headings to line numbers).

Rules that apply to every brief:
- Stay inside the files the brief gives you. Contract files (first line `// CONTRACT`) have fixed signatures: fill in the ones you own, call the others (mock them in tests with `vi.mock` if their bodies still throw, and say which you mocked).
- If files for your slice already exist, an earlier engineer was interrupted. Audit what is there against the brief, keep what is sound, fix what is not, and finish the rest. Do not start again from scratch.
- Use your own test database: `TEST_DB_NAME=platform_test_<name> pnpm vitest run …`.
- Do not commit, do not run `next build`. A brief dev-server check on your own port is fine; stop it afterwards.
- Schema change? Keep it minimal, `pnpm db:generate`, migrate dev and your test database, regenerate docs/SCHEMA.md with `pnpm exec tsx scripts/schema-doc.ts`, and report it.
- Jobs go in `src/server/jobs/registry.ts` on their own line. New authz actions go in `src/server/authz/actions.ts`. New copy keys go in `src/content/copy/en-GB.ts`.
- Work economically: read only what you need. Finish with the report format at the end of docs/CONVENTIONS.md (files, real command results, not done, changed outside the brief, open questions, exported functions and routes).
