# Data protection impact assessment (template, part-filled)

UK GDPR Article 35. A DPIA is expected here: the service is offered to children, uses an AI
system with them and may handle safeguarding information. ⚖️ TO CONFIRM that reading, and whether
the ICO must be consulted before launch (Article 36) if a high risk cannot be reduced.

**Status: draft, not signed.** The descriptions are filled in from the code as built on
16 November 2026. The judgements are not made: every assessment of necessity, proportionality,
likelihood and severity below is a **placeholder for the owner and a lawyer**, marked
⚖️ TO CONFIRM. Nothing here is legal advice. Parts of the product marked NOT BUILT YET must be
assessed again when they exist.

| | |
|---|---|
| Controller | `[Controller]` |
| Service | `[Platform Name]`: project-based AI courses for 13 to 18-year-olds in the UK |
| Assessment led by | `[name, role]` |
| Advice taken from | `[lawyer]`, `[DSL]`, `[DPO if one is appointed]` ⚖️ |
| Views of children and parents sought | `[how and when]` — not yet done. The Children's code expects it ⚖️ |
| Version and date | Draft 0.1, 16 November 2026 |
| Next review | Before launch; then on any change listed in section 9 |

## 1. Why a DPIA

Tick what applies and confirm with a lawyer ⚖️.

- [x] The service is likely to be used by children (it is designed for them).
- [x] Innovative technology: a generative AI assistant (Coach) used by children.
- [x] Data that could be sensitive in context: free text typed by children; safeguarding records.
- [ ] Large scale ⚖️ TO CONFIRM (depends on take-up).
- [x] Monitoring-like features: a parent sees a summary of a child's activity; usage time is counted.
- [ ] Profiling with legal or similarly significant effect: none is built. Course order is
      personalised by chosen interests only (see the Children's code mapping, standard 12) ⚖️.

## 2. What the processing is

Described in detail in `RECORD_OF_PROCESSING.md` (who, what data, which tables) and
`PROCESSOR_REGISTER.md` (who else would handle it). In short:

1. **Sign-up.** A parent creates a family account with an email address and adds a child by
   nickname, username, and birth month and year. Or a teenager starts with a username, a birth
   month and year and a parent's email address, and waits for that parent to approve (deleted
   after 7 days if nobody does). An 18-year-old may hold their own account. Under-13s are refused
   before anything is stored.
2. **Consent centre.** The parent (or the 18-year-old) grants three required permissions (account
   and learning data, Coach, tools from other companies) and may grant two optional ones (longer
   Coach history; product analytics, which nothing uses yet). Every choice is an append-only record.
3. **Learning.** Progress, quiz attempts, private notes and reflections.
4. **Outside tools.** The course sends the learner to tools run by other companies. We send those
   companies nothing. The parent's permission, and for some tools a per-tool approval, is recorded.
5. **Submissions.** A link, or an uploaded file, with a self-assessment. Automatic checks, then a
   person where needed. Image and video files always wait for a person.
6. **Coach.** The learner's message is checked for a cry for help, has obvious personal details
   removed, and is sent with the context of the current step to a model provider. The reply is
   checked before it is shown. Messages are stored encrypted for 30 days (90 with the optional
   permission). **Today this runs only against a local fixture: no provider has been chosen.**
7. **Parent dashboard and controls.** Progress, time used, projects, a Coach summary (count, topics
   and safety notices, never the words), time limits, quiet hours, blocked categories, pause.
8. **Safety.** Reports, a moderation queue, safeguarding cases with encrypted notes.
   The case service and the staff screens are NOT BUILT YET.
9. **Payments.** The paying adult only, through Stripe's own pages. Children never see prices.
10. **Data rights.** A parent can download or delete a child's data from the Privacy page; an
    18-year-old can do it for themselves.

## 3. Necessity and proportionality ⚖️ TO CONFIRM

For each purpose in `RECORD_OF_PROCESSING.md` section 3, the owner and lawyer record:

| Question | Notes from the build (facts) | Assessment ⚖️ |
|---|---|---|
| Is there a lawful basis for each purpose? | Placeholders are listed in the record of processing. The product records a parental consent in every case | `[to complete]` |
| Could the purpose be met with less data? | No child email, surname, photo, school, address, phone or location is collected. Age is month and year only. Avatars are generated shapes | `[to complete]` |
| Is each retention period justified? | See `RETENTION_SCHEDULE.md`; periods are specification defaults | `[to complete]` |
| How are people told? | Privacy notices for parents and for teenagers are required before sign-up can open. **Only unreviewed drafts exist** (`content/pages/legal`, being written on 16 November 2026); they are shown with a draft banner in local development and published nowhere else | `[to complete]` |
| How are rights met? | Download and deletion are self-service for parents and 18-year-olds. Correction: profile fields can be edited. Objection, restriction and complaints go to the support address `[address]` | `[to complete]` |
| Are processors bound by contract? | None is in use. Each needs a DPA and approval in Studio before the code will call it | `[to complete]` |
| International transfers? | None today. The AI provider is the main question (specification question 16) | `[to complete]` |
| Is the child's best interest the primary consideration? | See `CHILDRENS_CODE_MAPPING.md`, standard 1 | `[to complete]` |

## 4. Consultation

| Who | How | When | What changed as a result |
|---|---|---|---|
| Parents | `[to arrange]` | | |
| Teenagers | `[to arrange]` | | |
| Designated Safeguarding Lead | `[to arrange]` | | |
| Processors (security and region questions) | `[to arrange]` | | |

## 5. Risks to children and families

The "Measures as built" column states facts about the code. The likelihood, severity and residual
risk columns are for the assessors: **they are deliberately blank**. Use low / medium / high.

| # | Risk | Measures as built | Gaps | Likelihood ⚖️ | Severity ⚖️ | Residual ⚖️ |
|---|---|---|---|---|---|---|
| 1 | A child under 13 uses the service | Age gate before anything is stored; birth month counted so nobody is treated as older than they are (decision D13); a one-hour retry block | The date of birth is self-declared. A child can lie, or pose as a parent | | | |
| 2 | The person approving is not really the parent | The adult declares 18 or over and parental responsibility; for 13–15, Coach needs a £0 card check or a paid plan; for 16–17, a verified parent email | The method is ⚖️ (specification question 5). An email address proves control of a mailbox, not parenthood | | | |
| 3 | A child tells Coach personal or sensitive things | Obvious personal details are removed before the provider sees the message; transcripts are encrypted and deleted after 30 or 90 days; parents never see the words | Redaction is pattern-based and will miss things. Free text is still the child's words | | | |
| 4 | Coach says something harmful, wrong or unsuitable | Input and output checks; refusals; a fixed prompt; every reply labelled as AI; daily spend cap and kill switch | The local rules classifier is not enough on its own (see `docs/OPEN_QUESTIONS.md`, Coach). No provider has been evaluated | | | |
| 5 | A child in crisis is not noticed, or nobody acts | A fixed support script shown at once without waiting for a person; a critical alert; the message box stays available | **The safeguarding case service is NOT BUILT YET.** No DSL is named. The crisis script is a draft | | | |
| 6 | Children's words are sent to a provider abroad, kept or used for training | Requests ask for zero retention and no training; a provider cannot be enabled without a recorded DPA | No provider chosen; region and safeguards unknown ⚖️ | | | |
| 7 | An image or video of a real child is uploaded | Courses are written so evidence never needs real people; image and video files are never auto-accepted; rejected files are deleted at once; possibly illegal media is quarantined, not opened | No automated screening provider is approved (specification question 11). Reporting duties ⚖️ | | | |
| 8 | An outside tool is unsuitable for the child's age or collects more than expected | A Tool Register with a recorded under-18 policy per tool, checked by a person before a course is published; parent permission; a "you are leaving" notice; links limited to an allow-list | Tool terms change. The Register entries in the repository are development placeholders, not verified ⚖️ (specification question 4) | | | |
| 9 | Staff misuse access to a child's records | Roles; two-step sign-in; 12-hour sessions; every staff action audited; safeguarding notes encrypted and each view logged with a reason | Studio is NOT BUILT YET, so these controls have not been exercised in a real screen | | | |
| 10 | One family sees another's data | A single authorisation module with a test matrix; private files behind expiring signed links | A coding error remains possible; penetration testing has not been done | | | |
| 11 | A breach of the database or file store | Secrets only in environment variables; application-level encryption for the most sensitive fields; private buckets | Hosting not chosen: encryption at rest, backups and access controls to confirm. Encryption keys cannot yet be rotated | | | |
| 12 | A parent's oversight harms a child (for example a child at risk at home) | Parents never see Coach messages or private notes; the learner can see what a parent sees; a safeguarding concern about a parent must not be sent to that parent | The procedure is an outline until the DSL approves it ⚖️ | | | |
| 13 | Data is kept longer than needed | Nightly retention job; deletion with a 14-day undo | Periods are placeholders ⚖️. Backups and provider logs are outside the job | | | |
| 14 | Pressure to keep using the product | No streaks, scores or comparisons; no notifications to learners during quiet hours; parent time limits | Review copy and any future feature against standard 13 of the Children's code | | | |
| 15 | A deleted account's data comes back after a restore | The runbook requires deletions to be replayed | Manual step; not yet practised | | | |
| 16 | A learner's public certificate page identifies them | Shows a nickname (or a first name if the learner chose that), the course and the date, reached only with a code; `noindex` | ⚖️ TO CONFIRM whether a first name should be offered to under-18s at all | | | |

## 6. Measures to reduce the risks

List each action that follows from section 5, with an owner and a date. Starting points, all
already recorded as launch blockers in `docs/DEPLOYMENT.md`:

| Action | Owner | By | Done |
|---|---|---|---|
| Name and train a DSL; approve the safeguarding policy and the crisis script | | | [ ] |
| Finish the safeguarding case service and Studio screens; test the alert end to end | | | [ ] |
| Choose the AI provider; confirm region, zero retention and no training; sign a DPA; run the Coach evaluations against it | | | [ ] |
| Confirm the age-assurance method | | | [ ] |
| Verify every tool's terms and record its under-18 policy | | | [ ] |
| Publish the privacy notices (parent and teen versions) | | | [ ] |
| Confirm lawful bases and retention periods | | | [ ] |
| Decide on a CSAM screening provider and the reporting procedure | | | [ ] |
| Independent security test before launch | | | [ ] |

## 7. Sign-off

| | Name | Date | Notes |
|---|---|---|---|
| Measures approved by | | | |
| Residual risks accepted by | | | |
| Legal advice | | | Summary of advice and whether it was followed |
| DPO advice (if appointed) | | | |
| ICO consultation needed? ⚖️ | | | Required if a high residual risk remains |

## 8. Outcome

`[Proceed / proceed with conditions / do not proceed]` — not decided.

## 9. Review this DPIA when

- an AI provider, or any other processor, is chosen or changed;
- uploads showing real people are ever allowed;
- any learner-to-learner feature, public profile, analytics tool or advertising is proposed;
- a new age group, country or school use is proposed;
- a retention period, the age-assurance method or what a parent can see changes;
- there is an incident involving children's data.
