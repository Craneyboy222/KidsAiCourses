/**
 * The crisis pathway (spec 3.5 and Section 9, "DSL workflow").
 *
 * When a learner's message signals self-harm, abuse, exploitation, grooming or immediate danger,
 * Coach shows a FIXED, approved script with UK signposting. The script is data
 * (`content/prompts/crisis-script.v1.md`), never model output: no model is called on a crisis
 * turn and no credits are charged. A safeguarding case is opened in the background so that the
 * script is never delayed, and a failure to open it is retried and logged loudly, never shown
 * to the learner.
 */
import { parsePromptFile, readPromptFile } from "./prompt-files";

export const CRISIS_SCRIPT_VERSION = "crisis-script.v1";

export type CrisisContact = {
  name: string;
  action: "call" | "text";
  /** What the learner sees, e.g. "0800 1111" or "Text SHOUT to 85258". */
  display: string;
  /** A `tel:` or `sms:` link so the number can be tapped. */
  href: string;
  detail: string;
};

export type CrisisScript = {
  version: string;
  title: string;
  body: string[];
  contacts: CrisisContact[];
  emergency: { text: string; contact: CrisisContact };
  closing: string;
};

/** What the script must always contain (spec 3.5). Checked every time it is loaded. */
const REQUIRED: Array<{ what: string; test: (script: CrisisScript, text: string) => boolean }> = [
  { what: "Childline 0800 1111", test: (_s, t) => /Childline/.test(t) && /0800 1111/.test(t) },
  { what: "Samaritans 116 123", test: (_s, t) => /Samaritans/.test(t) && /116 123/.test(t) },
  { what: "Shout: text SHOUT to 85258", test: (_s, t) => /SHOUT to 85258/.test(t) },
  { what: "999 for immediate danger", test: (_s, t) => /\b999\b/.test(t) && /danger/i.test(t) },
  { what: "talking to a trusted adult", test: (_s, t) => /adult you trust|trusted adult/i.test(t) },
  { what: "tappable links for every contact", test: (s) => [...s.contacts, s.emergency.contact].every((c) => /^(tel|sms):/.test(c.href)) },
];

/**
 * The last line of defence: if the data file is missing or fails its checks, this is shown
 * instead, so a learner in crisis never sees an error. Keep it in step with the file.
 */
export const FALLBACK_CRISIS_SCRIPT: CrisisScript = {
  version: `${CRISIS_SCRIPT_VERSION}+fallback`,
  title: "Thank you for telling me",
  body: [
    "What you've said matters, and it sounds really hard. You deserve proper support from a real person, and I'm an AI, so I'm not the right one to help with this.",
    "Please talk to an adult you trust as soon as you can. That could be a parent or carer, a teacher, or someone else in your family. You can just show them this message.",
    "You can also talk to someone right now. These are free:",
  ],
  contacts: [
    { name: "Childline", action: "call", display: "0800 1111", href: "tel:08001111", detail: "Free, any time, for anyone under 19." },
    { name: "Samaritans", action: "call", display: "116 123", href: "tel:116123", detail: "Free, any time, day or night." },
    { name: "Shout", action: "text", display: "Text SHOUT to 85258", href: "sms:85258?body=SHOUT", detail: "Free text support, any time." },
  ],
  emergency: {
    text: "If you or someone else is in danger right now, call 999.",
    contact: { name: "Emergency services", action: "call", display: "999", href: "tel:999", detail: "For immediate danger." },
  },
  closing: "You've done the right thing by saying something. Someone on our safety team will also be told, so that a person can check you're okay. You're not in trouble.",
};

function parseContacts(block: string): CrisisContact[] {
  const contacts: CrisisContact[] = [];
  let current: Record<string, string> | null = null;
  const flush = (): void => {
    if (!current) return;
    const { name, action, display, href, detail } = current;
    if (name && display && href && (action === "call" || action === "text")) {
      contacts.push({ name, action, display, href, detail: detail ?? "" });
    }
    current = null;
  };
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const start = line.match(/^- (\w+):\s*(.*)$/);
    const more = line.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (start) {
      flush();
      current = { [start[1] ?? ""]: start[2] ?? "" };
    } else if (more && current) {
      current[more[1] ?? ""] = more[2] ?? "";
    }
  }
  flush();
  return contacts;
}

/** Turns the Markdown data file into the structure the UI renders. Throws if a required part is missing. */
export function parseCrisisScript(raw: string): CrisisScript {
  const { meta, body } = parsePromptFile(raw);
  const sections = new Map<string, string>();
  for (const chunk of body.split(/^## /m).slice(1)) {
    const newline = chunk.indexOf("\n");
    sections.set(chunk.slice(0, newline === -1 ? undefined : newline).trim(), newline === -1 ? "" : chunk.slice(newline + 1).trim());
  }
  const paragraphs = (text: string): string[] => text.split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const emergencyBlock = sections.get("emergency") ?? "";
  const emergencyText = paragraphs(emergencyBlock.split(/^- /m)[0] ?? "")[0] ?? "";
  const emergencyContact = parseContacts(emergencyBlock)[0];
  if (!emergencyContact) throw new Error("Crisis script: the emergency contact is missing");
  const script: CrisisScript = {
    version: `crisis-script.v${meta.version ?? "1"}`,
    title: (sections.get("title") ?? "").trim(),
    body: paragraphs(sections.get("body") ?? ""),
    contacts: parseContacts(sections.get("contacts") ?? ""),
    emergency: { text: emergencyText, contact: emergencyContact },
    closing: paragraphs(sections.get("closing") ?? "").join(" "),
  };
  assertCrisisScript(script);
  return script;
}

/** Throws unless the script has every required signpost. */
export function assertCrisisScript(script: CrisisScript): void {
  const text = renderCrisisText(script);
  if (!script.title || script.body.length === 0 || script.contacts.length < 3) throw new Error("Crisis script: title, body or contacts missing");
  const missing = REQUIRED.filter((item) => !item.test(script, text)).map((item) => item.what);
  if (missing.length > 0) throw new Error(`Crisis script is missing: ${missing.join("; ")}`);
}

/** The script as plain text, for clients that cannot render the panel and for the eval graders. */
export function renderCrisisText(script: CrisisScript): string {
  const line = (c: CrisisContact): string => `${c.name}: ${c.display}${c.detail ? ` — ${c.detail}` : ""}`;
  return [script.title, ...script.body, ...script.contacts.map(line), script.emergency.text, script.closing].join("\n\n");
}

let loaded: CrisisScript | undefined;

/**
 * The approved script. Never throws: if the data file cannot be read or fails its checks, the
 * built-in fallback is returned and `onError` is told, so the fault is loud but the learner is safe.
 */
export function getCrisisScript(onError?: (error: unknown) => void): CrisisScript {
  if (loaded) return loaded;
  try {
    const file = readPromptFile("crisis-script.v1");
    loaded = parseCrisisScript(`---\nversion: ${file.meta.version ?? "1"}\n---\n${file.body}`);
    return loaded;
  } catch (error) {
    onError?.(error);
    return FALLBACK_CRISIS_SCRIPT;
  }
}

export type OpenCaseOutcome = { caseId: string; attempts: number } | { caseId: null; attempts: number; error: unknown };

/**
 * Opens the safeguarding case, retrying with a growing pause. It never throws. Each failure is
 * reported through `onFailure` (logged at error level by the pipeline); after the last attempt
 * the caller is told `caseId: null` and must raise the alarm some other way.
 */
export async function openCaseWithRetry(
  open: () => Promise<{ caseId: string }>,
  options: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onFailure?: (error: unknown, attempt: number) => void } = {},
): Promise<OpenCaseOutcome> {
  const attempts = options.attempts ?? 4;
  const delays = options.delaysMs ?? [250, 1000, 4000];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { caseId } = await open();
      if (typeof caseId === "string" && caseId.length > 0) return { caseId, attempts: attempt };
      throw new Error("openSafeguardingCase returned no case id");
    } catch (error) {
      lastError = error;
      options.onFailure?.(error, attempt);
      if (attempt < attempts) await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 1000);
    }
  }
  return { caseId: null, attempts, error: lastError };
}
