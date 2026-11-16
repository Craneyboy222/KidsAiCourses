# Online Safety Act 2023: notes towards a scope decision

**These are notes for a lawyer, not an assessment.** Whether the Act applies to `[Platform Name]`,
and which duties follow, is a legal judgement that has not been made (specification question 8;
launch-readiness item). ⚖️ TO CONFIRM marks every such judgement. Facts about the product are as
built on 16 November 2026. Ofcom's guidance and codes change: check the current versions.

## 1. What the lawyer needs to know about the product

The Act's main duties fall on "user-to-user" services (where content one user generates or
uploads can be encountered by another user) and on search services. The facts that bear on that:

| Feature | As built | Question for the lawyer ⚖️ TO CONFIRM |
|---|---|---|
| Learner-to-learner contact | None. No messages, comments, friends, groups, public profiles or shared feeds. A learner cannot see any other learner or their work | Does the absence of any learner-to-learner route take the learner side outside "user-to-user"? |
| Submissions | Private. Seen by the learner, by staff who review them, and (as a list of projects) by that learner's own parent | Is content shared between a learner, their parent's account and staff "encountered by another user"? Do the exemptions for provider content and for internal or one-to-one arrangements help? |
| Reports and support messages | From a learner or parent to staff only | Same question |
| Staff notes on a submission | A moderator's note is shown to that learner | Provider content? |
| Parent and child accounts | Separate sign-ins in one family; the parent sees a summary of the child's activity, never Coach messages or private notes | Same question |
| Coach (AI tutor) | The learner's messages go to a model and the reply comes back to that learner only. Nobody else sees the conversation except the DSL for a flagged one. Not a search engine: it does not search the web | How does Ofcom's current position on generative AI chatbots apply to a first-party tutor whose output is seen only by the person who prompted it? |
| Certificate check page | Public to anyone holding the code: display name (nickname, or a first name if chosen), course title, date. `noindex` | Is this user-generated content that others can encounter? |
| Links to work on outside tools | Stored as evidence; never fetched, hosted or shown to anyone but the learner, their parent and reviewers | — |
| Outside tools (Replit, Canva and others) | Separate services under their own terms. We link to them | Their own duties are theirs; does linking children to them create any duty for us? |
| Course content | Written or reviewed by the team; never published without a human approval | Provider content, outside the user-generated duties? |
| Pornographic content | None is published and the content rules forbid it | Confirm no "Part 5" duty arises |
| Future features | Learner-to-learner features are listed as future additions and are **not built** | Any such feature would need this assessment again before it is designed |

## 2. If the Act applies in whole or part

A lawyer would then need to settle, at least ⚖️ TO CONFIRM:

- which category of service this is, and whether any threshold conditions are met;
- the **illegal content risk assessment** and the duties that follow;
- the **children's access assessment** (the service is plainly likely to be accessed by children:
  it is built for them) and the **children's risk assessment**;
- what "highly effective age assurance" would mean here, if it is required at all, against what
  the product does (self-declared birth month and year, a parent's email, a £0 card check or a
  paid plan);
- reporting and complaints procedures, terms of service statements and record-keeping;
- duties about child sexual abuse material, including reporting, given that the product accepts
  image and video uploads for review by a person and no screening provider is approved;
- fees and notifications to Ofcom, if any.

## 3. What the product already does that such assessments would draw on

Facts, not a claim of compliance.

- **Reporting:** a report control on course, player, Coach and project screens; "Someone is in
  danger" opens a critical alert at once and shows fixed crisis signposting
  (`src/server/services/reports.ts`).
- **Moderation:** automatic checks, then a human queue with response targets; image and video
  files are never auto-accepted; a random sample of clean work is also held for a person
  (`src/server/services/moderation.ts`, `submission.ts`).
- **Possibly illegal media:** quarantined, not deleted and not opened; rejected media is deleted
  at once with its hash and metadata kept (decision D3).
- **Coach:** input and output checks, a crisis classifier, a fixed support script, an AI label on
  every reply, a kill switch and a daily spend cap (`src/server/ai/`).
- **Age:** under-13 block; minimum ages on courses and tools enforced on direct links.
- **Private by default:** no public profiles; learner areas and certificate pages are `noindex`.
- **Records:** an append-only audit log of staff actions and safeguarding access.

Gaps that any risk assessment would have to record:

- the safeguarding case service and all Studio screens (moderation, safeguarding, settings) are
  NOT BUILT YET;
- no Designated Safeguarding Lead is named and the crisis script is a draft;
- the local rules classifier is known to miss some disclosures (`docs/OPEN_QUESTIONS.md`, Coach);
- no CSAM screening provider is approved and the reporting procedure is undecided;
- terms of service and the community code are unreviewed drafts, and a complaints route is NOT
  BUILT YET.

## 4. Risk assessment worksheets (blank)

To be completed with the lawyer if section 1 concludes the Act applies. One row per harm; add rows.

**Illegal content**

| Kind of illegal content | How it could arise on this service | Likelihood ⚖️ | Impact ⚖️ | Measures in place | Further measures |
|---|---|---|---|---|---|
| Child sexual abuse material | An uploaded image or video | | | | |
| Grooming or sexual exploitation | A disclosure to Coach or in a report (there is no route for an adult stranger to contact a child here) | | | | |
| `[others from Ofcom's register of risks]` | | | | | |

**Content harmful to children**

| Kind of content | How it could arise | Likelihood ⚖️ | Impact ⚖️ | Measures in place | Further measures |
|---|---|---|---|---|---|
| Suicide, self-harm, eating disorder content | A Coach reply; a learner's own upload | | | | |
| Pornographic or violent content | A Coach reply; a learner's own upload; an outside tool | | | | |
| Bullying, abuse or hate | A learner's own submission (seen only by staff and the parent) | | | | |
| `[others]` | | | | | |

## 5. Decision record

| | |
|---|---|
| Is the service in scope? | `[not decided]` ⚖️ |
| On what reasoning? | |
| Advised by | |
| Date | |
| Review when | Any feature in section 1 changes; Ofcom guidance changes; annually |
