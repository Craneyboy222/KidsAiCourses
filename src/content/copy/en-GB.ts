/**
 * Default wording for short pieces of in-app copy, in British English.
 *
 * Read it on the server with `t(ctx, "key", vars)` from `@/server/copy`, which lets Studio
 * override any of these: a published page of kind `snippet` whose slug is the key replaces the
 * default. `{{name}}` marks a value filled in at the time.
 *
 * Tone: for learners, confident and plain, never childish, no exclamation-mark pile-ups. For
 * parents, plain English. An error says what happened and what to try. Learner copy never
 * mentions prices.
 *
 * Keep this object flat, and add keys rather than renaming them: other code refers to them.
 */
export const EN_GB = {
  // ── Errors ────────────────────────────────────────────────────────────────
  "error.generic": "Something went wrong on our side. Nothing was lost. Try again in a moment.",
  "error.not_found": "We couldn't find that. It may have been moved or removed.",
  "error.forbidden": "You don't have permission to do that.",
  "error.signed_out": "You've been signed out. Sign in again to carry on.",
  "error.offline": "You seem to be offline. Check your connection, then try again.",
  "error.rate_limited": "That's a lot in a short time. Give it a minute, then try again.",
  "error.invalid_form": "Some of that didn't look right. Check the highlighted boxes and try again.",
  "error.upload_too_big": "That file is too big. Try a smaller file or a shorter clip.",
  "error.upload_wrong_type":
    "We can't accept that kind of file here. Check which file types this step asks for.",
  "error.maintenance": "We're doing some maintenance. Your work is safe. Please come back shortly.",

  // ── Sign-up and age ───────────────────────────────────────────────────────
  "signup.closed": "We're not open for new sign-ups just yet. Please check back soon.",
  "signup.under13.title": "Thanks for stopping by",
  "signup.under13.body":
    "This site is for people aged 13 to 18, so we can't set up an account for you right now. We haven't saved anything you typed. Come back when you're 13. Until then, a parent or carer can help you find something made for your age.",
  "signup.pending_parent.title": "Nearly there",
  "signup.pending_parent.body":
    "We've emailed your parent or carer. Once they approve your account you can get started. If they don't reply within 7 days, we delete your details.",
  "signup.learner_no_email": "You don't need an email address. You'll sign in with a username and password.",
  "signup.under13.just_turned_13":
    "Just turned 13? We only ever ask for the month and year you were born, so accounts open on the 1st of the month after a 13th birthday.",
  "signup.under13.parent":
    "Adding a child as a parent or carer? Children can join once they are 13. Nothing about them has been saved.",
  "signup.closed.title": "We're not open yet",
  "signup.closed.body":
    "We're getting everything ready before we let anyone sign up, and we're not quite there. Nothing you typed has been saved. Please check back soon.",
  "signup.teen.deleted_after_7_days":
    "If your parent or carer doesn't approve your account within 7 days, we delete it and everything in it. You can always sign up again.",
  "signup.teen.locked_until_approved":
    "Until they approve it, your account is locked: you can look around, but you can't use Coach, save work or earn a certificate.",
  "signin.learner.forgot_password":
    "Forgotten your password? Ask your parent or carer to reset it from their dashboard. They can set a new one or give you a one-time code.",

  // ── How safety and outside tools work (parents; shown in parent onboarding, reusable elsewhere) ──
  "safety.how_it_works.title": "How safety and outside tools work",
  "safety.how_it_works.intro":
    "{{brandName}} teaches teenagers to make real things with today's AI tools. Here is what we do to keep that safe, and what stays in your hands.",
  "safety.how_it_works.private":
    "Private by default. There are no public profiles, no friends lists and no messaging between learners. Your child is known by a nickname and a username, never a real name or a photo.",
  "safety.how_it_works.coach":
    "Coach is our built-in AI helper. It gives hints, not answers, and always says it is an AI. Messages are checked before they go out and before your child sees a reply. If a message suggests your child may be at risk, they are shown where to get help straight away and our safeguarding lead is alerted.",
  "safety.how_it_works.tools":
    "Courses use real tools made by other companies. Each course lists the tools it needs, what they cost, the company's own minimum age and whether you need to approve the tool or run it yourself. Those tools have their own terms and privacy policies.",
  "safety.how_it_works.tools_data":
    "What your child types into another company's tool goes to that company, not to us. We only receive what your child chooses to hand in as their finished work, such as a link or a screenshot. We never ask for a password, sign-in code or key for an outside tool.",
  "safety.how_it_works.controls":
    "You stay in charge. You can set a daily time limit and quiet hours, block categories or courses, approve tools one by one, pause the account, download your child's data or ask us to delete it.",
  "safety.how_it_works.people":
    "Work is checked before it reaches a portfolio, and photos or videos of real people are not accepted. Every published course has been reviewed and signed off by a person on our team.",

  // ── "What my parent can see" (the same facts for the teen and for the parent) ──
  "parent_view.title": "What my parent can see",
  "parent_view.title.parent": "What you can see, and what stays private",
  "parent_view.intro":
    "Your parent or carer helps look after your account. They see enough to know you're safe and making progress, not everything you type.",
  "parent_view.intro.parent":
    "You see enough to know your child is safe and making progress. Some things stay private to them, so they can ask questions freely.",
  "parent_view.sees.progress": "The courses you've started and finished, and how far through you are.",
  "parent_view.sees.time": "How much time you've spent this week.",
  "parent_view.sees.projects": "The projects in your portfolio and the certificates you've earned.",
  "parent_view.sees.coach_summary": "How many Coach chats you've had and the topics they covered.",
  "parent_view.sees.safety": "Safety notices, if something worrying came up.",
  "parent_view.sees.requests": "Anything you've asked them to approve, such as a tool or a locked course.",
  "parent_view.hidden.coach_messages": "What you actually typed to Coach, or what Coach said back.",
  "parent_view.hidden.notes": "Your private notes on a step.",
  "parent_view.hidden.password": "Your password. They can reset it, but they can never read it.",
  // The same list, worded for the parent.
  "parent_view.parent.sees.progress": "The courses your child has started and finished, and how far through they are.",
  "parent_view.parent.sees.time": "How much time they have spent this week.",
  "parent_view.parent.sees.projects": "The projects in their portfolio and the certificates they have earned.",
  "parent_view.parent.sees.coach_summary": "How many Coach chats they have had and the topics covered.",
  "parent_view.parent.sees.safety": "Safety notices, if something worrying came up.",
  "parent_view.parent.sees.requests": "Anything they have asked you to approve, such as a tool or a locked course.",
  "parent_view.parent.hidden.coach_messages": "What they actually typed to Coach, or what Coach said back.",
  "parent_view.parent.hidden.notes": "Their private notes on a step.",
  "parent_view.parent.hidden.password": "Their password. You can reset it, but you can never read it.",
  "parent_view.controls":
    "They can also set a daily time limit and quiet hours, block categories or courses, approve tools, pause your account, and download or delete your data.",
  "parent_view.safeguarding":
    "If something suggests you might be in danger, our safeguarding lead may contact your parent or carer. That is the only time more is shared.",

  // ── Asking a parent ───────────────────────────────────────────────────────
  "unlock.ask_parent.title": "Ask a parent to unlock",
  "unlock.ask_parent.body":
    "This one needs a parent or carer to unlock it. Send them a request and we'll let you know what they say.",
  "unlock.ask_parent.action": "Ask a parent to unlock",
  "unlock.requested": "Request sent. We'll tell you when your parent or carer has decided.",
  "unlock.declined": "Your parent or carer said no to this one for now. There's plenty more to try.",
  "tool.ask_parent.title": "This tool needs a parent's OK",
  "tool.ask_parent.body":
    "{{toolName}} asks for a parent or carer's permission before under-18s use it. Send a request and carry on with something else while you wait.",
  "tool.parent_operated": "A parent or carer needs to run {{toolName}} for you. You direct, they click.",
  "tool.blocked": "{{toolName}} isn't available for your age group, so this course is off the list for now.",

  // ── Leaving the site ──────────────────────────────────────────────────────
  "external.leaving.title": "You're about to leave {{brandName}}",
  "external.leaving.body":
    "{{toolName}} is run by another company, with its own rules and privacy settings. We'll keep your place here.",
  "external.leaving.never_share":
    "Never share a password, sign-in code or API key with anyone, including us. We will never ask for one.",
  "external.leaving.continue": "Continue to {{toolName}}",
  "external.leaving.stay": "Stay here",

  // ── AI and review ─────────────────────────────────────────────────────────
  "ai.label": "AI-generated",
  "ai.label.description": "Coach is an AI. It can be wrong, so check anything important.",
  "ai.unavailable": "Coach is taking a break right now. Everything else in this step still works.",
  "ai.credits_exhausted":
    "You've used this month's Coach messages. They refill on {{refillDate}}. Hints and guides still work.",
  "course.reviewed_by_team": "Reviewed and signed off by the team",
  "course.last_checked": "Last checked {{date}}",
  "submission.awaiting_review.title": "Awaiting review",
  "submission.awaiting_review.body":
    "A person on our team is checking your work. That usually takes a day or two. You can keep learning in the meantime.",
  "submission.accepted": "Accepted. Nice work.",
  "submission.changes_needed": "Not quite there yet. Have a look at the notes, then send it again.",
  "submission.no_people": "Please don't upload photos or videos that show real people, including you.",

  // ── Parent controls ───────────────────────────────────────────────────────
  "controls.paused.title": "Your account is paused",
  "controls.paused.body":
    "A parent or carer has paused your account for now. Your work is safe. Talk to them about when it will be switched back on.",
  "controls.time_cap.title": "That's your time for today",
  "controls.time_cap.body":
    "You've reached today's limit of {{minutes}} minutes. Your progress is saved. Come back tomorrow.",
  "controls.time_cap.warning":
    "About {{minutes}} minutes left today. Now is a good moment to save your place.",
  "controls.quiet_hours.title": "It's quiet time",
  "controls.quiet_hours.body":
    "Learning is switched off until {{until}}. Your progress is saved, and it will all be here when you're back.",

  // ── Reporting and safety ──────────────────────────────────────────────────
  "report.action": "Report a problem",
  "report.thanks": "Thanks for telling us. A person on our team will look at this.",
  "report.danger.help":
    "If you or someone else is in danger right now, call 999. You can talk to Childline free on 0800 1111, any time.",

  // ── Saving ────────────────────────────────────────────────────────────────
  "save.saving": "Saving…",
  "save.saved": "Saved",
  "save.failed":
    "We couldn't save that. Check your connection and try again. We've kept what you typed on this screen.",
  // ── Billing: shown to parents, carers and adult account owners only ───────
  "billing.card_check.why":
    "The law expects us to take reasonable steps to check that an adult is behind a younger teenager's account. For 13 to 15-year-olds we do that with a card check, because only an adult can hold a bank card.",
  "billing.card_check.what":
    "Stripe, the company that handles cards for us, confirms that your card is real. No money is taken. We never see or store your card number, and your child never sees this step.",
  "billing.card_check.alternative": "Starting a Family plan does the same job, so you never need to do both.",
  "billing.hosted_by_stripe":
    "You'll finish on a secure page run by Stripe. We never see or store your card details.",
  "billing.nothing_deleted":
    "If a plan ends, nothing is deleted: finished projects, portfolios and certificates are kept, and the free courses stay open.",

  // ── Public site: home page and footer. Honest claims only: no testimonials, numbers or "trusted by". No prices. ──
  "marketing.home.eyebrow": "An online studio for ages 13 to 18",
  "marketing.home.title": "Learn today's AI tools by making things you actually care about",
  "marketing.home.lede":
    "{{brandName}} is where UK teenagers learn AI by doing. Every course is one short project, made in a real tool, with step-by-step guides, an AI coach that gives hints but never does the work, and a parent or carer in the loop.",
  "marketing.home.cta.parent": "Parents: get started",
  "marketing.home.cta.teen": "I'm a teenager",
  "marketing.home.cta.teen_note":
    "Aged 13 to 18? Show this page to a parent or carer, or start a sign-up yourself. Either way, they approve your account before it opens.",
  "marketing.home.signed_in.learner": "You're signed in. Your courses are where you left them.",
  "marketing.home.signed_in.parent": "You're signed in. Your family's dashboard is one click away.",
  "marketing.home.signed_in.staff": "You're signed in as a member of staff.",
  "marketing.home.what.title": "What it is",
  "marketing.home.what.body":
    "Short, self-paced projects: an app, a short film, a chatbot, a design. You follow the steps here and make the real thing in a real tool. You finish with something to keep, in a private portfolio, and a certificate.",
  "marketing.home.who.title": "Who it's for",
  "marketing.home.who.body":
    "Teenagers aged 13 to 18, and the parents and carers who look after them. A parent sets up or approves every under-18 account, chooses the limits and sees progress. It is not for under-13s.",
  "marketing.home.safe.title": "How it's kept safe",
  "marketing.home.safe.body":
    "No public profiles, no messaging and no adverts. Learners cannot see each other. Coach's messages are checked both ways, work is checked before it is accepted, and there is a Report button on every step.",
  "marketing.home.courses.title": "Projects you can make",
  "marketing.home.courses.lede":
    "Real courses from the catalogue. Each one has been reviewed and signed off by a person on our team.",
  "marketing.home.courses.empty":
    "The first courses are being reviewed. Each one is signed off by a person before it appears here.",
  "marketing.cookie_note":
    "We only use the cookies this site needs to work: no advertising and no tracking.",
} as const;

export type CopyKey = keyof typeof EN_GB;

/** The paragraphs of "How safety and outside tools work", in reading order. */
export const SAFETY_HOW_IT_WORKS_KEYS = [
  "safety.how_it_works.private",
  "safety.how_it_works.coach",
  "safety.how_it_works.tools",
  "safety.how_it_works.tools_data",
  "safety.how_it_works.people",
  "safety.how_it_works.controls",
] as const satisfies readonly CopyKey[];

/** "What my parent can see": what a parent sees, and what stays private to the learner. */
export const PARENT_VIEW_SEES_KEYS = [
  "parent_view.sees.progress",
  "parent_view.sees.time",
  "parent_view.sees.projects",
  "parent_view.sees.coach_summary",
  "parent_view.sees.safety",
  "parent_view.sees.requests",
] as const satisfies readonly CopyKey[];
export const PARENT_VIEW_HIDDEN_KEYS = [
  "parent_view.hidden.coach_messages",
  "parent_view.hidden.notes",
  "parent_view.hidden.password",
] as const satisfies readonly CopyKey[];
/** The same two lists, worded for the parent's screens. */
export const PARENT_VIEW_PARENT_SEES_KEYS = [
  "parent_view.parent.sees.progress",
  "parent_view.parent.sees.time",
  "parent_view.parent.sees.projects",
  "parent_view.parent.sees.coach_summary",
  "parent_view.parent.sees.safety",
  "parent_view.parent.sees.requests",
] as const satisfies readonly CopyKey[];
export const PARENT_VIEW_PARENT_HIDDEN_KEYS = [
  "parent_view.parent.hidden.coach_messages",
  "parent_view.parent.hidden.notes",
  "parent_view.parent.hidden.password",
] as const satisfies readonly CopyKey[];
