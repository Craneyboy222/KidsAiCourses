import { and, desc, eq } from "drizzle-orm";
import { env } from "@/env";
import type { Ctx } from "@/server/context";
import { emailTemplate } from "@/server/db";
import { AppError } from "@/server/errors";
import { getSetting } from "@/server/settings/store";
import { renderTemplate, templateVariables, type RenderedEmail, type TemplateData } from "./render";

/**
 * Every email the product sends, with its default wording. All of them are transactional:
 * there is no marketing category and no code path that sends one (spec 3.10).
 *
 * The defaults live here so that a fresh database can send email. An active row in
 * `email_template` (channel `email`) with the same key replaces the subject and body; Studio →
 * Emails edits those rows. Audience and category always come from the code.
 *
 * Bodies are Markdown with `{{variables}}` (see `render.ts`). Every template may also use
 * `{{brandName}}`, `{{appUrl}}` and `{{supportEmail}}`.
 *
 * Wording: plain British English for parents and carers. Say what happened, what (if anything)
 * to do, and how long a link lasts. No exclamation marks and no pressure.
 */
export type EmailAudience = "parent" | "staff" | "adult_learner";
export type EmailCategory = "transactional";

export type EmailTemplateDef = {
  subject: string;
  body: string;
  /** Who it is written for. Under-18 learners are never an audience: they get in-app notifications only. */
  audience: EmailAudience;
  category: EmailCategory;
  /** Shown beside the template in Studio. */
  description: string;
};

const t = (
  audience: EmailAudience,
  description: string,
  subject: string,
  body: string,
): EmailTemplateDef => ({
  subject,
  body: body.trim(),
  audience,
  category: "transactional",
  description,
});

export const EMAIL_TEMPLATES = {
  // ── Account access ────────────────────────────────────────────────────────
  verify_email: t(
    "parent",
    "Confirms the address of a new parent or staff account.",
    "Confirm your email address",
    `
Thanks for setting up an account with {{brandName}}. Please confirm that this is your email address.

[Confirm my email address]({{url}})

The link works for 24 hours. If you didn't create an account, you can ignore this email and nothing will happen.
`,
  ),
  magic_link: t(
    "parent",
    "One-time sign-in link for a parent.",
    "Your sign-in link",
    `
Here is your link to sign in to {{brandName}}.

[Sign in]({{url}})

The link works once and runs out after 10 minutes. If you didn't ask for it, you can ignore this email. Nobody can sign in without the link.
`,
  ),
  password_reset: t(
    "parent",
    "Lets a parent or staff member choose a new password.",
    "Reset your password",
    `
We had a request to reset the password for your {{brandName}} account.

[Choose a new password]({{url}})

The link works for one hour. If you didn't ask for this, you can ignore this email and your password will stay the same.
`,
  ),
  account_locked: t(
    "parent",
    "Sent when repeated wrong passwords briefly lock an account.",
    "Sign-in has been paused for a short time",
    `
Someone entered the wrong password several times for {{accountLabel}}, so we have paused sign-in on that account until about {{lockedUntil}}.

Nothing else has changed, and anyone already signed in can carry on.

- If this was you or your child, wait until then and try again.
- If the password has been forgotten, it can be reset: a child's from your parent dashboard, your own from the sign-in page.
- If you don't recognise this, set a new password to be safe.

[Go to {{brandName}}]({{url}})
`,
  ),
  staff_invite: t(
    "staff",
    "Invites a new member of staff to Studio.",
    "You've been invited to join the {{brandName}} team",
    `
{{inviterName}} has invited you to join the {{brandName}} staff area with these roles: {{roles}}.

[Accept the invitation]({{url}})

The link runs out on {{expiresOn}}. You will be asked to choose a password and to set up two-step sign-in with an authenticator app before you can open Studio.
`,
  ),

  // ── Family set-up ─────────────────────────────────────────────────────────
  parent_approval_request: t(
    "parent",
    "Teen-first sign-up: asks the named parent or carer to approve the account.",
    "A young person has asked you to approve their account",
    `
A young person who gave the nickname **{{nickname}}** would like to use {{brandName}}, a place where 13 to 18 year olds learn to make things with AI tools. They gave this email address as their parent or carer.

Their account can't do anything until an adult with parental responsibility approves it. To approve, you will create your own free parent account, confirm you are 18 or over, and choose their privacy and safety settings.

[Review the request]({{url}})

The request runs out on {{expiresOn}}. If you do nothing, their details are deleted after that date. If you don't know who this is, you can ignore this email.
`,
  ),
  invite_code: t(
    "parent",
    "Gives a parent the code their child uses to set up their own sign-in.",
    "The set-up code for {{childName}}",
    `
You have added {{childName}} to your family on {{brandName}}. To finish, they need to choose their own password.

Give them this code: **{{code}}**

They enter it at [{{url}}]({{url}}). The code works once and runs out on {{expiresOn}}. You can make a new one from your dashboard at any time.

We will never ask your child for a password, code or key belonging to any other website or tool.
`,
  ),
  birthday_transition: t(
    "parent",
    "Tells a parent what changes when a child moves to the next age group.",
    "{{childName}}'s settings are changing",
    `
{{childName}} has moved into a new age group on {{brandName}}, so some of their settings are changing.

{{change}}

You can see and adjust the settings for each child from your dashboard.

[Review the settings]({{url}})
`,
  ),

  // ── Requests that need a parent ───────────────────────────────────────────
  tool_approval_request: t(
    "parent",
    "A child wants to start a course that uses a tool needing parental approval.",
    "{{childName}} needs your approval to use {{toolName}}",
    `
{{childName}} would like to start the course "{{courseTitle}}". It uses a tool called {{toolName}}, which asks for a parent or carer's permission before someone under 18 uses it.

We have checked the tool's terms and listed what it costs, what it collects and how to set it up safely. Please read that summary before you decide.

[Review and decide]({{url}})

Until you decide, {{childName}} can carry on with other courses.
`,
  ),
  unlock_request: t(
    "parent",
    "A child has asked a parent to unlock a course.",
    "{{childName}} has asked to unlock a course",
    `
{{childName}} would like to take the course "{{courseTitle}}", which isn't included in what your family has at the moment.

You can see what the course covers and decide whether to unlock it. Your child never sees prices or payment pages.

[See the request]({{url}})
`,
  ),

  // ── Safety ────────────────────────────────────────────────────────────────
  safety_notice: t(
    "parent",
    "An immediate safety notice about a child's account.",
    "A safety notice about {{childName}}'s account",
    `
We are getting in touch about {{childName}}'s account on {{brandName}}.

{{summary}}

You can read the full notice, and what we have done, in your dashboard.

[Open the notice]({{url}})

If you are worried that a child is in immediate danger, call 999.
`,
  ),
  course_take_down: t(
    "parent",
    "A course a child was taking has been withdrawn.",
    "A course {{childName}} was taking has been withdrawn",
    `
We have withdrawn the course "{{courseTitle}}" while we look into a problem with it. {{reason}}

{{childName}}'s work and progress are kept, and nothing is needed from you. We will let you know if the course comes back.

[See {{childName}}'s courses]({{url}})
`,
  ),

  // ── Data rights and retention ─────────────────────────────────────────────
  data_export_ready: t(
    "parent",
    "A requested copy of the family's data is ready to download.",
    "Your data export is ready",
    `
The copy of your data that you asked for is ready.

[Download my data]({{url}})

For your security you will be asked to sign in first. The download is available until {{expiresOn}}; after that, you can ask for a new one.
`,
  ),
  deletion_scheduled: t(
    "parent",
    "Confirms a deletion request and the date it takes effect.",
    "Deletion is scheduled for {{deleteOn}}",
    `
We have received the request to delete {{accountLabel}}.

Everything will be permanently deleted on **{{deleteOn}}**. Until then the account is closed to sign-in, and you can change your mind.

[Cancel the deletion]({{url}})

After that date it can't be undone. Records we must keep by law, such as payment records, are kept only for as long as the law requires.
`,
  ),
  deletion_completed: t(
    "parent",
    "Confirms that an account has been deleted.",
    "The account has been deleted",
    `
As requested, we have permanently deleted {{accountLabel}} from {{brandName}}.

This is the last email you will get from us about that account. If you think this was a mistake, reply to this email as soon as you can.
`,
  ),
  inactivity_warning: t(
    "parent",
    "Warns that an unused account will be deleted in 30 days.",
    "An account will be deleted on {{deleteOn}} unless it is used",
    `
Nobody has used {{accountLabel}} for a long time. We don't keep children's data for longer than we need to, so the account and everything in it will be deleted on **{{deleteOn}}**.

To keep it, sign in before that date. To keep a copy of the work first, you can download it from your dashboard.

[Go to my dashboard]({{url}})

If you no longer want the account, you don't need to do anything.
`,
  ),

  // ── Staff ─────────────────────────────────────────────────────────────────
  safeguarding_alert: t(
    "staff",
    "Immediate alert to the DSL when a safeguarding case opens. Carries no detail about the child.",
    "Safeguarding alert: {{severity}} case needs you",
    `
A **{{severity}}** safeguarding case has been opened ({{caseRef}}). Please acknowledge it by {{dueBy}}.

For the child's privacy this email contains no details. Sign in to read the case; opening the notes asks for a reason and is logged.

[Open the case]({{url}})
`,
  ),
  spend_cap_alert: t(
    "staff",
    "AI spend has reached a warning level or the cap.",
    "AI spend alert: {{feature}} is at {{percent}}% of today's cap",
    `
Spending on {{feature}} has reached {{spent}} of today's cap of {{cap}} ({{percent}}%).

At 100% the kill switch turns that feature off until tomorrow. Lessons and everything that doesn't use AI keep working.

[Review AI settings]({{url}})
`,
  ),
  radar_digest: t(
    "staff",
    "Summary of new Tool Radar candidates and drafts waiting for review.",
    "Tool Radar: {{count}} new for review",
    `
Tool Radar has {{count}} new items waiting for a person to look at.

{{summary}}

Nothing is published until a reviewer approves it.

[Open the review queue]({{url}})
`,
  ),
  tool_change_alert: t(
    "staff",
    "A registered tool's terms, age rules, pricing or cited pages have changed.",
    "Tool change: {{toolName}} ({{impact}})",
    `
We spotted a change on a page we watch for **{{toolName}}**. Likely impact: {{impact}}.

Courses affected: {{affectedCourses}}.

Guides that cite the page have been marked as out of date. If the change tightens the tool's age rules, new learners can't start those courses until someone has looked at it.

[Review the change]({{url}})
`,
  ),
} as const satisfies Record<string, EmailTemplateDef>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

/**
 * Templates added by other modules at start-up. Use this instead of editing the list above when
 * the email belongs to your own feature:
 *
 *   registerEmailTemplate("certificate_issued", { subject, body, audience: "parent", category: "transactional", description });
 */
const globalForTemplates = globalThis as typeof globalThis & {
  __platformEmailTemplates?: Map<string, EmailTemplateDef>;
};
const registered = (globalForTemplates.__platformEmailTemplates ??= new Map<string, EmailTemplateDef>());

export function registerEmailTemplate(key: string, definition: EmailTemplateDef): void {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(key))
    throw new Error(`Email template key "${key}" must be lower_snake_case`);
  if (key in EMAIL_TEMPLATES)
    throw new Error(`Email template "${key}" already exists as a built-in template`);
  if ((definition.category as string) !== "transactional")
    throw new Error("Only transactional email templates can be registered");
  registered.set(key, { ...definition, body: definition.body.trim() });
}

/** The code default for a key, or `undefined` if nothing in code defines it. */
export function defaultEmailTemplate(key: string): EmailTemplateDef | undefined {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, key)
    ? EMAIL_TEMPLATES[key as EmailTemplateKey]
    : registered.get(key);
}

/** Every template key known to the code, built-in first. */
export function emailTemplateKeys(): string[] {
  return [...Object.keys(EMAIL_TEMPLATES), ...registered.keys()];
}

export type EffectiveEmailTemplate = EmailTemplateDef & {
  key: string;
  source: "default" | "override";
  /** Version of the `email_template` row in use, when there is one. */
  version: number | null;
  variables: string[];
};

/**
 * The template that will actually be sent: the active `email_template` row if there is one,
 * otherwise the code default. A key that no code defines cannot be sent, even if a row exists,
 * because the audience and category rules live in code.
 */
export async function getEmailTemplate(ctx: Pick<Ctx, "db">, key: string): Promise<EffectiveEmailTemplate> {
  const fallback = defaultEmailTemplate(key);
  if (!fallback) throw new AppError("not_found", "That email template doesn't exist.", { detail: { key } });
  const [row] = await ctx.db
    .select({ subject: emailTemplate.subject, body: emailTemplate.body, version: emailTemplate.version })
    .from(emailTemplate)
    .where(
      and(eq(emailTemplate.key, key), eq(emailTemplate.channel, "email"), eq(emailTemplate.active, true)),
    )
    .orderBy(desc(emailTemplate.version))
    .limit(1);
  const chosen = row
    ? { subject: row.subject, body: row.body }
    : { subject: fallback.subject, body: fallback.body };
  return {
    ...fallback,
    ...chosen,
    key,
    source: row ? "override" : "default",
    version: row?.version ?? null,
    variables: templateVariables(chosen.subject, chosen.body),
  };
}

const FOOTERS: Record<EmailAudience, string> = {
  parent:
    "You are receiving this email because you have, or have been asked to approve, a parent or carer account with {brand}. It is a service message about that account, not marketing.",
  staff: "You are receiving this email because you are a member of the {brand} team.",
  adult_learner:
    "You are receiving this email because you are 18 or over and have an account with {brand}. It is a service message about your account, not marketing.",
};

/** Subject, HTML and plain text for a template, using the Studio override when one is active. */
export async function renderEmail(
  ctx: Pick<Ctx, "db">,
  key: string,
  data: TemplateData = {},
): Promise<RenderedEmail> {
  const template = await getEmailTemplate(ctx, key);
  const [displayName, supportEmail] = await Promise.all([
    getSetting(ctx, "site.brand_display_name"),
    getSetting(ctx, "site.support_email"),
  ]);
  const brandName = displayName?.trim() || env.NEXT_PUBLIC_BRAND_NAME;
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const support = supportEmail ? ` If you need help, email ${supportEmail}.` : "";
  return renderTemplate(
    template,
    { brandName, appUrl, supportEmail: supportEmail ?? "", ...data },
    { brandName, appUrl, footer: `${FOOTERS[template.audience].replace("{brand}", brandName)}${support}` },
  );
}
