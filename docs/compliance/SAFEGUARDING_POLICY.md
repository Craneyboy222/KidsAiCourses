# Safeguarding policy and procedure (outline)

**An outline for the Designated Safeguarding Lead (DSL) to rewrite and approve. It is not a
policy yet.** No DSL has been named or trained, nothing here has been reviewed by a safeguarding
professional, and public sign-up cannot open until one has (decision D2 and the launch-readiness
gate). ⚖️ TO CONFIRM marks a judgement for the DSL or a lawyer. What the product does is described
as built on 16 November 2026, and NOT BUILT YET marks the parts that are missing.

**If a child is in immediate danger, call 999.** Do not wait for anything in this document.

## 1. Who this covers

Learners aged 13 to 17, and 18-year-olds, using `[Platform Name]` in the UK. The service is online
only: staff never meet learners and there is no live chat, voice or video between anyone.

## 2. People

| Role | Who | Notes |
|---|---|---|
| Designated Safeguarding Lead | `[name]` — **not yet named** | The owner may hold the role at launch, once trained (decision D2). Recorded in the setting `safeguarding.dsl_name` |
| Deputy or outsourced cover | `[name or provider]` — none | Needed before scaling (decision D2). Escalation to a deputy is off until one is named |
| Everyone with staff access | | Must have read this policy; training and vetting below |

⚖️ TO CONFIRM with the DSL and a lawyer: the training the DSL and each staff role need; whether
any role is eligible for, or requires, a criminal-record check, given that staff read children's
work and reports but have no direct contact; safer-recruitment steps.

## 3. What a concern looks like here

- A learner tells Coach, or writes in a reflection, a note or a report, that they or someone else
  is being harmed, is at risk, or is thinking about harming themselves.
- "Someone is in danger" is chosen in a report.
- Something in submitted work suggests abuse, exploitation or self-harm, or shows a real child.
- An image or video that may be illegal.
- A concern about an adult: a parent or carer, a member of staff, or someone at an outside tool.
- A pattern a moderator notices across several items.

## 4. What the product does automatically

| Event | What happens at once | Where |
|---|---|---|
| A Coach message looks like a cry for help | The learner is shown a fixed support script (written in advance, never generated). Coach stops being a tutor for that turn. The conversation is flagged, kept under the safeguarding schedule and hidden from later prompts. A case is requested | `src/server/ai/crisis.ts`, `proxy.ts`; `content/prompts/crisis-script.v1.md` (**a draft**) |
| The check runs even when Coach is off | A message is checked before anyone is turned away for being out of credits, in quiet hours or during an AI break | `src/server/ai/proxy.ts` |
| A "Someone is in danger" report | Saved first; fixed crisis signposting shown; a critical case requested | `src/server/services/reports.ts` |
| A case cannot be opened | From a report, a submission or a moderator's escalation: the item goes to the moderation queue as critical instead, so a person is still told. From Coach: four tries, then the log event `coach.crisis.CASE_NOT_OPENED`, which must page someone. The learner sees the support script either way | `src/server/services/safeguarding-bridge.ts`, `src/server/ai/crisis.ts` |
| Media that may be illegal | Quarantined: not deleted, not shown, not opened | decision D3 |
| Any image or video upload | Waits for a person; never accepted automatically | `src/server/services/submission.ts` |

**NOT BUILT YET, and required before any real learner uses the service:**

- the case service itself (`openSafeguardingCase` is a placeholder: today **no case is ever
  created**. A request from a report or a submission becomes a critical moderation item; a
  request from Coach becomes only the log line above);
- the alert email to the DSL address (`DSL_ALERT_EMAILS`, `safeguarding.alert_emails`) and the
  optional SMS;
- Studio's safeguarding and moderation screens, the break-glass view of encrypted notes, the
  weekly counts-and-themes report, the parent-contact templates;
- a way to pause Coach for one learner from a case.

The automatic detection is local keyword and pattern matching. It is known to miss some
disclosures and must not be the only safeguard (`docs/OPEN_QUESTIONS.md`, Coach). ⚖️ The DSL
should read the evaluation results before Coach is opened to learners.

## 5. What a person does

Response targets for a sole operator, counted between 08:00 and 22:00 UK time
(`moderation.sla_hours`): **critical 4 hours, high 8 hours, normal 48 hours.** ⚖️ TO CONFIRM that
these are acceptable, and what a learner is told about when a person will see their message. The
support script must not suggest that someone is watching in real time.

1. **Acknowledge** the alert.
2. **Read only what is needed.** Case notes are encrypted; opening them asks for a reason and is
   logged (`safeguarding_access_log`).
3. **Assess** the risk: immediate danger, significant harm, or a welfare concern.
4. **Act**, and record the decision and the reasons:
   - immediate danger: 999;
   - a child at risk of significant harm: refer to children's social care for the area where the
     child lives ⚖️ (the product holds no address: see section 7);
   - advice: the NSPCC helpline, 0808 800 5000;
   - online sexual abuse or grooming: CEOP;
   - possibly illegal images: do not open, copy or forward them; report as the law requires
     ⚖️ TO CONFIRM (the Internet Watch Foundation and the police);
   - contact the parent or carer from a template, **unless** the concern is about them or telling
     them could put the child at greater risk;
   - restrict Coach, pause or close the account where needed.
5. **Follow up** and **close** the case with its outcome.

Signposting shown to learners (Childline, 0800 1111; 999) ⚖️ TO CONFIRM the wording and numbers
with the DSL before launch, and check them at each review.

## 6. Concerns about adults

- **A parent or carer:** never share the concern with that adult. The parent dashboard shows
  only a count of safety notices, never case detail ⚖️ TO CONFIRM that even a count is safe in
  every case, and how it is suppressed when it is not.
- **A member of staff:** goes to the DSL, or to `[an independent person]` if it concerns the DSL.
  ⚖️ TO CONFIRM the route (for example the local authority designated officer) for this kind of
  service.
- **An outside tool or one of its users:** record it, report it to the tool, and consider taking
  the course down (`docs/RUNBOOK.md`).

## 7. What we know about a child, and what we do not

The product holds a username, a nickname, a birth month and year and the parent's email address.
It holds **no name, address, school or phone number** for a child. A referral may therefore rest
on the parent's contact details and on whatever the child has written. ⚖️ TO CONFIRM with the DSL
how a referral is made with so little, when the parent may be contacted to find out more, and
what is done when the parent is the concern.

## 8. Confidentiality, records and retention

- Case notes are encrypted with their own key (`SAFEGUARDING_ENCRYPTION_KEY`). Every access is
  logged. Alerts never contain the child's words.
- Sharing information to protect a child does not need consent where the law allows it
  ⚖️ TO CONFIRM the basis and record each disclosure.
- Cases are **never deleted automatically**. Flagged conversations are held while a case is open
  and then for the flagged-content period. A learner with a case is anonymised, not removed, when
  their account is deleted. ⚖️ TO CONFIRM every period in `RETENTION_SCHEDULE.md` that mentions
  safeguarding.
- The seed creates one case labelled TEST when the case service exists. A test case must never be
  created in production.

## 9. Parents and learners: what they are told

- Learners: how to report, what Coach is and is not, that Coach is not a person and is not
  watched live, and where to get help now. In the teen privacy notice, the community code and the
  help pages (all unreviewed drafts today: the DSL should read every one that mentions safety).
- Parents: what they can and cannot see, that we may act without telling them first when a
  child's safety needs it, and how to raise a concern.

## 10. Review

Reviewed by the DSL at least once a year, after any serious case, and whenever a feature that
changes the risks is proposed (any contact between learners, uploads showing people, voice or
video). Next review: `[date]`. Approved by: `[name, role, date]` — **not approved**.
