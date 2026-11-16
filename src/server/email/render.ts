/**
 * Turns a template (subject + a small, safe subset of Markdown with `{{variables}}`) into an
 * email: subject, accessible HTML and plain text. Pure functions: no database, no environment.
 *
 * Safety rules:
 * - Template text and every variable are HTML-escaped. A variable can never add markup.
 * - Markdown is read from the template only, before variables are filled in, so a value such as
 *   a child's nickname cannot turn itself into a link or bold text.
 * - Links must be `https:`, `http:`, `mailto:` or a path on our own site; anything else is shown
 *   as plain text.
 *
 * Supported Markdown: paragraphs, `# heading`, `- list`, `1. list`, `> note`, `**bold**` and
 * `[label](url)`. A paragraph that is only a link becomes the email's button.
 */
export type TemplateData = Record<string, string | number | null | undefined>;

export type RenderOptions = {
  brandName: string;
  /** Site origin, e.g. `https://example.org`. Paths in links are resolved against it. */
  appUrl: string;
  /** One or two plain sentences saying why the person is receiving the email. */
  footer: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const ONLY_LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Names of the `{{variables}}` a template uses. */
export function templateVariables(...parts: string[]): string[] {
  const names = new Set<string>();
  for (const part of parts) for (const match of part.matchAll(PLACEHOLDER)) if (match[1]) names.add(match[1]);
  return [...names];
}

// Strips characters that could break out of a header or hide text: C0/C1 controls and bidi overrides.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

function valueOf(data: TemplateData, name: string): string {
  const value = data[name];
  return value === null || value === undefined ? "" : String(value).replace(UNSAFE_CHARS, "");
}

function fillRaw(template: string, data: TemplateData): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => valueOf(data, name));
}

/** An absolute, safe URL, or `null` when the link must not be made clickable. */
export function safeHref(raw: string, appUrl: string): string | null {
  const value = raw.trim().replace(/[\u0000-\u0020\u007F]/g, (c) => (c === " " ? "%20" : ""));
  if (value === "") return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return `${appUrl.replace(/\/+$/, "")}${value}`.replace(/[{}]/g, (c) => (c === "{" ? "%7B" : "%7D"));
  }
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  return value.replace(/[{}]/g, (c) => (c === "{" ? "%7B" : "%7D"));
}

const LINK_STYLE = "color:#1d4ed8;text-decoration:underline";
const BUTTON_STYLE =
  "display:inline-block;background:#1d4ed8;color:#ffffff;font-weight:bold;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:16px;line-height:1.25";

function inlineText(template: string, data: TemplateData): string {
  const escaped = escapeHtml(template).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return escaped.replace(PLACEHOLDER, (_match, name: string) => escapeHtml(valueOf(data, name)));
}

function inlineHtml(template: string, data: TemplateData, options: RenderOptions): string {
  let out = "";
  let last = 0;
  for (const match of template.matchAll(LINK)) {
    const index = match.index ?? 0;
    out += inlineText(template.slice(last, index), data);
    const href = safeHref(fillRaw(match[2] ?? "", data), options.appUrl);
    const label = inlineText(match[1] ?? "", data);
    out += href ? `<a href="${escapeHtml(href)}" style="${LINK_STYLE}">${label}</a>` : label;
    last = index + match[0].length;
  }
  return out + inlineText(template.slice(last), data);
}

function inlinePlain(template: string, data: TemplateData, options: RenderOptions): string {
  const withLinks = template.replace(LINK, (_match, label: string, url: string) => {
    const href = safeHref(fillRaw(url, data), options.appUrl);
    const text = fillRaw(label, data);
    if (!href) return text;
    return text === href ? href : `${text}: ${href}`;
  });
  return fillRaw(withLinks.replace(/\*\*([^*\n]+)\*\*/g, "$1"), data);
}

const P = "margin:0 0 16px 0";

function blockHtml(block: string, data: TemplateData, options: RenderOptions): string {
  const lines = block.split("\n");
  const first = lines[0] ?? "";
  const heading = /^(#{1,3})\s+(.*)$/.exec(first);
  if (heading && lines.length === 1) {
    return `<h2 style="font-size:18px;line-height:1.3;margin:24px 0 12px 0">${inlineHtml(heading[2] ?? "", data, options)}</h2>`;
  }
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines
      .map((l) => `<li style="margin:0 0 8px 0">${inlineHtml(l.replace(/^[-*]\s+/, ""), data, options)}</li>`)
      .join("");
    return `<ul style="margin:0 0 16px 0;padding-left:24px">${items}</ul>`;
  }
  if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
    const items = lines
      .map(
        (l) => `<li style="margin:0 0 8px 0">${inlineHtml(l.replace(/^\d+[.)]\s+/, ""), data, options)}</li>`,
      )
      .join("");
    return `<ol style="margin:0 0 16px 0;padding-left:24px">${items}</ol>`;
  }
  if (lines.every((l) => /^>\s?/.test(l))) {
    const inner = lines.map((l) => inlineHtml(l.replace(/^>\s?/, ""), data, options)).join("<br>");
    return `<p style="${P};padding:12px 16px;border-left:4px solid #1d4ed8;background:#eef2ff">${inner}</p>`;
  }
  const only = ONLY_LINK.exec(block.trim());
  if (only) {
    const href = safeHref(fillRaw(only[2] ?? "", data), options.appUrl);
    const label = inlineText(only[1] ?? "", data);
    if (href)
      return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="${BUTTON_STYLE}">${label}</a></p>`;
  }
  return `<p style="${P}">${lines.map((l) => inlineHtml(l, data, options)).join("<br>")}</p>`;
}

function blockPlain(block: string, data: TemplateData, options: RenderOptions): string {
  return block
    .split("\n")
    .map((line) => inlinePlain(line.replace(/^#{1,3}\s+/, "").replace(/^>\s?/, ""), data, options))
    .join("\n");
}

function blocksOf(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/** A single line with no control characters: safe as an email subject. */
export function renderSubject(subject: string, data: TemplateData): string {
  return fillRaw(subject, data).replace(/\s+/g, " ").trim().slice(0, 200);
}

export function renderBodyHtml(body: string, data: TemplateData, options: RenderOptions): string {
  return blocksOf(body)
    .map((b) => blockHtml(b, data, options))
    .join("\n");
}

export function renderBodyText(body: string, data: TemplateData, options: RenderOptions): string {
  return blocksOf(body)
    .map((b) => blockPlain(b, data, options))
    .join("\n\n");
}

/** The plain wrapper every email shares: one column, real text, system fonts, no images and no tracking. */
export function wrapHtml(subject: string, bodyHtml: string, options: RenderOptions): string {
  const brand = escapeHtml(options.brandName);
  const title = escapeHtml(subject);
  return `<!doctype html>
<html lang="en-GB" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;color:#1a1a2e;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;text-align:left">
<tr><td style="padding:32px 28px 16px 28px">
<p style="margin:0 0 16px 0;font-size:14px;font-weight:bold;color:#4a4a5e">${brand}</p>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 20px 0;color:#1a1a2e">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid #d9d9e3;font-size:14px;line-height:1.5;color:#4a4a5e">${escapeHtml(options.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Subject, HTML and text for one template and one set of values. Throws if the template uses a variable that was not supplied. */
export function renderTemplate(
  template: { subject: string; body: string },
  data: TemplateData,
  options: RenderOptions,
): RenderedEmail {
  const missing = templateVariables(template.subject, template.body).filter(
    (name) => data[name] === undefined || data[name] === null,
  );
  if (missing.length > 0) {
    throw new Error(`Email template is missing values for: ${missing.join(", ")}`);
  }
  const subject = renderSubject(template.subject, data);
  const html = wrapHtml(subject, renderBodyHtml(template.body, data, options), options);
  const text = `${renderBodyText(template.body, data, options)}\n\n--\n${options.footer}\n`;
  return { subject, html, text };
}
