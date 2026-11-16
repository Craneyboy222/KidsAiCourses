# Brief: Studio content — course CMS, review, publish, preview with inline editing, Tool Register (test database `platform_test_studiocontent`)

Spec to read in full: Section 3.8 Course CMS, Section 3.3 Tool Register, Section 6 (model and validation), Section 6.3 review workflow, preview and inline editing, Section 7 QA, the Section 13 content routes, Section 16.

## Owns
Service `preview.ts` (contract) plus `src/server/services/studio/content-*.ts`. Components `src/components/course/Editable.tsx` (contract: add the provider and editors) and `src/components/studio/content/**`. Pages under `/studio`: `courses` (list with status, origin, needs-review and stale-guide flags), `courses/new`, `courses/[id]` (structured editor for every part of the model; revisions with diff and restore; validation panel; submit for review), `review` (queue), `review/[versionId]` (decision screen with the QA checklist, tool-claims confirmation, waivers, comments, approve, request edits, decline), `courses/[id]/publish` (publish now, schedule, take down with reason, restore, unpublish, retire, disable a step), `preview/[versionId]` and `preview/[versionId]/learn/[stepKey]`, `assets` (library with upload, alt text and licence), `tools` and `tools/[slug]` (Register fields, evidence, approve, block, substitutes, courses using it), `guides` (stale and reported guides). Tests in `tests/unit/studio-content`, `tests/integration/studio-content`.

## Calls
`course-store`, `publish`, `tools`, `assets` services (already built: see docs/KERNEL_API.md), `applyPatch`, `validateCourse`, `QA_CHECKLIST`, and the learning slice's `CourseView` and `PlayerView` (import them from `src/components/course`; if they are not there yet, build your routes against the documented props and say so).

## Requirements
- Editing a published course starts a new draft revision; the live version stays live until the new one is approved and published. Every save is a new revision; nothing is overwritten.
- Review screen: shows validation issues, verify flags, what changed since the last approved revision, and the checklist. An approval needs every checklist item answered and the safety items passed; it records the reviewer, their roles and whether they were the last editor. The service already enforces the approval rule — show clearly what is still missing and why.
- **Preview in the real learner view.** `resolvePreview` allows only signed-in staff with a verified second factor and `course.preview`; optional preview tokens (hashed, expiring, revocable) narrow access to one version. Anyone else — learner, parent, signed-out visitor, a guessed slug or version id — gets exactly the response of a course that does not exist. Preview pages are `noindex`, never cached, and render the same `CourseView` and `PlayerView` learners see, with a band switcher (13–15, 16–17, 18) and a "what a parent would see" toggle for Tools you'll need. Nothing is recorded: no enrolment, progress, analytics or certificate. Coach in preview is marked as staff preview.
- **Inline editing**: with editing on, the `PreviewEditContext` provider turns `EditableText` and `EditableBlock` into in-place editors (text, Markdown, step add, remove, move by buttons, quiz question, guide step, media swap from the asset library). Each save builds a typed patch, applies it with `applyPatch`, saves a new revision through `saveRevision` (same validators), and shows validation results in place. Optimistic concurrency with `expectedRevision`; a conflict tells the editor to reload.
- Tool Register screens: fields, evidence with links, status, last checked, verifier; approving is a human-only action that requires the policy and the evidence-checked confirmation; changing a term-related field resets verification; blocking shows affected courses.
- Take-down is one click plus a reason and is immediate. Everything is audited.

## Tests required
Preview secrecy (learner, parent, anonymous, staff without 2FA, wrong token, expired token, revoked token → not found; correct staff → content); preview writes nothing; inline edit creates a revision and keeps validation; conflict handling; review decision flows through to publish; editor cannot approve their own sole approval when the two-person setting is on; take-down hides immediately; component tests for the editors.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_studiocontent pnpm vitest run tests/unit/studio-content tests/integration/studio-content`.
