/**
 * Stage 5 of the Coach pipeline (spec Section 8): input sanitisation.
 *
 * Two jobs, both pure and local (no network, no clock, no database):
 *  1. REFUSE anything that looks like a password, API key, one-time code or card details. The
 *     text goes no further: it is not sent to a model, not stored and not logged.
 *  2. STRIP personal data from everything else, and say what was taken out so the learner can be told.
 *
 * It leans towards caution. A false alarm costs the learner one retyped message; a miss could send
 * a child's phone number or a parent's card number to a model provider.
 */

export type SecretKind = "password" | "api_key" | "one_time_code" | "card";

export type RedactionKind =
  | "email"
  | "phone"
  | "postcode"
  | "address"
  | "date_of_birth"
  | "handle"
  | "name"
  | "number";

export type RedactionCount = { kind: RedactionKind; count: number };

export type RedactResult =
  | {
      refused: true;
      secret: SecretKind;
      /** Safe to show a teenager. Never contains the secret. */
      message: string;
    }
  | {
      refused: false;
      /** The text with personal data replaced by neutral placeholders. */
      text: string;
      redactions: RedactionCount[];
      /** One line for the learner saying what was removed, or null when nothing was. */
      notice: string | null;
    };

// ───────────────────────────── Secrets (refuse) ─────────────────────────────

const SECRET_MESSAGES: Record<SecretKind, string> = {
  password:
    "That looked like it had a password in it, so I haven't sent it. Coach never needs a password. Take it out and ask again — and if you've shared that password anywhere, it's worth changing it.",
  api_key:
    "That looked like it had an API key or secret token in it, so I haven't sent it. Coach never needs one. Take it out and ask again. If that key is real, treat it as leaked and make a new one.",
  one_time_code:
    "That looked like a one-time code, so I haven't sent it. Coach never needs those, and nobody here will ever ask for one. Take it out and ask again.",
  card: "That looked like card details, so I haven't sent it. Coach never needs payment details. Take them out and ask again, and let a parent or carer know if a site asked you for them.",
};

/** Well-known key prefixes. Each needs enough following characters to be a credible key. */
const KEY_PREFIX_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bhf_[A-Za-z0-9]{20,}/,
  /\br8_[A-Za-z0-9]{20,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JSON Web Token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i,
];

/** "api key: abc123…", "secret = …", "access token is …" followed by something token-like. */
const KEY_LABEL_PATTERN =
  /\b(?:api[\s_-]?key|secret[\s_-]?key|client[\s_-]?secret|access[\s_-]?token|auth[\s_-]?token|private[\s_-]?key|bearer[\s_-]?token|secret|token)\b\s*(?:is|=|:|was)\s*["'`]?([A-Za-z0-9._~+/=-]{12,})/i;

/** `?token=…`, `&key=…` and friends inside a URL. */
const URL_SECRET_PARAM = /[?&](?:token|key|api_?key|secret|password|passwd|pwd|auth|access_token|code|otp)=[^&\s]{6,}/i;

/** "my password is hunter2", "password: abc", "pw = …", "passcode is …". Group 1 is the value. */
const PASSWORD_ASSIGNMENT =
  /\b(?:pass\s?word|passwd|passcode|pass\s?phrase|pwd|pw|(?:my|the|our)\s+pass)\b\s*(?:(?:for|to|on)\s+[\w.@ -]{1,30}?\s*)?(?:is|=|:|was|its|it's)\s*["'`]?(\S{3,})/gi;
/** Words that follow "password is …" in ordinary talk about a password, rather than being one. */
const PASSWORD_TALK =
  /^(?:not|wrong|incorrect|too|being|required|needed|hidden|the|a|an|safe|secure|weak|strong|field|box|input|reset|working|broken|what|something|supposed|showing|invalid|empty|missing|saved|in|on|null|undefined|true|false|string|text|blank|none|optional|visible|there|still|always|never|just|only|really|meant|stored|hashed|encrypted|asking|how|why|where|when|which|this|that|your|my|their|his|her|its)\b/i;
/** Values that are plainly code, not a password: `z.string()`, `req.body.password`, `hash(`, `""`. */
const CODE_VALUE = /^(?:[A-Za-z_$][\w$]*[.(]|["'`]{2}|[<{[])/;

function looksLikePassword(text: string): boolean {
  for (const match of text.matchAll(PASSWORD_ASSIGNMENT)) {
    const value = match[1] ?? "";
    if (PASSWORD_TALK.test(value) || CODE_VALUE.test(value)) continue;
    return true;
  }
  return PASSWORD_PHRASES.some((pattern) => pattern.test(text));
}

const PASSWORD_PHRASES: RegExp[] = [
  // "login is name / secret", "log in with jo@x.com and Secret123"
  /\b(?:log\s?in|sign\s?in|credentials?)\b[^.\n]{0,40}\b(?:and|\/|,)\s*(?:pass\s?word|pw|pass)\b\s*(?:is|=|:)?\s*\S{3,}/i,
  // "here's my password", "use my mum's password"
  /\b(?:here(?:'s| is)|this is|use)\s+(?:my|the|our|mum's|mums|dad's|dads)\s+(?:pass\s?word|passcode|pin)\b\s*:?\s*\S{3,}/i,
  // "my pin is 4821"
  /\b(?:pin|pin\s?code|pin\s?number)\b\s*(?:is|=|:|was)\s*\d{4,8}\b/i,
];

const ONE_TIME_CODE_PATTERNS: RegExp[] = [
  // "the code is 482913", "verification code: 482 913", "otp 482913", "2fa code 482913"
  /\b(?:otp|one[\s-]?time(?:\s+pass)?\s*code|verification\s+code|verify\s+code|security\s+code|auth(?:entication)?\s+code|login\s+code|sign[\s-]?in\s+code|confirmation\s+code|2fa(?:\s+code)?|two[\s-]?factor(?:\s+code)?|passcode|sms\s+code|text\s+code)\b[^.\n\d]{0,25}\d{3}[\s-]?\d{3,5}\b/i,
  // "they texted me a code 482913", "it sent a code: 4829"
  /\b(?:sent|texted|emailed|got|received|gave)\b[^.\n]{0,30}\bcode\b[^.\n\d]{0,15}\d{4,8}\b/i,
  // "code is 482913" / "my code: 482-913"
  /\bcode\b\s*(?:is|=|:|was)\s*\d{3}[\s-]?\d{3,5}\b/i,
];

const CARD_WORDS = /\b(?:cvv2?|cvc2?|security\s+code\s+on\s+the\s+back|card\s+(?:number|no\.?|num|details)|expiry(?:\s+date)?|exp(?:iry)?\s*:|sort\s+code\s+and\s+account|long\s+number\s+on\s+the\s+card)\b/i;

/** Luhn checksum: true for a syntactically valid payment card number. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Runs of digits written as a card would be: 13–19 digits, optionally grouped by spaces or hyphens. */
const CARD_LIKE = /(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g;

function looksLikeCard(text: string): boolean {
  for (const match of text.matchAll(CARD_LIKE)) {
    const digits = match[0].replace(/\D/g, "");
    if (passesLuhn(digits)) return true;
  }
  // "cvv 123", "expiry 04/27", "card number is …" alongside digits.
  if (CARD_WORDS.test(text) && /\d{3,}/.test(text)) return true;
  return false;
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const charClass = (ch: string): number => (ch >= "0" && ch <= "9" ? 0 : ch >= "a" && ch <= "z" ? 1 : ch >= "A" && ch <= "Z" ? 2 : 3);

/**
 * True for a long token that looks machine-generated rather than written: high entropy, digits
 * mixed in, and character classes that switch often. Ordinary identifiers in pasted code
 * (`cameraPreviewContainerElement`, `getUserMedia2024Fallback`) switch class rarely and are left alone.
 */
export function looksLikeHighEntropyToken(token: string): boolean {
  if (token.length < 24 || token.length > 512) return false;
  if (!/^[A-Za-z0-9_+/=-]+$/.test(token)) return false;
  const digits = (token.match(/\d/g) ?? []).length;
  const letters = (token.match(/[A-Za-z]/g) ?? []).length;
  if (digits < 3 || letters < 6) return false;
  if (shannonEntropy(token) < 3.6) return false;
  let switches = 0;
  for (let i = 1; i < token.length; i += 1) {
    if (charClass(token.charAt(i)) !== charClass(token.charAt(i - 1))) switches += 1;
  }
  return switches / (token.length - 1) >= 0.4;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

function detectSecret(text: string): SecretKind | null {
  for (const pattern of KEY_PREFIX_PATTERNS) if (pattern.test(text)) return "api_key";
  if (KEY_LABEL_PATTERN.test(text)) return "api_key";

  const urls = text.match(URL_PATTERN) ?? [];
  if (urls.some((url) => URL_SECRET_PARAM.test(url))) return "api_key";

  if (looksLikeCard(text)) return "card";
  for (const pattern of ONE_TIME_CODE_PATTERNS) if (pattern.test(text)) return "one_time_code";
  if (looksLikePassword(text)) return "password";

  // The entropy check skips URLs: project links (for example a Replit preview address) carry long
  // random host names that are not secrets. Known key shapes and secret query parameters inside a
  // URL were already caught above.
  const withoutUrls = text.replace(URL_PATTERN, " ");
  for (const token of withoutUrls.split(/[\s"'`,;:()<>[\]{}|\\.!?]+/)) {
    if (looksLikeHighEntropyToken(token)) return "api_key";
  }
  return null;
}

// ───────────────────────────── Personal data (strip) ─────────────────────────────

const LABELS: Record<RedactionKind, { placeholder: string; one: string; many: string }> = {
  email: { placeholder: "[email removed]", one: "an email address", many: "email addresses" },
  phone: { placeholder: "[phone number removed]", one: "a phone number", many: "phone numbers" },
  postcode: { placeholder: "[postcode removed]", one: "a postcode", many: "postcodes" },
  address: { placeholder: "[address removed]", one: "a street address", many: "street addresses" },
  date_of_birth: { placeholder: "[date of birth removed]", one: "a date of birth", many: "dates of birth" },
  handle: { placeholder: "[username removed]", one: "a social media username", many: "social media usernames" },
  name: { placeholder: "[name removed]", one: "a name", many: "names" },
  number: { placeholder: "[number removed]", one: "a long number", many: "long numbers" },
};

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

/** UK numbers: mobiles (07…, +44 7…), geographic and non-geographic landlines, written with spaces, hyphens or brackets. */
const UK_PHONE =
  /(?<![\w.])(?:(?:\+|00)44[\s-]?\(?0?\)?[\s-]?[1-9]\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4}|\(?0[1-9]\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}|\(?0[1-9]\d{2}\)?[\s-]?\d{3}[\s-]?\d{4})(?![\w])/g;

/** UK postcodes, including GIR 0AA, in either case and with or without the space. */
const UK_POSTCODE =
  /\b(?:GIR\s?0AA|(?:[A-PR-UWYZ](?:\d{1,2}|[A-HK-Y]\d(?:\d|[ABEHMNPRV-Y])?|\d[A-HJKPS-UW]))\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi;

const STREET_SUFFIX =
  "(?:road|rd|street|st|avenue|ave|lane|ln|close|cl|drive|dr|way|crescent|cres|court|ct|place|pl|gardens|gdns|terrace|grove|square|sq|hill|park|mews|row|walk|rise|view|green|parade|vale|end|fields?)";
/** "12 Acacia Avenue", "Flat 3, 41b Mill Lane", "14a high street". */
const STREET_ADDRESS = new RegExp(
  `(?:\\b(?:flat|apartment|apt|unit)\\s+\\d+[a-z]?,?\\s+)?\\b\\d{1,4}[a-z]?,?\\s+(?:[A-Za-z][A-Za-z'’-]+\\s+){1,3}${STREET_SUFFIX}\\b\\.?`,
  "gi",
);

const MONTHS =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const FULL_DATE = new RegExp(
  [
    "\\b\\d{1,2}[/.-]\\d{1,2}[/.-](?:19|20)\\d{2}\\b", // 14/03/2011
    "\\b(?:19|20)\\d{2}-\\d{2}-\\d{2}\\b", // 2011-03-14
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS},?\\s+(?:19|20)\\d{2}\\b`, // 14th March 2011
    `\\b${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`, // March 14, 2011
  ].join("|"),
  "gi",
);
const BIRTH_CONTEXT = /\b(?:born|birthday|b-?day|d\.?o\.?b\.?|date\s+of\s+birth|birth\s?date)\b/i;

/** Year of a full date, or null. */
function yearOf(date: string): number | null {
  const match = date.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

/** "@maya_makes" style handles. CSS at-rules, decorators and doc tags in pasted code are left alone. */
const AT_HANDLE = /(?<![\w@/.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{1,28}[A-Za-z0-9_])?)(?![\w(])/g;
const NOT_HANDLES = new Set([
  "media", "import", "keyframes", "font-face", "supports", "charset", "layer", "container", "property", "tailwind", "apply", "theme",
  "param", "params", "return", "returns", "type", "typedef", "throws", "example", "see", "deprecated", "todo", "ts-ignore", "ts-expect-error",
  "override", "staticmethod", "classmethod", "dataclass", "app", "pytest", "click", "component", "injectable", "input", "output",
]);

const PLATFORMS =
  "(?:insta(?:gram)?|ig|snap(?:chat)?|sc|tik\\s?tok|discord|twitter|x|threads|whats\\s?app|telegram|roblox|xbox|psn|playstation|steam|twitch|youtube|yt|facebook|fb|bereal|kik|gamertag|username|user\\s?name|handle|@)";
/** "my insta is maya.makes", "discord = maya#1234": the platform word, then a connector, then the handle. */
const MY_PLATFORM_HANDLE = new RegExp(
  `\\b(my\\s+${PLATFORMS}\\b(?:\\s+(?:name|user\\s?name|handle|account|tag|id))?\\s*(?:is|=|:|-|its|it's)\\s*)@?([A-Za-z0-9_][A-Za-z0-9_.#-]{2,31})`,
  "gi",
);
/** "add me on snap: mayam", "find me on insta maya.makes": the connector is optional after "on <platform>". */
const ADD_ME_HANDLE = new RegExp(
  `\\b((?:add\\s+me\\s+on|find\\s+me\\s+on|follow\\s+me\\s+on|dm\\s+me\\s+on|message\\s+me\\s+on|im\\s+on|i'm\\s+on|i\\s+am\\s+on)\\s+${PLATFORMS}\\b\\s*(?:is|=|:|-|as|its|it's)?\\s*)@?([A-Za-z0-9_][A-Za-z0-9_.#-]{2,31})`,
  "gi",
);
/** Words that are plainly not a handle after "my username is …". */
const HANDLE_STOPWORDS = new Set(["now", "too", "today", "again", "later", "sometimes", "with", "for", "because", "when", "can", "cant", "all", "most", "every", "lol", "tbh","not", "the", "private", "public", "secret", "hidden", "wrong", "broken", "gone", "taken", "what", "where", "how", "and", "but", "there", "working", "showing"]);

/** "my name is Maya Okafor", "i'm called Tom", "my full name's …". Takes up to three name-like words. */
const NAME_INTRO =
  /\b(my\s+(?:full\s+|real\s+|first\s+|last\s+|sur)?name(?:\s+is|'s|\s+was|:)|my\s+name\s+is|i\s+am\s+called|i'?m\s+called|they\s+call\s+me|call\s+me|name\s*:)\s+((?:[A-Za-z][A-Za-z'’-]{1,24})(?:\s+[A-Z][A-Za-z'’-]{1,24}){0,2})/gi;
const NAME_STOPWORDS = new Set(["not", "the", "a", "an", "on", "in", "showing", "wrong", "missing", "there", "spelt", "spelled", "too", "now", "still", "what", "and", "but", "when", "if", "later", "back", "maybe", "out", "over"]);

/** Nine or more digits in a row (allowing spaces or hyphens between groups): account numbers and the like. */
const LONG_DIGITS = /(?<![\w.])\d(?:[ -]?\d){8,}(?![\w.])/g;
/** UK sort code followed by an account number. */
const SORT_CODE = /\b\d{2}-\d{2}-\d{2}\b/g;

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The sentence shown to the learner. Exported so the UI copy and the tests agree. */
export function redactionNotice(redactions: RedactionCount[]): string | null {
  if (redactions.length === 0) return null;
  const parts = redactions.map(({ kind, count }) => (count === 1 ? LABELS[kind].one : LABELS[kind].many));
  return `Before sending that to Coach, we took out ${joinList(parts)}. Coach doesn't need personal details to help.`;
}

/**
 * Sanitises one learner message.
 *
 * `now` is only used to decide which full dates could be a date of birth; without it, any full
 * date before 2016 or next to a word such as "born" is treated as one.
 */
export function redactInput(input: string, options: { now?: Date } = {}): RedactResult {
  const secret = detectSecret(input);
  if (secret) return { refused: true, secret, message: SECRET_MESSAGES[secret] };

  const counts = new Map<RedactionKind, number>();
  const bump = (kind: RedactionKind): string => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return LABELS[kind].placeholder;
  };
  const latestBirthYear = (options.now?.getUTCFullYear() ?? 2026) - 10;

  let text = input;
  text = text.replace(EMAIL, () => bump("email"));

  text = text.replace(NAME_INTRO, (whole: string, lead: string, name: string) => {
    const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (NAME_STOPWORDS.has(first)) return whole;
    return `${lead} ${bump("name")}`;
  });

  for (const pattern of [MY_PLATFORM_HANDLE, ADD_ME_HANDLE]) {
    text = text.replace(pattern, (whole: string, lead: string, handle: string) => {
      if (HANDLE_STOPWORDS.has(handle.toLowerCase())) return whole;
      return `${lead}${bump("handle")}`;
    });
  }
  text = text.replace(AT_HANDLE, (whole: string, handle: string) => (NOT_HANDLES.has(handle.toLowerCase()) ? whole : bump("handle")));

  text = text.replace(STREET_ADDRESS, () => bump("address"));
  text = text.replace(UK_POSTCODE, () => bump("postcode"));

  text = text.replace(FULL_DATE, (date: string, offset: number, whole: string) => {
    const year = yearOf(date);
    const before = whole.slice(Math.max(0, offset - 48), offset);
    const birthContext = BIRTH_CONTEXT.test(before);
    const plausibleBirthYear = year !== null && year >= 1930 && year <= latestBirthYear;
    return birthContext || plausibleBirthYear ? bump("date_of_birth") : date;
  });

  text = text.replace(UK_PHONE, () => bump("phone"));
  text = text.replace(SORT_CODE, () => bump("number"));
  text = text.replace(LONG_DIGITS, () => bump("number"));

  const redactions = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return { refused: false, text, redactions, notice: redactionNotice(redactions) };
}

/**
 * Strips personal data from text that is about to be stored or logged, without the refusal step.
 * Secrets are blanked rather than refused: used on model output, which must never echo one.
 */
export function scrubForStorage(input: string): string {
  const result = redactInput(input);
  if (!result.refused) return result.text;
  return "[removed: this text looked like it contained a password, key, code or card details]";
}
