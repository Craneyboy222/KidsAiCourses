import { eq } from "drizzle-orm";
import { env } from "@/env";
import { isLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import type { Ctx } from "@/server/context";
import { learnerProfile, user } from "@/server/db";
import { AppError } from "@/server/errors";
import { logInfo } from "@/server/log";
import { ageFromBirth, safetyBandForAge, stricterBand } from "@/server/services/age";
import type { TemplateData } from "./render";
import { getEmailTemplate, renderEmail } from "./templates";
import { getEmailTransport, maskEmail, type EmailSendResult } from "./transport";

/**
 * The only way the product sends an email.
 *
 * Hard rules, enforced here whatever the caller intended (spec 3.10):
 * 1. Nothing is ever sent to an address ending `.invalid` or to a learner's placeholder address.
 * 2. Under-18 learners never receive email. They are told things in the app. A learner may be
 *    emailed only once they are 18 (`adult_18`), on the cautious reading of their age.
 * 3. Only transactional templates exist. There is no marketing send path at all.
 */
export type EmailRefusalReason = "invalid_address" | "undeliverable_address" | "learner_placeholder" | "under_18_learner" | "unknown_user" | "not_transactional";

export class EmailRefusedError extends AppError {
  readonly reason: EmailRefusalReason;
  constructor(reason: EmailRefusalReason, message: string) {
    super("forbidden", message, { detail: { emailRefused: reason } });
    this.name = "EmailRefusedError";
    this.reason = reason;
  }
}

export type SendEmailInput = {
  to: string;
  /** A key from `EMAIL_TEMPLATES`, or one added with `registerEmailTemplate`. */
  template: string;
  data?: TemplateData;
  /** The recipient's user id when they have an account. Always pass it when you know it. */
  userId?: string;
};

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** Pure: is this an address we may ever send to? Returns the reason when not. */
export function addressRefusal(address: string): EmailRefusalReason | null {
  const to = address.trim().toLowerCase();
  if (isLearnerPlaceholderEmail(to)) return "learner_placeholder";
  // RFC 2606 reserves `.invalid`: it can never be delivered, and here it always marks an internal placeholder.
  if (to.endsWith(".invalid") || to.endsWith(".invalid.")) return "undeliverable_address";
  if (to.length > 254 || !ADDRESS.test(to)) return "invalid_address";
  return null;
}

const REFUSAL_MESSAGES: Record<EmailRefusalReason, string> = {
  invalid_address: "That email address doesn't look right, so nothing was sent.",
  undeliverable_address: "That address can't receive email, so nothing was sent.",
  learner_placeholder: "Learner accounts don't have an email address, so nothing was sent.",
  under_18_learner: "We don't send email to learners under 18. They will see this in the app instead.",
  unknown_user: "That account couldn't be found, so nothing was sent.",
  not_transactional: "Only service emails can be sent.",
};
const refuse = (reason: EmailRefusalReason) => new EmailRefusedError(reason, REFUSAL_MESSAGES[reason]);

type Recipient = { id: string; kind: string; birthYear: number | null; birthMonth: number | null; storedBand: "teen_13_15" | "teen_16_17" | "adult_18" | null };

/** True only for a learner who is certainly 18 or over: both the stored band and today's calculation must agree. */
function isAdultLearner(recipient: Recipient, now: Date): boolean {
  if (recipient.birthYear === null || recipient.birthMonth === null || recipient.storedBand === null) return false;
  const live = safetyBandForAge(ageFromBirth(recipient.birthYear, recipient.birthMonth, now));
  return live !== null && stricterBand(live, recipient.storedBand) === "adult_18";
}

async function findRecipient(ctx: Pick<Ctx, "db">, where: { userId: string } | { email: string }): Promise<Recipient | undefined> {
  const rows = await ctx.db
    .select({ id: user.id, kind: user.kind, birthYear: learnerProfile.birthYear, birthMonth: learnerProfile.birthMonth, storedBand: learnerProfile.safetyBand })
    .from(user)
    .leftJoin(learnerProfile, eq(learnerProfile.userId, user.id))
    .where("userId" in where ? eq(user.id, where.userId) : eq(user.email, where.email))
    .limit(1);
  return rows[0];
}

/**
 * Renders a template and sends it. Throws `EmailRefusedError` when a hard rule forbids the send,
 * and an ordinary error when the provider fails (callers decide whether that is fatal).
 */
export async function sendEmail(ctx: Pick<Ctx, "db" | "now">, input: SendEmailInput): Promise<EmailSendResult> {
  const to = input.to.trim();
  const badAddress = addressRefusal(to);
  if (badAddress) throw refuse(badAddress);

  // Look the recipient up by id when given, and by address otherwise, so that an under-18 can never
  // be reached just because a caller left `userId` out.
  const recipient = input.userId ? await findRecipient(ctx, { userId: input.userId }) : await findRecipient(ctx, { email: to.toLowerCase() });
  if (input.userId && !recipient) throw refuse("unknown_user");
  // Any account that is not plainly a parent or staff is treated as a learner: deny by default.
  if (recipient && recipient.kind !== "parent" && recipient.kind !== "staff" && !isAdultLearner(recipient, ctx.now)) {
    throw refuse("under_18_learner");
  }

  const template = await getEmailTemplate(ctx, input.template);
  if ((template.category as string) !== "transactional") throw refuse("not_transactional");

  const rendered = await renderEmail(ctx, input.template, input.data ?? {});
  const result = await getEmailTransport().send({
    to,
    from: env.EMAIL_FROM,
    ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    template: input.template,
  });
  logInfo("email.sent", { template: input.template, to: maskEmail(to), provider: result.provider, userId: recipient?.id ?? null });
  return result;
}
