# Runbook

For whoever is on call, which at launch is the owner. Written to be followed at speed: each
section says what to do first, then what to check. British time (Europe/London) throughout.

**Read this first.** Some things below are done from Studio, and Studio's screens are still being
built (16 November 2026). Where a screen does not exist yet, the entry says so and gives the
fallback. Update this file when the screens land. ⚖️ marks a step that needs a lawyer's or the
safeguarding lead's confirmation before launch; this document is not legal advice.

| I need to… | Go to |
|---|---|
| Stop Coach, drafting, sign-up or the whole site | [Kill switches](#kill-switches) |
| Take a course or one step down | [Taking a course down](#taking-a-course-down) |
| Respond to a safeguarding alert | [A safeguarding alert](#a-safeguarding-alert) |
| Handle a suspected data breach | [Incidents](#incidents) and `docs/compliance/INCIDENT_AND_BREACH_PROCEDURE.md` |
| Restore data | [Restoring from backup](#restoring-from-backup) |
| Replace a secret | [Rotating keys](#rotating-keys) |
| See whether jobs are running | [Background jobs](#background-jobs) |

## Where to look

- **Health:** `GET /api/health` returns `{ status: "ok", db: "ok" }`, or 503 with `status: "degraded"` when the database is down. Point the uptime monitor here.
- **Logs:** the hosting provider's log viewer. Lines are JSON with an `event` name. Learner free text and secrets are never logged. Page on these events:
  - `coach.crisis.CASE_NOT_OPENED` — a crisis script was shown but the safeguarding case could not be created after four tries. Treat as a critical safeguarding alert: find the learner from the request id and open the case by hand.
  - `retention.step_failed` — one step of the nightly retention sweep failed; the others still ran.
  - `stripe.webhook.*` with a failed status — a payment event was not applied.
- **Job history:** the `job_run` table (job, status, summary counts, error). Studio → System → Jobs when built.
- **Audit log:** `audit_log` (append-only). Every staff change, every safeguarding access and every change to consent, entitlement or publication.

## Kill switches

Every switch is a setting (`site_setting`), changed in Studio → Settings by an admin and written to
the audit log. They take effect on the next request: nothing is cached across requests.

| Switch | Setting | What it does | What keeps working |
|---|---|---|---|
| Coach off | `coach.kill_switch` = true | Coach stops answering ("AI break"). A message is still checked for a cry for help before anyone is turned away, and the support script is still shown. | Courses, quizzes, submissions |
| Coach off (planned) | `coach.enabled` = false | The same, as a deliberate setting rather than an emergency | Everything else |
| AI spend | `coach.daily_spend_cap_pence` | Admins are alerted at 80%. At 100% the kill switch trips by itself and **stays on until a person turns it off** | Everything else |
| Course drafting off | `drafting.kill_switch` = true | No AI drafts are generated | Hand-made courses, review |
| Tool Radar off | `radar.enabled` = false, `radar.autodraft_enabled` = false | No discovery fetches, no automatic drafts | Everything else |
| Sign-up closed | `site.signup_open` = false | No new accounts. Existing users are unaffected | Everything else |
| Uploads of people | `uploads.people_screening_enabled` = false (the default) | Images and video are never auto-accepted | Links, documents |
| Site notice | `site.maintenance_message` | A banner on every page | Everything |
| A provider | Studio → AI → Providers: disable | A model, email or storage provider is refused until re-enabled | Depends on the provider |
| One feature | `feature_flag` (Studio → Flags) | Per-feature on/off and targeting | — |

**If Studio is unavailable (or the screen is not built yet).** Use the hosting provider's SQL
console on the production database, as the owner, and write down what you did:

```sql
-- Stop Coach now
insert into site_setting (key, value) values ('coach.kill_switch', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
-- Close sign-up now
insert into site_setting (key, value) values ('site.signup_open', 'false'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

This bypasses the audit log, so add the audit entry by hand afterwards (the table accepts inserts):

```sql
insert into audit_log (actor_type, actor_label, action, target_type, target_id, reason)
values ('staff', 'owner (SQL console)', 'setting.update', 'site_setting', 'coach.kill_switch', 'Emergency: <why>');
```

**The whole site.** Pause the project in the hosting dashboard (Vercel → Project → Settings →
Pause), or point the domain at a holding page. Do this for an active security incident; it also
stops learners reaching the crisis signposting, so prefer the narrower switches when you can.

## Taking a course down

1. **One step is wrong or unsafe:** Studio → Courses → the course → the step → *Switch off*
   (`disableStep`). Learners skip it; no new version is needed. Use for a broken link or a guide
   that no longer matches a tool.
2. **The whole course must go now:** Studio → Courses → *Take down* with a reason
   (`takeDownCourse`). It leaves the catalogue at once. Enrolled learners see a clear notice
   instead of the content; their progress, projects and certificates are kept.
3. **A tool has changed its age rules:** Studio → Tools → the tool → set the under-18 policy. The
   start gate blocks affected courses for the learners it now excludes; nothing else is needed.
4. Afterwards: record why in the review task, fix the course as a new revision, and get a fresh
   approval. `restoreCourse` needs review decisions made *after* the take-down.

The functions are in `src/server/services/publish.ts` and are tested. The Studio screens that call
them are being built; until they exist a take-down needs a developer to call the service from a
script as a named member of staff (never as raw SQL: the take-down also updates versions and
writes the audit entry).

## A safeguarding alert

⚖️ The safeguarding policy (`docs/compliance/SAFEGUARDING_POLICY.md`) is an outline until the
Designated Safeguarding Lead (DSL) has approved it. **If a child is in immediate danger, call 999
first.** Do not wait for anything in this runbook.

What has already happened by the time you are alerted: the learner was shown the fixed support
script immediately (it never waits for a person), a case was opened, and the DSL address
(`DSL_ALERT_EMAILS`, or `safeguarding.alert_emails` in Studio) was emailed. The alert never
contains the child's words.

1. **Acknowledge** the case in Studio → Safeguarding. Targets for a sole operator between 08:00
   and 22:00: critical 4 hours, high 8 hours, normal 48 hours.
2. **Open the notes only if you need them.** They are encrypted, opening them is break-glass, and
   every view asks for a reason and is logged in `safeguarding_access_log`.
3. **Decide and record:** no further action; contact the parent (from the template, and never if
   the concern is about the parent); refer externally; restrict or close the account.
4. **External referral** ⚖️: children's social care for the child's area, the police (101, or 999
   in an emergency), the NSPCC helpline (0808 800 5000) for advice, CEOP for online sexual abuse.
   Possibly illegal images are quarantined, never deleted and never opened: reporting duties (the
   IWF and the police) are ⚖️ and must be agreed with a lawyer before launch.
5. **Close** the case with the outcome. Retention of the record follows the DSL's policy ⚖️.

The case service and its Studio screens are being built (the seed prints
`skipped: the TEST safeguarding case` until then). Until they exist the alert email is the only
signal, and Coach must not be opened to real learners.

## Incidents

Use the full procedure in `docs/compliance/INCIDENT_AND_BREACH_PROCEDURE.md`. In short:

1. **Contain.** Use a kill switch, revoke sessions (`delete from session where user_id = …`, or
   all of them), rotate the affected key, pause the project if needed.
2. **Record** the time you became aware. ⚖️ A personal-data breach that is likely to risk people's
   rights must be reported to the ICO within 72 hours of becoming aware, and affected families
   told without undue delay when the risk is high. The clock starts when you know, not when you
   are sure.
3. **Assess** what data, whose, how many, and whether children's data is involved (assume higher
   risk when it is).
4. **Fix, then review.** Every bug fix adds a regression test.

## Restoring from backup

The database host (Neon or Supabase, London: spec question 2, undecided) must provide daily
backups and at least 7 days of point-in-time recovery. Confirm that on the chosen plan before
launch: it is a launch requirement, not a nice-to-have.

1. Close sign-up and show a maintenance message.
2. Restore **to a new database or branch**, never over the live one, at a time just before the
   damage.
3. Check it: `select count(*) from "user"`, the latest `audit_log` row, a known family.
4. Point `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) at the restored database and redeploy.
5. Run `pnpm db:migrate` only if the code is ahead of the restored schema.
6. **Replay deletions.** A restore brings back data that was deleted after the restore point.
   Re-run the deletion requests completed since then (`data_request` rows in the damaged database,
   and the `job_run` summaries of `retention.sweep` and `data.delete_due`), then run both jobs.
   Deleted data must not come back. ⚖️
7. Stored files are not in the database backup. Turn on object versioning in the storage bucket,
   or accept that a restored row may point at a file that is gone (the app shows "not available").
8. Tell families if any of their data was lost or exposed (see Incidents).

Practise this once before launch and write the date here: _not yet practised_.

## Rotating keys

Rotate on a schedule (at least yearly), when someone with access leaves, and at once after any
suspected leak. Change the value in the hosting provider's environment variables and redeploy.

| Secret | Effect of rotating | Steps |
|---|---|---|
| `CRON_SECRET` | None for users | Change it, redeploy, update the scheduler that sends it |
| `STRIPE_WEBHOOK_SECRET` | Webhooks fail until both sides match | Roll the secret in Stripe (it keeps the old one valid for a short overlap), update, redeploy |
| `STRIPE_SECRET_KEY` | None if done in order | Create a new restricted key, update, redeploy, revoke the old one |
| `EMAIL_API_KEY`, `AI_GATEWAY_API_KEY`, `STORAGE_S3_*`, `INNGEST_*` | None if done in order | New key at the provider, update, redeploy, revoke the old one |
| `DATABASE_URL` password | Brief errors during the switch | Rotate at the host, update both URLs, redeploy |
| `BETTER_AUTH_SECRET` | **Everyone is signed out, links signed for local file storage stop working, and every staff two-step secret becomes unreadable** (they are encrypted with it), so staff must enrol again | Do it only after a leak. Better Auth 1.7 can hold several secrets for a gradual change (`BETTER_AUTH_SECRETS`); the app is not wired for that yet |
| `SAFEGUARDING_ENCRYPTION_KEY`, `CONTENT_ENCRYPTION_KEY` | **Do not simply replace these.** Safeguarding notes and stored Coach messages are encrypted with them, in a format with one key per purpose (`v1`). A new key cannot read old records | Needs a re-encryption script that does not exist yet (see `docs/OPEN_QUESTIONS.md`). Until it does, a leak of one of these keys means: write the script, re-encrypt, then replace |

Never paste a secret into Studio, a ticket, a chat or a commit. `SEED_PASSWORD` must not exist in
production (the app refuses to start if it does).

## Background jobs

Jobs are registered in `src/server/jobs/registry.ts`. Inngest schedules them; the fallback is
`POST /api/jobs/<name>` with `Authorization: Bearer <CRON_SECRET>`. Every run writes `job_run`.
Schedules are UK time.

| Job | When | What |
|---|---|---|
| `retention.sweep` | 03:15 daily | Applies every retention policy (see `docs/compliance/RETENTION_SCHEDULE.md`) |
| `data.delete_due` | hourly | Completes deletions whose 14-day undo has ended; removes expired downloads |
| `accounts.purge_pending` | 03:40 daily | Deletes teen sign-ups nobody approved after 7 days |
| `accounts.recalculate_bands` | 00:10 daily | Moves learners to their new safety band after a birthday month |
| `evidence.cleanup_abandoned`, `sessions.cleanup`, `ratelimit.cleanup` | daily / hourly | Housekeeping |
| `notifications.release` | every 10 minutes | Sends notices held for quiet hours |
| `billing.reconcile` | 04:20 daily | Ends grace periods and complimentary plans |
| `publish.run_due_schedules` | every 5 minutes | Publishes approved, scheduled courses |

Run one by hand, for example a retention dry run that changes nothing:

```bash
curl -X POST "$APP_URL/api/jobs/retention.sweep" \
  -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"payload":{"dryRun":true}}'
```

The summary comes back in the response and is stored in `job_run.summary`. `moreToDo: true` means
the run stopped at its batch limit and the next run carries on. The nightly sweep never deletes
from `consent_record`, `credit_ledger` or `audit_log`. Deleting audit entries past their period is
a separate, deliberate run (`{"payload":{"includeAuditLog":true}}`) that should not be used until
the audit retention period has been confirmed ⚖️.
