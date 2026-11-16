# Incident and personal-data breach procedure

What to do when something goes wrong with security or with people's data. A template: the steps
that touch the product are filled in from the code as built on 16 November 2026; names, phone
numbers and every legal judgement (⚖️ TO CONFIRM) are for the owner and a lawyer. Not legal advice.

**A child in immediate danger is not an "incident": call 999, then follow
`SAFEGUARDING_POLICY.md`.**

## People

| Role | Who | Contact |
|---|---|---|
| Incident lead (decides, records, reports) | `[name]` — at launch, the owner | `[phone, email]` |
| Cover when the lead is away | `[name]` — none yet | |
| Designated Safeguarding Lead | `[name]` | |
| Lawyer (data protection) | `[firm, name]` | |
| Technical help | `[name]` | |
| Processors' security contacts | In `PROCESSOR_REGISTER.md` once each is chosen | |

## What counts

- **A personal-data breach:** personal data is lost, destroyed, changed, disclosed or accessed
  when it should not have been, by accident or on purpose. Examples here: one family seeing
  another's data; a leaked database, backup or file bucket; a leaked secret (database password,
  encryption key, sign-in secret); an email sent to the wrong parent; a staff account taken over;
  a processor telling us they had a breach; data deleted that should have been kept, or the
  reverse.
- **A security incident with no personal data involved** (for example the site is down): follow
  the same steps as far as "Assess", record it, and stop there.

If you are not sure whether it is a breach, treat it as one and start the clock.

## 1. In the first hour: contain

Write down **the time you became aware**. Then, as the situation needs
(`docs/RUNBOOK.md` has the detail for each):

- Stop the feature involved: Coach kill switch, close sign-up, take a course down, disable a
  provider. Pause the whole project only for an active attack, because it also removes the crisis
  signposting from learners.
- End sessions: one person's, or everyone's (`delete from session …`).
- Lock or pause an account that has been taken over (`user.status`).
- Rotate the secret that leaked. **Do not rotate `SAFEGUARDING_ENCRYPTION_KEY` or
  `CONTENT_ENCRYPTION_KEY` by simply replacing them**: see the runbook.
- Keep the evidence: do not delete logs, rows or files; note what you changed and when.

## 2. Assess (same day)

Record the answers in the incident log (section 7).

1. What happened, and is it still happening?
2. What data: which tables or files, which fields? Use `RECORD_OF_PROCESSING.md` section 2.
3. Whose: how many learners, parents, staff? **Are children's records involved?** Assume a higher
   risk when they are.
4. Was the data readable? Safeguarding notes and stored Coach messages are encrypted at the
   application level, and passwords are hashed; most other fields are not encrypted beyond the
   host's encryption at rest.
5. Who could have seen it, and is there evidence that anyone did? Sources: the hosting provider's
   logs, `audit_log`, `safeguarding_access_log`, `session`.
6. What could happen to the people affected (distress, contact from a stranger, fraud, harm at
   home, loss of work)?
7. Does it involve safeguarding records, a flagged conversation or quarantined media? If so the
   DSL joins the response now.

## 3. Decide who must be told ⚖️ TO CONFIRM with the lawyer each time

- **The ICO.** A breach must be reported **within 72 hours of becoming aware** unless it is
  unlikely to result in a risk to people's rights and freedoms. If the full facts are not known,
  report what is known in time and add to it later. If you decide not to report, record why.
  Report through the ICO's breach-reporting service (`[link and phone number to add: check the
  ICO's website for the current ones]`).
- **The people affected.** When the risk to them is likely to be **high**, tell them without undue
  delay, in plain words: what happened, what data, what we have done, what they can do, and who to
  contact. For a child's data, tell the parent or carer; ⚖️ TO CONFIRM when the child should be
  told directly, and never route a message through a parent who is the subject of a safeguarding
  concern (the DSL decides).
- **The police**, if a crime is suspected; **Action Fraud** for fraud or cyber crime.
- **Processors and partners** whose systems are involved; **Stripe** if payment data is involved
  (card numbers never reach our systems).
- **Ofcom or others**, if the Online Safety Act or another regime applies ⚖️.
- **An insurer**, if there is cyber cover `[policy]`.

A processor that has a breach must tell us without undue delay (their DPA should say so). Our
72 hours start when **we** become aware.

## 4. Tell people

- Parents are emailed from the service address using a plain template `[to write and have
  reviewed before launch]`. Under-18 learners have no email address; an in-app notice may be used
  if the DSL and lawyer agree it is right for the child to read it.
- Say only what is known. Do not include other people's data. Give one contact address.
- Put a notice on the site if many people are affected (`site.maintenance_message`).

## 5. Fix and recover

- Fix the cause. Every bug fix adds a regression test (`docs/CONVENTIONS.md`).
- If data was lost, restore following the runbook, **and replay deletions made since the restore
  point** so that deleted data does not come back.
- Confirm the fix in production, then lift the kill switch.

## 6. Review (within two weeks)

What happened, why, what worked, what did not, and what changes. Update the DPIA, the processor
register and this procedure. Tell the ICO anything that changes what was reported.

## 7. Incident log

Every incident is recorded, **including those not reported to the ICO** (that record is itself a
legal requirement ⚖️). Keep it outside the product, somewhere only the incident lead and cover
can read: `[where]`.

| Field | |
|---|---|
| Reference and title | |
| Became aware (date, time, how, who) | |
| What happened | |
| Data and people affected (numbers; children?) | |
| Containment (what, when) | |
| Risk assessment and reasoning | |
| ICO: reported? (date, time, reference) or why not | |
| People told? (date, how) or why not | |
| Others told | |
| Cause and fix | |
| Follow-up actions, owners, dates | |
| Closed (date, by) | |

## 8. Before launch

- [ ] Names and phone numbers filled in above; a cover person agreed
- [ ] The lawyer has reviewed sections 3 and 4 ⚖️
- [ ] The parent notification template is written
- [ ] Log alerts are set on the events listed in the runbook
- [ ] Backups confirmed and a restore practised
- [ ] A re-encryption script exists for the two encryption keys (it does not yet: `docs/OPEN_QUESTIONS.md`)
- [ ] A practice run of this procedure has been done: `[date]`
