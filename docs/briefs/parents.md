# Brief: Parents — dashboard, controls, approvals, data requests (test database `platform_test_parents`)

Spec to read in full: Section 3.6, the parent flows in Section 4, the Parent screens in Section 5, Section 9 retention and data rights, the Section 13 parent routes, Section 16.

## Owns
Services `parent-controls.ts`, `approvals.ts` (contracts) plus `parent-dashboard.ts`, `data-request.ts`. Pages under `src/app/(parent)/parent/`: `page.tsx` (dashboard), `children/[id]` (progress, portfolio, Coach summary, controls, reset password, pause, tool approvals for that child), `approvals`, `notices`, `privacy` (consent links, download, delete), `settings`. Jobs `data.export`, `data.delete_due`. Tests in `tests/unit/parents`, `tests/integration/parents`. The `(parent)` layout, onboarding, add-child and consent pages belong to the accounts slice; billing belongs to payments.

## Calls
`listChildren`, `getLearnerSummary`, `getProgressSummary`, `listProjects`, `listCertificates`, `getCoachSummaryForParent`, `countSafetyNoticesForLearner`, `listToolApprovals` / `decideToolApproval` / `revokeToolApproval`, `listUnlockRequests` / `decideUnlockRequest`, `resetChildPassword` (children.ts), consent services, `getUsageByDay`, notifications, storage, email.

## Requirements
- Dashboard per child: progress, time this week, completed projects and certificates, Coach use as a count and topics only (never transcripts), safety notices, pending approvals. The child switcher is always present.
- Controls: daily time cap, quiet hours, blocked categories and courses, require approval for Pro courses, pause and resume with a reason shown to the child. Defaults from site settings; an 18-year-old with no parent link has no caps. Changes are audited and take effect on the next request.
- Approvals inbox: tool consents, parent-operated account confirmations and unlock requests in one list, with plain explanations of what each tool is, its terms and what approving means. Deciding notifies the child in-app.
- Notices: safety and account notices, newest first, with read state. Safety notices never include case detail.
- Privacy: what we hold and why in plain English; download a child's data (job builds a ZIP of profile, progress, submissions and their files, consent history, Coach metadata and any retained messages; stored private; link by email, valid 7 days, parent session required); delete a child's account or the whole family with a 14-day undo window, a clear statement of what is deleted and what must be kept (consent records, safeguarding records under their own schedule), confirmation emails, and a job that completes deletion when the window ends. A learner aged 18 can do both for themselves.
- A parent can only ever reach their own family; every query is scoped by `familyId` from the session, never from the URL alone.
- Parents never see reflection or ethics free text verbatim unless the spec says so — check Section 3.6 and take the more private reading.

## Tests required
Integration: cross-family access refused on every page's loader and action; controls round-trip and defaults; pause stops learning; approvals list combines both sources; export contains the expected files and nothing from another child; delete with undo, then completion removes rows and files while keeping what must be kept; adult learner self-service. Unit: quiet-hours and cap validation.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_parents pnpm vitest run tests/unit/parents tests/integration/parents`.
