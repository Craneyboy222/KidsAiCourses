# Retention schedule

What `[Platform Name]` keeps, for how long, and what deletes it. A template filled in from the code
as built on 16 November 2026. Not legal advice. **Every period marked ⚖️ TO CONFIRM is a
placeholder taken from the specification (Section 9), not a legal conclusion**: a lawyer, and for
safeguarding records the Designated Safeguarding Lead (DSL), must confirm it before launch
(specification question 6).

## How retention works in the product

- The periods are rows in the `retention_policy` table. `pnpm db:seed` and
  `ensureRetentionPolicies` add the defaults below and never overwrite a row that is already there.
  An admin will be able to change a period in Studio (`setRetentionDays`; the screen is NOT BUILT
  YET). Every change is written to the audit log.
- The job `retention.sweep` runs every night at 03:15 UK time
  (`src/server/jobs/retention.ts`, `src/server/services/retention.ts`). It applies each policy in
  batches, deletes stored files as well as database rows, and writes its counts, never any
  content, to `job_run.summary`. One step failing does not stop the others; the failed step is
  named in the summary and in the log event `retention.step_failed`.
- A **dry run** (`{"dryRun": true}`) counts what would be deleted and changes nothing. See the
  runbook, "Background jobs".
- The nightly sweep never updates or deletes a row in the append-only tables (`consent_record`,
  `credit_ledger`, `audit_log`). This is tested.
- Two periods are fixed in the code of the slice that does the deleting, not read from the table.
  They are marked "Fixed in code" below and cannot be changed in Studio, so that the table never
  says one thing while the product does another.

## The schedule

The table is kept in step with `RETENTION_DEFAULTS` in `src/server/services/retention.ts` by a
test (`tests/unit/seed/compliance-docs.test.ts`): change a period there and here together.

| Policy key | Default period | Who decides | What it covers | What enforces it |
|---|---|---|---|---|
| `account_inactive` | 730 days (2 years) | ⚖️ TO CONFIRM | Account, profile and progress: deleted 24 months after the learner was last active, after a warning to the parent. | retention.sweep (warning, then a deletion request with the usual undo window) |
| `account_inactive_warning` | 30 days | Owner's choice | How long before an inactive account is deleted the parent is warned. | retention.sweep |
| `account_deletion_undo` | 14 days | ⚖️ TO CONFIRM | Undo window after a deletion request. When it ends the account is deleted. | data.delete_due (hourly) and retention.sweep. Fixed in code: `DELETION_UNDO_DAYS in src/server/services/children.ts` |
| `pending_teen` | 7 days | Owner's choice | A sign-up a teenager started that no parent approved: everything about it is deleted. | accounts.purge_pending and retention.sweep. Fixed in code: `PENDING_TEEN_DAYS in src/server/services/teen-signup.ts` |
| `tutor_conversation_default` | 30 days | Owner's choice | Coach messages: the words are deleted after this many days. Counts and topics remain. | retention.sweep (ai_message.expires_at) |
| `tutor_conversation_extended` | 90 days | Owner's choice | Coach messages when a parent has switched on chat history. | retention.sweep (ai_message.expires_at) |
| `flagged_content` | 365 days (1 year) | ⚖️ TO CONFIRM | Flagged Coach conversations and moderation decisions: kept this long after the matter is resolved, under the safeguarding schedule. | retention.sweep (held while a linked safeguarding case is open) |
| `safeguarding_case` | Not a number of days | ⚖️ TO CONFIRM | Safeguarding cases: kept for as long as the safeguarding lead's policy says. Never deleted automatically. | the safeguarding lead (no automatic deletion) |
| `ai_metadata` | 395 days (13 months) | Owner's choice | The record of each Coach request (dates, token counts, cost; never the words): deleted after 13 months. Daily totals remain. | retention.sweep |
| `artefacts` | Not a number of days | Owner's choice | Projects and the files and links sent in with them: kept for the life of the account. | account deletion |
| `rejected_upload` | Not a number of days | Owner's choice | An upload that failed our checks or was sent back: its file is deleted immediately. The hash and metadata are kept. | the submissions service at the moment of rejection; retention.sweep as a backstop |
| `consent_record` | Not a number of days | ⚖️ TO CONFIRM | The permissions a parent gave or withdrew: kept as evidence, after the account closes too. Append-only; never deleted by the sweep. | nothing automatic (append-only evidence) |
| `billing_records` | 2190 days (6 years) | ⚖️ TO CONFIRM | Payment records (about the paying adult, never the child): 6 years. | retention.sweep (payment event log); invoices are held by Stripe |
| `audit_log` | 730 days (2 years) | ⚖️ TO CONFIRM | The security and change log: 2 years. Append-only; removed only by the deliberate audit-log purge, never by the nightly sweep. | retention sweep with includeAuditLog (off by default) |
| `job_run_log` | 90 days | Owner's choice | The record of background job runs (counts and errors, no personal data). | retention.sweep |

## Records with no policy row

| Record | How long | What removes it |
|---|---|---|
| Sign-in sessions | 7 days, renewed on use, never more than 30 days; staff 12 hours | `sessions.cleanup` (daily) |
| Email-link and verification tokens | Until used or expired | `sessions.cleanup` |
| Rate-limit counters (keyed by a hash) | Until the window ends | `ratelimit.cleanup` (hourly) |
| An upload link that was never completed, and anything that reached storage through it | Daily clean-up | `evidence.cleanup_abandoned` |
| A data download (ZIP) | 7 days after it is ready | `data.delete_due` (hourly) deletes the file |
| Daily time-used totals (`usage_day`), in-app notifications, credits, progress, quiz attempts, reflections, projects, certificates | The life of the account | Account deletion |
| Anonymous daily counters (`metric_counter`), daily AI spend totals (`spend_counter`) | Kept. No personal data | Nothing |
| Under-13 sign-up attempts | **Nothing is stored** about the child: an anonymous count and a one-hour cookie | — |
| Application logs at the hosting provider | ⚖️ TO CONFIRM and set in the provider's dashboard at deployment. Learner free text and secrets are never logged | The provider |
| Database backups | ⚖️ TO CONFIRM with the chosen host (at least 7 days of point-in-time recovery is required). Deleted data persists in backups until they age out, and deletions must be replayed after a restore (runbook) | The provider |

## What account deletion keeps, and why

When a parent deletes a child's account (or an 18-year-old their own), nothing is deleted for 14
days so that it can be undone; then `data.delete_due` removes the rows and the files
(`src/server/services/data-request.ts`). These are kept:

| Kept | Why | ⚖️ |
|---|---|---|
| Consent records (ids, never names; pseudonymous once the account is gone) | Evidence of who agreed to what | ⚖️ TO CONFIRM the period |
| Safeguarding cases, flagged Coach conversations and quarantined files. A learner with any of these is anonymised (no name, username or sign-in) rather than removed | The safeguarding schedule | ⚖️ TO CONFIRM with the DSL |
| Payment records for a family that has ever paid (the paying adult only; the account itself is anonymised) | Tax and accounting | ⚖️ TO CONFIRM (6 years is the placeholder) |
| Audit-log entries | Security and accountability | ⚖️ TO CONFIRM (2 years is the placeholder) |

## Gaps to close before launch

- **The audit log is not deleted by anything automatic.** The specification gives 2 years. Deleting
  from it is a separate, deliberate run of the sweep (`includeAuditLog`), which keeps
  safeguarding-access and consent entries regardless. ⚖️ TO CONFIRM the period, and whether those
  two kinds of entry should ever be removed, before that run is used at all.
- **The credit ledger is append-only and has no period.** It holds learner ids and amounts, no
  content. ⚖️ TO CONFIRM whether a deleted learner's entries must be removed or may stay as
  pseudonymous accounting records.
- **Safeguarding cases are never deleted automatically.** The DSL's policy must set the period and
  the product then needs a way to apply it. NOT BUILT YET. ⚖️
- **"AI metadata 13 months, then aggregated."** The per-request rows are deleted after 13 months
  and the daily totals in `spend_counter` remain. No other aggregate is built.
- **Changing the deletion undo window or the pending-teen period** needs a code change (see "Fixed
  in code"), not a Studio setting.
- **Inactive accounts.** The warning goes to the parent in the app and by email, or to the
  18-year-old themselves. "Last active" is the last time the learner had the learner area open
  while learning was allowed; signing in alone, or a parent signing in, does not count.
  ⚖️ TO CONFIRM that 24 months and a 30-day warning are appropriate, and the wording of the warning.
- **Backups and provider logs** have periods the product does not control: set and record them at
  deployment.
