# Record of processing activities

UK GDPR Article 30. A template filled in from the code as built on 16 November 2026. Not legal
advice. Every lawful basis below is a **placeholder for a lawyer to confirm**, not a conclusion.

## 1. Who we are

| | |
|---|---|
| Controller | `[Controller: legal name, company number, registered address]` |
| Trading as | `[Platform Name]` |
| Contact for data protection | `[name, email]` |
| Data Protection Officer | ⚖️ TO CONFIRM whether one must be appointed (large-scale processing of children's data is one of the tests) |
| ICO registration | `[reference]` — to be done before launch |
| UK representative | Not applicable if the controller is established in the UK ⚖️ TO CONFIRM |

## 2. Whose data, and what

The product is built to hold as little as it can about a child. There is **no child email address,
real surname, photograph, school, address, phone number or location** anywhere in the schema, and
the sign-up and profile services refuse usernames and nicknames that look like a real name, a
school or a place (`src/server/services/username.ts`).

| People | Data held | Where (table) |
|---|---|---|
| Learners 13–17 | Username; nickname; **birth month and year only**; safety band and pathway worked out from that; a generated avatar seed (shapes, never a photo); interests chosen from a fixed list; accessibility settings; password hash; optionally one first name for certificates | `user`, `learner_profile`, `account` |
| | Learning: courses started, step progress, private notes and reflections, quiz attempts and scores | `enrolment`, `step_progress`, `reflection`, `quiz_attempt` |
| | Work handed in: links and uploaded files (images are stored with EXIF and GPS removed), file hashes, self-assessment, moderation outcome; certificates | `project`, `project_version`, `artefact`, `certificate` |
| | Coach: messages (encrypted at the application level, deleted after 30 or 90 days), topics and counts, request metadata (tokens, cost, outcome; never the words), credits used | `tutor_conversation`, `ai_message`, `ai_request`, `credit_balance`, `credit_ledger` |
| | Safety: reports they make, moderation checks on their work, safeguarding cases (notes encrypted, access logged), enforcement actions | `report`, `moderation_event`, `moderation_item`, `safeguarding_case`, `safeguarding_access_log`, `enforcement_action` |
| | Use: seconds of use per day (for a parent's time limit), last active time, sessions (IP address and browser string), in-app notifications | `usage_day`, `user`, `session`, `notification` |
| 18-year-old learners | As above, plus their own email address, and billing data as for a parent if they pay | as above, `family`, `subscription` |
| A teenager whose parent has not approved yet | Username, birth month and year, password hash, **the parent's email address** they typed. Deleted after 7 days if nobody approves | `user`, `learner_profile`, `parent_link_request` |
| Parents and carers | Email address; optional name; password hash; the family and its plan; declarations (18 or over, parental responsibility); consent choices with time, IP address and request id; parent controls set for each child; notifications; data requests; support messages | `user`, `family`, `family_member`, `consent_record`, `parent_control`, `notification`, `data_request`, `support_ticket` |
| | Payments: a Stripe customer id, subscription status and dates, promo codes used, the age-assurance level reached. **No card numbers reach our systems**: they are typed on Stripe's pages | `family`, `subscription`, `promo_redemption`, `stripe_event` |
| Staff | Name, email, password hash, two-step secret (encrypted), roles; everything they do in Studio | `user`, `two_factor`, `staff_role`, `audit_log` |
| Under-13s | **Nothing.** The age gate runs before anything else is read; a count is added to an anonymous daily counter and a one-hour cookie stops an immediate retry | `metric_counter`; cookie `age_gate` |
| Visitors | Sessions if they sign in; rate-limit buckets keyed by a hash | `session`, `rate_limit_bucket` |

**Special category data.** None is asked for. A learner may volunteer it in free text (a Coach
message, a reflection, a report), and a safeguarding case may record health or other sensitive
matters. ⚖️ TO CONFIRM the Article 9 condition and the Schedule 1 Data Protection Act 2018
condition (and whether an appropriate policy document is needed) for safeguarding records.

**Criminal offence data.** Could arise in a safeguarding case or a report to the police. ⚖️ TO CONFIRM.

## 3. Why, and on what basis (placeholders)

| # | Purpose | Data | Lawful basis ⚖️ TO CONFIRM |
|---|---|---|---|
| 1 | Running the account and the courses | Account, profile, progress, work, certificates | Placeholder: contract with the parent (or the 18-year-old), **or** consent given by the parent in the consent centre (`account_learning_data`). The product collects a recorded parental consent either way. ⚖️ Which basis is relied on, and how Article 8 (a child's consent to an information society service, 13 in the UK) applies when a parent creates the account |
| 2 | Coach (AI tutor) | Messages, context of the current step | Placeholder: parental consent (`ai_processing`), which the product requires before Coach opens ⚖️ |
| 3 | Longer Coach history, if the parent switches it on | Messages for 90 days rather than 30 | Placeholder: consent (`tutor_history_retention`, optional, off by default) ⚖️ |
| 4 | Pointing learners at outside tools | No data is sent to a tool by us; the parent's permission is recorded | Placeholder: consent (`third_party_tools`) ⚖️ |
| 5 | Keeping children safe: moderation, reports, safeguarding | Work handed in, reports, flagged Coach messages, case notes | Placeholder: legitimate interests and/or legal obligation; Article 9 condition as above ⚖️ |
| 6 | Parent controls and the parent dashboard | Progress summary, time used, Coach summary (count, topics and safety notices: never the transcript) | Placeholder: contract / legitimate interests ⚖️ |
| 7 | Taking payment | Parent's billing data | Placeholder: contract; legal obligation for tax records ⚖️ |
| 8 | Age assurance for 13–15 | That an adult's card was checked or a paid plan is active (not the card) | Placeholder: legitimate interests / legal obligation ⚖️ and the method itself is ⚖️ (spec question 5) |
| 9 | Security and abuse prevention | Sessions, IP address, failed sign-ins, audit log | Placeholder: legitimate interests ⚖️ |
| 10 | Service email to parents | Email address | Placeholder: contract / legitimate interests. No marketing email is built ⚖️ |
| 11 | Product improvement analytics | **Not built.** An optional consent exists (`product_improvement_analytics`, off by default); no analytics tool is installed | Consent, if ever enabled ⚖️ |
| 12 | Proving consent was given | Consent records (pseudonymous after an account is deleted) | Placeholder: legal obligation / legitimate interests ⚖️ |

## 4. Who it is shared with

Nobody at present: the product runs on local stand-ins and nothing is deployed. The companies that
would process data in production, and the approval each needs first, are in `PROCESSOR_REGISTER.md`.

- **Other learners:** nothing. There are no public profiles, no learner-to-learner messages, comments or friends.
- **The public:** only a certificate check page, reached with the certificate's code: a display name (nickname, or the first name if the learner chose that), the course title and the date. Marked `noindex`.
- **Outside tools** (Replit, Canva and so on): we send them nothing. The learner, or the parent for a parent-operated tool, opens an account with the tool directly under the tool's own terms.
- **Authorities:** a safeguarding referral or a legal demand. ⚖️ TO CONFIRM the procedure and the record kept.

## 5. Transfers outside the UK

None today. Each processor's region is in the register. ⚖️ TO CONFIRM the transfer mechanism for
any processor outside the UK (adequacy regulations, the International Data Transfer Agreement or
the Addendum), **in particular the AI model provider** (spec question 16).

## 6. How long

See `RETENTION_SCHEDULE.md`.

## 7. Security measures (as built)

- One authorisation module (`src/server/authz`), tested so that learner A cannot read learner B's records and a parent sees only their own family.
- Staff need a second factor; staff sessions end after 12 hours; every staff action is audited.
- Application-level encryption for safeguarding notes and stored Coach messages (AES-256-GCM, separate keys). Passwords are hashed by the sign-in library (scrypt).
- Files are private and reached only through signed links that expire. Uploaded images have metadata removed. SVG and HTML are only ever offered as downloads.
- Append-only tables for consent, credits and the audit log (a database trigger refuses changes).
- Rate limits on sign-in, sign-up and AI routes; a lock after repeated wrong passwords.
- Outbound requests from learner-supplied links are checked against private network addresses, and learner links are never fetched.
- Secrets only in environment variables, validated at start-up; unsafe production settings stop the app.
- **For the hosting set-up, to confirm at deployment:** encryption at rest, daily backups with at least 7 days of point-in-time recovery, London region.
