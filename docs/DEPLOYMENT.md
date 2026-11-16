# Deployment

How to put the product on the internet, step by step, **for the owner to approve**. Nothing in
this document has been done: no account has been created, nothing has been bought and nothing is
deployed. Each step that creates an account, costs money or sends children's data to a new company
is marked **APPROVAL**, and each legal judgement ⚖️. This is not legal advice.

The app runs today with no third-party account at all (console email, local file storage, fixture
AI, fake Stripe). Going live means replacing each stand-in, one at a time.

## 0. Decisions needed first (spec Section 17)

| # | Decision | Needed for |
|---|---|---|
| 1 | Brand name and domain | Everything public |
| 2 | Database host: Neon or Supabase, London region | Step 2 |
| 3 | Paid services: hosting, AI gateway and model, Inngest, email, storage, error tracking | Steps 1 to 8 |
| 5 | ⚖️ Age-assurance method for 13–15 | `AGE_ASSURANCE_MODE` |
| 6 | ⚖️ Lawful bases, DPIA sign-off, retention periods | Launch readiness |
| 7 | ⚖️ A named, trained DSL; crisis scripts approved | Launch readiness |
| 8 | ⚖️ Online Safety Act scope | Launch readiness |
| 16 | ⚖️ Where Coach text is processed; a DPA with each provider | Step 6 |

## 1. Hosting: Vercel, London **APPROVAL**

1. Create a Vercel team and import the Git repository. Framework: Next.js (detected).
2. `vercel.json` pins functions to **London (`lhr1`)** and uses `pnpm install --frozen-lockfile`
   and `pnpm build`. Check Project → Settings → Functions shows London after the first deploy.
3. Node 22. Production branch `main`. Preview deployments get `APP_ENV=preview` and their **own**
   database and storage: a preview must never point at production data.
4. Add the domain; redirect `www` to the apex (or the reverse) in one place.
5. Sign Vercel's DPA and record it in the processor register.

## 2. Database: Postgres 16, London **APPROVAL**

1. Create the project in **London** (Neon `aws-eu-west-2`, or Supabase `eu-west-2`).
2. Confirm **daily backups and at least 7 days of point-in-time recovery** on the chosen plan
   (spec Section 9). This usually needs a paid plan.
3. `DATABASE_URL` = the pooled connection string; `DATABASE_URL_UNPOOLED` = the direct one
   (migrations use it).
4. Apply the schema from your machine or a one-off CI job: `DATABASE_URL_UNPOOLED=… pnpm db:migrate`.
   The migration creates the `citext` and `pgcrypto` extensions; the role needs permission.
5. **Never run `pnpm db:seed` or `pnpm db:reset` against it.** Both refuse, and the app also
   refuses to start in production while `SEED_PASSWORD` is set.
6. Bootstrap the owner: set `OWNER_BOOTSTRAP_EMAIL`, then follow the first-owner step in Studio's
   set-up when that screen is built. Until then there is **no production path to create the first
   staff account**: this is a blocker for launch, listed in `docs/OPEN_QUESTIONS.md`.

## 3. File storage: S3-compatible, UK or EU **APPROVAL**

1. Create two **private** buckets (learner uploads and exports; course media). Block all public
   access. AWS S3 `eu-west-2`, Cloudflare R2 (EU jurisdiction) or Supabase Storage.
2. `STORAGE_PROVIDER=s3`, `STORAGE_BUCKET_PRIVATE`, `STORAGE_BUCKET_PUBLIC`, `STORAGE_S3_REGION`,
   `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, and `STORAGE_S3_ENDPOINT` for R2 or
   Supabase. The key needs read, write and delete on those two buckets only.
3. Turn on object versioning or backups for the private bucket (see the runbook on restores), and
   a CORS rule allowing `PUT` from the site's own origin (uploads go straight to storage).
4. A signed upload cannot cap the file size on S3 or R2: the app checks and deletes anything too
   large when the upload completes.
5. Approve and enable the processor `storage.s3` in Studio → AI → Providers (launch readiness
   checks it).
6. Upload the real course media under the keys in `content/assets/*.json`, then remove
   `"placeholder": true` from each entry. The placeholder generator never overwrites a real file.

## 4. Email **APPROVAL**

1. Choose Resend or Postmark; choose the EU region where offered. Verify the sending domain
   (SPF, DKIM, DMARC).
2. `EMAIL_PROVIDER=resend` (or `postmark`), `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
3. `EMAIL_PROVIDER=console` cannot send in production: it throws rather than write sign-in links
   to the logs.
4. Approve and enable `email.resend` or `email.postmark` in Studio.
5. Under-18 learners are never emailed: they have no address. Parents' safety notices are
   immediate. Send yourself each template once and read it.

## 5. Background jobs: Inngest **APPROVAL**

1. Create the Inngest app, connect it to the Vercel project (or set `INNGEST_EVENT_KEY` and
   `INNGEST_SIGNING_KEY`) and sync `https://<domain>/api/inngest`.
2. Check the functions list matches `src/server/jobs/registry.ts` (see the table in the runbook).
   Schedules are read as Europe/London time.
3. Without Inngest in production, an enqueued job runs before the request returns (slower, but
   nothing is lost), and scheduled jobs do not run at all unless something calls the fallback.
4. **Fallback without Inngest:** any scheduler that can send a header may call
   `POST` or `GET /api/jobs/<name>` with `Authorization: Bearer <CRON_SECRET>`. Vercel's own
   scheduler can do this (its documentation says it sends `CRON_SECRET` in that header, that
   schedules are in UTC, and that "Cron Jobs" are being replaced by "Schedules": read
   <https://vercel.com/docs/schedules> before relying on it). Use one scheduler or the other,
   never both, or every job runs twice. UTC schedules drift by an hour against UK time in summer;
   that is harmless for these jobs.

## 6. AI: gateway and model **APPROVAL** ⚖️

1. Decide the provider and where it processes data. Children's words go to it (redacted, but
   still their words). ⚖️ UK or EU processing, or adequate transfer safeguards, and a signed DPA,
   **before** it is switched on (spec question 16).
2. `AI_PROVIDER_MODE=gateway`, `AI_GATEWAY_API_KEY`.
3. In Studio → AI: approve and enable **two** processors, each with its DPA reference:
   `vercel-ai-gateway` and the model provider. Add the model route for `coach.default` with real
   prices. Calls ask for zero data retention and no training; confirm the provider honours that.
4. Set `coach.daily_spend_cap_pence`. At 100% Coach stops and stays stopped until a person turns
   it back on.
5. Run `pnpm eval:coach --live` against the approved provider and have the DSL read the crisis
   results. **Do not open Coach to learners on the local rules classifier alone**
   (`docs/OPEN_QUESTIONS.md`, Coach section).
6. Check on the first build that `content/prompts/*.md` are in the deployment; if the Coach prompt
   is missing, Coach fails closed.

## 7. Payments: Stripe **APPROVAL**

The real Stripe driver has never made a call. Do this in **test mode** first, end to end.

1. Create the account (UK), products and prices: Family monthly and annual, the founding prices,
   an extra place. Every price in `content/plans/*.json` is a placeholder (spec question 10).
2. `STRIPE_DRIVER=stripe`, `STRIPE_SECRET_KEY` (a restricted key), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
   and the `STRIPE_PRICE_*` ids. The price shown comes from the plan; the price charged comes from
   Stripe: change both together.
3. Webhook endpoint `https://<domain>/api/webhooks/stripe` for `checkout.session.completed`,
   `customer.subscription.created`, `.updated`, `.deleted`, `.trial_will_end`, `invoice.paid`,
   `invoice.payment_failed`, `charge.refunded`, `setup_intent.succeeded`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
4. Configure the Customer Portal: cancel at period end; whether extra places can be added there.
5. Approve and enable the processor `stripe` in Studio. Checkout, the portal and the card check
   refuse until it is.
6. In test mode, run every journey in `docs/OPEN_QUESTIONS.md` (Payments): trial, payment, failed
   payment and grace, cancel, refund, the £0 card check, a promo code.
7. ⚖️ Consumer law: 14-day cancellation for digital content, renewal reminders, easy cancellation.

## 8. Optional, each needing approval

- **Error tracking** (`SENTRY_DSN`): EU region, no session replay, scrub request bodies. **APPROVAL**
- **Analytics** (`NEXT_PUBLIC_POSTHOG_KEY`): never in learner areas; parent and marketing pages
  only, behind a cookie banner with opt-in. **APPROVAL** ⚖️
- **Bot protection on sign-up** (`TURNSTILE_*`). **APPROVAL**
- **SMS alerts for the DSL**: needs a provider. **APPROVAL**
- **Radar sources** (`PRODUCTHUNT_API_TOKEN`, `GITHUB_TOKEN`): `RADAR_ENABLED` stays false until
  sources are configured and approved (spec question 14).

## 9. Environment variables in production

Every variable is described in `.env.example` and validated at start-up by `src/env.ts`: a missing
or unsafe value stops the app with a message that names it. Set them per environment in the
hosting dashboard (Production and Preview separately). Values marked SECRET there must never be
given a `NEXT_PUBLIC_` name.

| Group | Variables | Production value |
|---|---|---|
| App | `NODE_ENV`, `APP_ENV`, `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL`, `TZ_DISPLAY` | `production`, `production`, the brand, `https://<domain>`, `Europe/London` |
| Database | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Step 2 |
| Sign-in | `BETTER_AUTH_SECRET` (new: `openssl rand -hex 32`), `BETTER_AUTH_URL`, `STAFF_2FA_REQUIRED=true`, `OWNER_BOOTSTRAP_EMAIL`, `PASSWORD_BREACH_CHECK`, `AGE_ASSURANCE_MODE` ⚖️ | `off_dev_only` and `STAFF_2FA_REQUIRED=false` are refused |
| Must be absent | `SEED_PASSWORD`, `RADAR_FIXTURES=true`, `STRIPE_DRIVER=fake` | The app refuses to start with any of them |
| AI | `AI_PROVIDER_MODE`, `AI_GATEWAY_API_KEY`, `MODERATION_PROVIDER`, `MODERATION_API_KEY`, `PEOPLE_DETECTION_PROVIDER=manual`, `AI_DAILY_SPEND_CAP_GBP`, `AI_FEATURE_CAPS_JSON`, `CREDIT_VALUE_PENCE`, `FREE_MONTHLY_CREDITS`, `FAMILY_MONTHLY_CREDITS` | Step 6 |
| Payments | `STRIPE_DRIVER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_*` | Step 7 |
| Storage | `STORAGE_PROVIDER=s3`, `STORAGE_BUCKET_*`, `STORAGE_S3_*` (or `SUPABASE_*`) | Step 3 |
| Email | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Step 4 |
| Jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `CRON_SECRET` (new, 32+ random characters) | Step 5 |
| Safety | `SAFEGUARDING_ENCRYPTION_KEY`, `CONTENT_ENCRYPTION_KEY` (new, each `openssl rand -hex 32`; **back them up somewhere safe: losing one loses the data it protects, and they cannot yet be rotated**), `DSL_ALERT_EMAILS`, `DEPUTY_DSL_ALERT_EMAILS` | — |
| Radar | `RADAR_ENABLED=false`, `RADAR_AUTODRAFT_THRESHOLD`, `RADAR_MAX_COST_PER_DRAFT_GBP`, `RADAR_MONTHLY_BUDGET_GBP`, `RADAR_USER_AGENT` | Off at launch |

## 10. Go-live checklist

Sign-up cannot be opened while any launch-readiness item is open: the gate is in code
(`src/server/settings/launch-readiness.ts`), not only in this list.

**Product**
- [ ] `next build` succeeds and CI is green on `main` (typecheck, lint, content check `--strict`, unit, integration, Playwright, axe)
- [ ] Studio, safeguarding cases and the legal and help pages are built (not yet: see the README status)
- [ ] All 15 starter courses are authored and reviewed by a person (5 exist; the seed's approvals are not real reviews and exist only locally)
- [ ] Real videos, captions and transcripts replace every placeholder asset
- [ ] Every tool a published course uses has its terms verified and its under-18 policy recorded ⚖️ (spec question 4)
- [ ] A first staff account can be created in production (step 2.6)

**Safety and law** ⚖️
- [ ] A named, trained DSL; a deputy or cover arrangement before scaling
- [ ] Crisis script approved by the DSL (`content/prompts/crisis-script.v1.md` is a draft)
- [ ] DPIA completed and signed (`docs/compliance/DPIA_TEMPLATE.md`); lawful bases confirmed
- [ ] Children's code mapping reviewed (`docs/compliance/CHILDRENS_CODE_MAPPING.md`)
- [ ] Online Safety Act scope decided and risk assessments done (`docs/compliance/ONLINE_SAFETY_ACT_NOTES.md`)
- [ ] Legal pages published by a person: privacy, privacy for teens, terms, cookies, community code, AI use policy
- [ ] Retention periods confirmed (`docs/compliance/RETENTION_SCHEDULE.md`)
- [ ] ICO registration (data protection fee) in place
- [ ] Age-assurance method confirmed
- [ ] A DPA signed with every processor in `docs/compliance/PROCESSOR_REGISTER.md`, each approved in Studio

**Operations**
- [ ] Backups and point-in-time recovery confirmed; a restore practised (runbook)
- [ ] Uptime monitor on `/api/health`; log alerts on the events listed in the runbook
- [ ] Jobs visible and running in Inngest; `job_run` shows `retention.sweep` succeeding
- [ ] Stripe journeys run in test mode, then one real payment and refund in live mode
- [ ] Encryption keys backed up; `SEED_PASSWORD` absent; staff two-step enrolment done with each person's own authenticator
- [ ] The incident and breach procedure has a named person and phone numbers filled in

**Then**, and only then: complete the launch-readiness checklist in Studio and set
`site.signup_open` to true. Start with invited families.
