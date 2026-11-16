# Children's code mapping

The ICO's Age appropriate design code (the "Children's code") has 15 standards. This document
takes them one by one and says what the product does today, where in the code, and what is missing.

**It is a checklist, not a statement of conformance.** Whether a standard is met is a judgement
for the owner with a lawyer: each one ends with a ⚖️ TO CONFIRM line that is deliberately left
open. Facts are as built on 16 November 2026. NOT BUILT YET marks a gap in the product.

Age bands used by the product: 13–15, 16–17 and 18 (`src/server/services/age.ts`). Under-13s
cannot hold an account.

## 1. Best interests of the child

- Courses nudge a learner to make something themselves; Coach is written to guide, not to do the
  work (`content/prompts/coach.v1.md`).
- No advertising, no selling of data, no learner-to-learner contact, no public profiles.
- Under-18s never see prices, checkout or invoices (`<AskParentToUnlock>`).
- Where a requirement was ambiguous the reading safer for children was taken and written down
  (`docs/DECISIONS.md`).
- Gap: no best-interests assessment has been written, and children and parents have not been
  consulted.
- ⚖️ TO CONFIRM: that the commercial model (a paid family plan, a free tier with limited Coach
  use) does not conflict with the child's best interests.

## 2. Data protection impact assessments

- `DPIA_TEMPLATE.md` is part-filled from the code. It is a draft and unsigned.
- ⚖️ TO CONFIRM: complete and sign it before launch; decide whether the ICO must be consulted.

## 3. Age appropriate application

- Age comes from a self-declared birth month and year. A birthday counts only once the birth
  month has fully passed, so nobody is treated as older than they are (decision D13).
- Under-13s are refused before anything is stored (`src/app/(auth)/_lib/age-gate.ts`).
- Further assurance by band (`src/server/services/age-assurance.ts`): 13–15 need an adult's £0
  card check or a paid plan before Coach opens; 16–17 need a parent's verified email; 18 nothing more.
- The safety band is recalculated daily; the stricter of the stored and live value applies.
- Courses and tools carry a minimum age; the start gate enforces it on direct links too.
- Gap: self-declaration can be falsified, and an email proves control of a mailbox, not parenthood.
- ⚖️ TO CONFIRM: that this level of certainty is proportionate to the risks (specification
  question 5), or that the code's protections are applied to everyone regardless.

## 4. Transparency

- Consent wording is short and plain (`content/consents/*.json`), shown to the parent at the
  moment of choice, versioned, and re-asked when a required wording changes.
- A learner's Settings page has "What my parent can see" (`src/app/(learner)/settings/page.tsx`).
- Coach replies are labelled as AI. Leaving for an outside tool shows a notice first.
- A fixed address for a privacy notice written for teenagers exists (`/legal/privacy-teen`,
  decision D16) and sign-up cannot open until all six legal pages are published.
- Gap: **the legal pages are unreviewed drafts** (`content/pages/legal`, being written on
  16 November 2026). Local development shows them with a draft banner so that sign-up can be
  tried; nothing is published anywhere else. No "bite-sized" explanation is shown to the learner
  at the point Coach is first used.
- ⚖️ TO CONFIRM: the wording of both privacy notices and of each consent.

## 5. Detrimental use of data

- Data is used to run courses, Coach, safety and the parent dashboard, and for nothing else. No
  marketing to children; under-18s have no email address and are never emailed.
- No streaks, scores, leaderboards or comparisons (`src/server/services/learner-home.ts`).
- Learners get in-app notifications only, and none during quiet hours (default 21:00 to 07:00).
- ⚖️ TO CONFIRM: against the relevant codes of practice and guidance (for example on marketing to
  children).

## 6. Policies and community standards

- Publication always needs a recorded human approval; the publish service refuses without one.
- Reports reach a moderation queue with response targets (critical 4 hours, high 8, normal 48,
  inside 08:00 to 22:00); "Someone is in danger" is treated as critical at once.
- Addresses for a community code and an AI use policy are fixed (decision D16).
- Gap: the community code and AI use policy are unreviewed drafts. Studio's moderation and
  safeguarding screens are NOT BUILT YET, so the targets cannot be met in practice today.
- ⚖️ TO CONFIRM: that the published policies match what the product and the team actually do.

## 7. Default settings

- Every optional permission is **off by default for every age band** (longer Coach history,
  product analytics); the importer refuses "on" for 13–15.
- Everything a learner makes is private. There is no setting that makes it public.
- Coach transcripts are not visible to parents (`safety.parent_transcript_visibility` has one
  permitted value, `summary`).
- Image and video uploads are never accepted automatically.
- ⚖️ TO CONFIRM: that the three required permissions are genuinely necessary for the service
  rather than bundled.

## 8. Data minimisation

- Not collected from a child: email address, surname, photograph, school, address, phone number,
  location. Usernames and nicknames that look like a real name, school or place are refused
  (`src/server/services/username.ts`).
- Age is held as month and year. Avatars are generated shapes.
- Uploaded images have location and camera metadata removed
  (`src/server/services/evidence-checks.ts`). Evidence links are never fetched or copied.
- Coach request records hold counts and costs, never the words. Logs never hold learner free text.
- ⚖️ TO CONFIRM: optional first name for certificates; IP address and browser string on sessions
  and consent records.

## 9. Data sharing

- No child's data is shared with any third party today: nothing is deployed and every external
  service runs on a local stand-in.
- Outside tools receive nothing from us. A child (or the parent, for a parent-operated tool) signs
  up with the tool directly, after the parent's permission.
- A model provider, once chosen, would receive Coach messages with obvious personal details
  removed. It cannot be switched on without an approval and a recorded DPA
  (`src/server/processors.ts`).
- ⚖️ TO CONFIRM: each processor in `PROCESSOR_REGISTER.md`; disclosures to authorities.

## 10. Geolocation

- None. The product never asks for location, the `Permissions-Policy` header disables the browser
  geolocation API (`next.config.ts`), and image location metadata is stripped.
- IP addresses are stored with sessions and consent records for security and evidence; they are
  not used to locate anyone.
- ⚖️ TO CONFIRM: nothing further expected.

## 11. Parental controls

- A parent can set a daily time limit and quiet hours, block categories or courses, ask to
  approve Pro-level courses first, approve individual outside tools, and pause the account
  (`src/server/services/parent-controls.ts`, `tool-approval.ts`).
- The learner is told: Settings shows what a parent can and cannot see, and the limits a parent
  has set. A learner stopped by a time limit or quiet hours is told that is the reason.
- Parents see progress, time used, projects, a Coach summary and safety notices. They do not see
  Coach messages, private notes or the password.
- At 18 a learner can take over their own account and remove the parent link.
- Gap: there is no always-visible sign on the learner's screens that monitoring is active; the
  information is in Settings.
- ⚖️ TO CONFIRM: whether that is an "obvious sign" in the code's sense, and the position for
  16–17-year-olds.

## 12. Profiling

- The catalogue puts courses that share a learner's chosen interests and school stage first. It
  only orders; it never hides a course (`src/server/services/catalogue.ts`). Interests are chosen
  by the learner from a fixed list and can be changed in Settings.
- No behavioural profiling, no inferred interests, no advertising profiles, no automated decisions
  about a child. The safety band is derived from age alone.
- Safety classification of Coach messages and submissions is automated and can lead to human review.
- ⚖️ TO CONFIRM: whether ordering by chosen interests is "profiling" that needs a switch, and the
  position on automated safety checks.

## 13. Nudge techniques

- No streaks, no countdowns, no rewards for time spent, no pre-ticked boxes.
- Withdrawing a permission is on the same screen as granting it, and deleting an account is on
  the Privacy page. Withdrawing a **required** permission asks for one confirmation tick, because
  it pauses the child's account. Deletion has a 14-day undo rather than a hurdle.
- Gap: copy and design have not had an independent review for dark patterns.
- ⚖️ TO CONFIRM after that review.

## 14. Connected toys and devices

- Not applicable: the product is a website. No device, camera or microphone access
  (`Permissions-Policy` disables camera and microphone).

## 15. Online tools

- A report control is on the course page, every step of the player, the Coach panel and each
  project page (`src/components/safety/ReportControl.tsx`), with "Someone is in danger" as the
  first reason.
- A parent can download or delete a child's data, and undo a deletion, from the Privacy page
  (`src/app/(parent)/parent/privacy`). An 18-year-old has the same page for themselves.
- A learner under 18 can see what a parent can see, but download and deletion are done by the
  parent.
- Gap: no route is built for an under-18 to make a data-rights request themselves, or to ask
  for help without the parent. Help articles are being written (`content/pages/help`) and have
  not been reviewed.
- ⚖️ TO CONFIRM: how a competent child exercises their own rights, and how a request is handled
  when the child and parent disagree.
