# Brief: Studio safety — moderation queue, reports, safeguarding cases, enforcement (test database `platform_test_safety`)

Spec to read in full: Section 3.8 moderation and safeguarding items, Section 3.10, Section 9 (DSL workflow, moderation, retention, break-glass), Section 16 safety tests, Section 17 safeguarding questions. Decisions D2 and D3.

## Owns
Service `safeguarding.ts` (contract) plus `src/server/services/studio/safety-*.ts` and `enforcement.ts`. Pages under `/studio`: `moderation` (queue by severity and SLA) and `moderation/[id]`, `reports`, `safeguarding` (case list — DSL only) and `safeguarding/[id]`, `enforcement`, `safety/report` (weekly numbers). Jobs `safeguarding.escalate_unacknowledged`, `moderation.sla_watch`, `safety.weekly_report`. Tests in `tests/unit/safety`, `tests/integration/safety`.

## Calls
`moderation.ts` (queue and decisions are built by the tools slice: `listModerationItems`, `getModerationItem`, `decideModeration`), `reports.ts`, notifications, email (`safeguarding_alert`), settings `safeguarding.*` and `moderation.*`, crypto (`encrypt` / `decrypt` with key `safeguarding`), audit.

## Requirements
- `openSafeguardingCase`: creates the case, encrypts any detail, and for critical and high severity alerts the DSL at once by email to `safeguarding.alert_emails` (falling back to `DSL_ALERT_EMAILS`) and in-app; SMS only if `safeguarding.sms_enabled` and an approved provider exists (none does — leave the adapter interface and a no-op). It never throws to the caller and never waits on a human. Alerts contain no child's name or message text: a case id, severity, trigger and a link.
- Case workflow: new → acknowledged → in progress → closed, with decision, referral notes and outcome. Acknowledge targets come from `moderation.sla_hours` inside `moderation.sla_window`. If `safeguarding.deputy_escalation_enabled`, an unacknowledged critical or high case escalates to the deputy after the configured minutes. A "send test case" button creates an `is_test` case end to end.
- **Break-glass**: the case list shows metadata only. Reading notes requires a typed reason every time, writes `safeguarding_access_log` and an audit entry, and is limited to the DSL and the owner. Admins without the DSL role cannot read notes. Notes are encrypted at rest with the safeguarding key.
- A case can restrict the learner's account (pause Coach, pause uploads, pause the account) through `enforcement.ts`, each with a reason, a parent-facing safety notice that reveals no detail, and an audit entry. `countSafetyNoticesForLearner` feeds the parent dashboard.
- Moderation queue screens: sorted by due time, with the evidence shown safely (images behind a click, never auto-played video, links not auto-opened), decision buttons with required notes on block, escalate to safeguarding, and the SLA clock. Reports list with outcomes fed back to the reporter in plain words.
- Weekly safety report: volumes, SLA attainment, category mix, no personal data.
- Leave `TODO(legal)` where the law decides (reporting duties, retention of case records), and list them in docs/OPEN_QUESTIONS.md.

## Tests required
Case opening never throws even if email fails; alert content has no personal data; acknowledgement and escalation timing; break-glass reason required and logged; admin without DSL refused; notes unreadable in the database; enforcement applies and notifies; parent notice count; test-case flow; SLA maths across the working window.

## Verify
typecheck; eslint on your paths; `TEST_DB_NAME=platform_test_safety pnpm vitest run tests/unit/safety tests/integration/safety`.
