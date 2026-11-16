import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/**
 * Username rules (spec 3.1: "a username checked for personal information and profanity").
 *
 * A username is the only name a learner signs in with, and it may be seen by parents and staff,
 * so it must not give away who or where the child is. The checks, in order:
 *
 *   1. Shape: 3 to 20 characters; letters, digits and underscores; at least one letter.
 *   2. Not a name that pretends to be staff or the Coach.
 *   3. Does not contain the child's nickname.
 *   4. Does not look like an email address or a phone number.
 *   5. Does not contain a year (any 19xx or 20xx), or the two-digit form of the birth year.
 *   6. Does not name a school, year group, town or postcode (a small list, not a gazetteer).
 *   7. No profanity.
 *
 * Everything here is a pure function: no database, no clock, and randomness is passed in.
 * Uniqueness (case-insensitive) is checked against the database by the calling service.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export type UsernameProblem =
  | "too_short"
  | "too_long"
  | "bad_characters"
  | "no_letters"
  | "reserved"
  | "contains_nickname"
  | "looks_like_email"
  | "looks_like_phone"
  | "contains_year"
  | "school_or_place"
  | "profanity";

export type UsernameCheck =
  { ok: true; username: string } | { ok: false; problem: UsernameProblem; message: string };

export type UsernameContext = {
  /** The nickname on the same profile. A username must not repeat it. */
  nickname?: string | null;
  /** The birth year on the same profile, so that `maya11` is refused for someone born in 2011. */
  birthYear?: number | null;
};

const MESSAGES: Record<UsernameProblem, string> = {
  too_short: `That username is too short. Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`,
  too_long: `That username is too long. Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`,
  bad_characters: "Usernames can only use letters, numbers and underscores. Take out any spaces or symbols.",
  no_letters: "A username needs at least one letter. Try a word or two with a number on the end.",
  reserved: "That username could be mistaken for a member of our team. Please choose a different one.",
  contains_nickname:
    "That username includes the nickname. Pick something that doesn't use a real name or nickname, so it stays private.",
  looks_like_email: "That looks like an email address. A username should be made up, not a contact detail.",
  looks_like_phone: "That looks like a phone number. A username should be made up, not a contact detail.",
  contains_year:
    "That username has a year in it, which can give away an age. Try a different number, or leave the number out.",
  school_or_place:
    "That username looks like it names a school, year group or place. Pick something that doesn't say where you are.",
  profanity: "That username isn't allowed. Try one of the suggestions, or think of another.",
};

const fail = (problem: UsernameProblem): UsernameCheck => ({ ok: false, problem, message: MESSAGES[problem] });

/** Lower-cases and trims: usernames are case-insensitive everywhere. */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Letters and digits only. `Maya_K.14` → `mayak14`. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** Undoes the usual number-for-letter swaps, so `m4ya` is seen as `maya`. */
function unleet(value: string): string {
  return value.replace(/[0134578]/g, (digit) => LEET[digit] ?? digit);
}

const RESERVED = [
  "admin",
  "administrator",
  "moderator",
  "support",
  "staff",
  "official",
  "coach",
  "system",
  "helpdesk",
  "safeguarding",
];

const EMAIL_PROVIDERS =
  /(gmail|googlemail|hotmail|outlook|yahoo|icloud|protonmail|proton_me|aol_com|live_co|msn_com)/;
const EMAIL_SHAPE = /(_at_|^at_).*(_?com|_?co_?uk|_?org|_?net)$|dot_?com|_co_?uk$|_com$/;

const SCHOOL_WORDS = /(school|skool|academy|college|sixth_?form|grammar|high_?sch|uni_?of|year_?\d{1,2}(?!\d)|yr_?\d{1,2}(?!\d)|class_?\d|form_?\d)/;

/** The largest UK towns and cities. A small list on purpose: it catches the obvious, not everything. */
const PLACES = [
  "london",
  "manchester",
  "birmingham",
  "liverpool",
  "leeds",
  "sheffield",
  "bristol",
  "glasgow",
  "edinburgh",
  "cardiff",
  "belfast",
  "newcastle",
  "nottingham",
  "leicester",
  "bradford",
  "coventry",
  "brighton",
  "southampton",
  "portsmouth",
  "swansea",
  "aberdeen",
  "essex",
  "yorkshire",
];
/** A whole UK postcode, e.g. `sw1a1aa` or `m11ae`, as one token or the whole username. */
const POSTCODE = /^[a-z]{1,2}\d[a-z\d]?\d[a-z]{2}$/;

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

function hasProfanity(username: string): boolean {
  // As typed, with underscores as spaces (so word boundaries are seen), and squashed together.
  const variants = [username, username.replace(/_/g, " "), squash(username), unleet(squash(username))];
  return variants.some((variant) => profanityMatcher.hasMatch(variant));
}

function containsYear(username: string, birthYear: number | null | undefined): boolean {
  if (/(19|20)\d{2}/.test(username)) return true;
  if (birthYear === null || birthYear === undefined || !Number.isInteger(birthYear)) return false;
  const short = String(birthYear % 100).padStart(2, "0");
  // A run of exactly two digits equal to the birth year, e.g. `_11` for 2011.
  return (username.match(/\d+/g) ?? []).some((run) => run === short);
}

function looksLikePlace(username: string): boolean {
  const squashed = squash(username);
  if (PLACES.some((place) => squashed.includes(place))) return true;
  const tokens = username.split("_").filter(Boolean);
  if (POSTCODE.test(squashed) || tokens.some((token) => POSTCODE.test(token))) return true;
  // Outward and inward halves as neighbouring tokens: `sw1a_1aa`.
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (POSTCODE.test(`${tokens[i] ?? ""}${tokens[i + 1] ?? ""}`) && /\d/.test(tokens[i] ?? "")) return true;
  }
  return false;
}

/** Checks a username against every rule. Returns the first problem found, with a message for the person. */
export function checkUsername(raw: string, context: UsernameContext = {}): UsernameCheck {
  const username = normaliseUsername(raw);
  const length = Array.from(username).length;
  if (length < USERNAME_MIN) return fail("too_short");
  if (length > USERNAME_MAX) return fail("too_long");
  if (!/^[a-z0-9_]+$/.test(username)) {
    // An @ is the commonest reason: say what it looks like, not just "bad characters".
    return fail(username.includes("@") ? "looks_like_email" : "bad_characters");
  }
  if (!/[a-z]/.test(username)) {
    return fail(/\d{7,}/.test(username.replace(/_/g, "")) ? "looks_like_phone" : "no_letters");
  }

  const squashed = squash(username);
  if (RESERVED.some((word) => squashed.includes(word))) return fail("reserved");

  const nickname = squash(context.nickname ?? "");
  if (nickname.length >= 3) {
    const plainNickname = unleet(nickname);
    if (squashed.includes(nickname) || unleet(squashed).includes(plainNickname)) return fail("contains_nickname");
  }

  if (EMAIL_PROVIDERS.test(username) || EMAIL_SHAPE.test(username)) return fail("looks_like_email");
  if (/\d{7,}/.test(username.replace(/_/g, ""))) return fail("looks_like_phone");
  if (containsYear(username, context.birthYear)) return fail("contains_year");
  if (SCHOOL_WORDS.test(username) || looksLikePlace(username)) return fail("school_or_place");
  if (hasProfanity(username)) return fail("profanity");

  return { ok: true, username };
}

// ── Suggestions ─────────────────────────────────────────────────────────────

export const SUGGESTION_ADJECTIVES = [
  "brave",
  "bright",
  "calm",
  "clever",
  "cosmic",
  "curious",
  "daring",
  "eager",
  "fuzzy",
  "gentle",
  "golden",
  "happy",
  "jolly",
  "lively",
  "lucky",
  "mellow",
  "nimble",
  "plucky",
  "quiet",
  "rapid",
  "silver",
  "sunny",
  "swift",
  "witty",
] as const;

export const SUGGESTION_NOUNS = [
  "badger",
  "comet",
  "falcon",
  "fox",
  "heron",
  "kite",
  "lynx",
  "maple",
  "meteor",
  "otter",
  "owl",
  "panda",
  "pebble",
  "penguin",
  "pixel",
  "puffin",
  "raven",
  "robin",
  "rocket",
  "sparrow",
  "tiger",
  "walrus",
  "willow",
  "wren",
] as const;

/** `brave_otter_482`: an adjective, a noun and three digits. Never a year, never a name. */
export function buildSuggestion(adjective: string, noun: string, number: number): string {
  return `${adjective}_${noun}_${number}`;
}

/**
 * `count` different made-up usernames that pass every rule above. `random` returns a number in
 * [0, 1), like `Math.random`; pass a fixed one in tests. `taken` lists names to avoid.
 */
export function suggestUsernames(
  count = 3,
  options: { random?: () => number; context?: UsernameContext; taken?: Iterable<string> } = {},
): string[] {
  const random = options.random ?? Math.random;
  const avoid = new Set(Array.from(options.taken ?? [], normaliseUsername));
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))] as T;
  const out: string[] = [];
  // Bounded: with 24 × 24 × 900 combinations this ends long before the limit unless `random` is stuck.
  for (let attempt = 0; out.length < count && attempt < count * 50; attempt++) {
    const number = 100 + Math.min(899, Math.floor(random() * 900));
    const candidate = buildSuggestion(pick(SUGGESTION_ADJECTIVES), pick(SUGGESTION_NOUNS), number);
    if (avoid.has(candidate) || out.includes(candidate)) continue;
    if (!checkUsername(candidate, options.context).ok) continue;
    out.push(candidate);
  }
  return out;
}

// ── Nicknames ───────────────────────────────────────────────────────────────

export const NICKNAME_MAX = 24;

export type NicknameCheck = { ok: true; nickname: string } | { ok: false; message: string };

/**
 * A nickname is what we call the learner on screen and on certificates. It is chosen by a parent
 * and seen only by the family and staff, so the rules are lighter than for a username: short, no
 * contact details, no profanity.
 */
export function checkNickname(raw: string): NicknameCheck {
  const nickname = raw.trim().replace(/\s+/g, " ");
  const length = Array.from(nickname).length;
  if (length < 1) return { ok: false, message: "Add a nickname, so we know what to call them." };
  if (length > NICKNAME_MAX) {
    return { ok: false, message: `Keep the nickname to ${NICKNAME_MAX} characters or fewer.` };
  }
  if (/[@<>/\\]|https?:|www\./i.test(nickname)) {
    return { ok: false, message: "A nickname can't be an email address or a link. Use a short name instead." };
  }
  if (/\d{5,}/.test(nickname.replace(/[\s-]/g, ""))) {
    return { ok: false, message: "A nickname can't include a phone number. Use a short name instead." };
  }
  if (nickname.split(" ").length > 2) {
    return { ok: false, message: "Use a first name or nickname only, not a full name." };
  }
  if (profanityMatcher.hasMatch(nickname)) {
    return { ok: false, message: "That nickname isn't allowed. Please choose a different one." };
  }
  return { ok: true, nickname };
}
