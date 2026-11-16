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
} as const;

export type CopyKey = keyof typeof EN_GB;
