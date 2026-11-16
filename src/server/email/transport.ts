import { env } from "@/env";
import { logInfo } from "@/server/log";

/**
 * Email delivery behind one small interface, so the app runs with no email account (`console`)
 * and can use Resend or Postmark once the owner has approved the provider and recorded its DPA.
 * The providers are called with plain `fetch`: no SDK, nothing else to audit.
 */
export type EmailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** The template key, for provider-side tagging and for tests. */
  template?: string;
};

export type EmailSendResult = { provider: EmailProviderName; id: string | null };
export type EmailProviderName = "console" | "resend" | "postmark";

export interface EmailTransport {
  readonly name: EmailProviderName;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

type FetchLike = typeof fetch;
const SEND_TIMEOUT_MS = 10_000;

// ── Console (default) ───────────────────────────────────────────────────────

export type SentEmail = EmailMessage & { at: Date };
const KEEP_LAST = 50;
const globalForEmail = globalThis as typeof globalThis & { __platformSentEmails?: SentEmail[]; __platformEmailTransport?: EmailTransport };
const sent = (globalForEmail.__platformSentEmails ??= []);

/** The most recent messages handed to the console transport, oldest first. For tests and local development. */
export function getSentEmails(): SentEmail[] {
  return [...sent];
}
export function clearSentEmails(): void {
  sent.length = 0;
}

/** `p***@example.test`: enough to recognise in a log, not enough to identify. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

function linksIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s)>\]]+/g) ?? [])];
}

export const consoleTransport: EmailTransport = {
  name: "console",
  async send(message) {
    if (env.APP_ENV === "production") {
      // Sign-in links must never be written to production logs, and an email that is only logged is an email not sent.
      throw new Error("EMAIL_PROVIDER=console cannot send email in production. Configure an approved provider.");
    }
    sent.push({ ...message, at: new Date() });
    if (sent.length > KEEP_LAST) sent.splice(0, sent.length - KEEP_LAST);
    logInfo("email.console", {
      template: message.template ?? null,
      to: maskEmail(message.to),
      subject: message.subject,
      // Only on a developer's own machine: lets sign-up and password reset be finished without a mailbox.
      ...(env.APP_ENV === "local" ? { links: linksIn(message.text) } : {}),
    });
    return { provider: "console", id: null };
  },
};

// ── Resend ──────────────────────────────────────────────────────────────────

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    // The provider's reply can echo the recipient's address, so only the status is kept.
    throw new Error(`${provider} refused the email (HTTP ${response.status})`);
  }
  return response.json().catch(() => ({}));
}

function requireApiKey(provider: string): string {
  const apiKey = env.EMAIL_API_KEY;
  if (!apiKey) throw new Error(`EMAIL_PROVIDER=${provider} needs EMAIL_API_KEY`);
  return apiKey;
}

/** https://resend.com/docs/api-reference/emails/send-email. Use a sending domain in an EU region. */
export function resendTransport(fetchImpl: FetchLike = fetch): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      const data = await postJson(
        fetchImpl,
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${requireApiKey("resend")}` },
        {
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.template ? { tags: [{ name: "template", value: message.template.replace(/[^A-Za-z0-9_-]/g, "_") }] } : {}),
        },
        "Resend",
      );
      const id = typeof data === "object" && data !== null && "id" in data ? String((data as { id: unknown }).id) : null;
      return { provider: "resend", id };
    },
  };
}

// ── Postmark ────────────────────────────────────────────────────────────────

/** https://postmarkapp.com/developer/api/email-api. Transactional stream only: there is no broadcast stream in this product. */
export function postmarkTransport(fetchImpl: FetchLike = fetch): EmailTransport {
  return {
    name: "postmark",
    async send(message) {
      const data = await postJson(
        fetchImpl,
        "https://api.postmarkapp.com/email",
        { "X-Postmark-Server-Token": requireApiKey("postmark") },
        {
          From: message.from,
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
          MessageStream: "outbound",
          // Open and click tracking would add tracking pixels and rewritten links. Neither is wanted.
          TrackOpens: false,
          TrackLinks: "None",
          ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
          ...(message.template ? { Tag: message.template } : {}),
        },
        "Postmark",
      );
      const id = typeof data === "object" && data !== null && "MessageID" in data ? String((data as { MessageID: unknown }).MessageID) : null;
      return { provider: "postmark", id };
    },
  };
}

// ── Selection ───────────────────────────────────────────────────────────────

/** The transport chosen by `EMAIL_PROVIDER`. */
export function getEmailTransport(): EmailTransport {
  if (globalForEmail.__platformEmailTransport) return globalForEmail.__platformEmailTransport;
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      return resendTransport();
    case "postmark":
      return postmarkTransport();
    default:
      return consoleTransport;
  }
}

/** Test helper: force a transport, or pass `undefined` to go back to `EMAIL_PROVIDER`. */
export function setEmailTransport(transport: EmailTransport | undefined): void {
  globalForEmail.__platformEmailTransport = transport;
}
