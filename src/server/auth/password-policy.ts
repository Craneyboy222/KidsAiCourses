import { createHash } from "node:crypto";
import { COMMON_PASSWORDS } from "./common-passwords";

/**
 * Password rules (spec 3.1, decision D10).
 *
 * 1. At least 10 characters, at most 128.
 * 2. Not one of the bundled common passwords.
 * 3. Not built from the account's own username, nickname or email name.
 * 4. Optionally not in the Have I Been Pwned corpus. That check calls a third party, so it runs
 *    only when `PASSWORD_BREACH_CHECK=hibp`, which stays off until the owner approves it. It sends
 *    the first five characters of the password's SHA-1 hash and nothing else (k-anonymity).
 *
 * Everything here is a pure function of its arguments: no environment, no database. The caller
 * passes the mode in. Messages are written for a teenager: what happened and what to try.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem =
  "too_short" | "too_long" | "too_common" | "contains_personal_detail" | "breached";

export type PasswordCheck = { ok: true } | { ok: false; problem: PasswordProblem; message: string };

/** Details of the account the password is for, so it cannot simply repeat them. */
export type PasswordContext = {
  username?: string | null;
  name?: string | null;
  email?: string | null;
};

const MESSAGES: Record<PasswordProblem, string> = {
  too_short: `That password is too short. Use at least ${PASSWORD_MIN_LENGTH} characters: three random words work well.`,
  too_long: `That password is too long. Keep it to ${PASSWORD_MAX_LENGTH} characters or fewer.`,
  too_common:
    "That password is one of the most commonly used, so it is easy to guess. Try three random words instead.",
  contains_personal_detail:
    "That password includes your username or name, which makes it easy to guess. Try three random words instead.",
  breached:
    "That password has appeared in a known data leak, so it is not safe to use. Please choose a different one.",
};

const fail = (problem: PasswordProblem): PasswordCheck => ({
  ok: false,
  problem,
  message: MESSAGES[problem],
});

/** Length in characters as a person counts them, so an emoji is one character, not two. */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

/** Letters and digits only, lower-cased: `Maya_K.14` → `mayak14`. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True when the password is the username, nickname or email name with at most a few extra
 * characters, e.g. `mayak14!!2026`. Details shorter than four characters are ignored: they
 * turn up inside ordinary passwords by chance.
 */
export function containsPersonalDetail(password: string, context: PasswordContext = {}): boolean {
  const squashedPassword = squash(password);
  const details = [context.username, context.name, context.email?.split("@")[0]]
    .filter((v): v is string => typeof v === "string")
    .map(squash)
    .filter((v) => v.length >= 4);
  return details.some(
    (detail) => squashedPassword.includes(detail) && squashedPassword.length - detail.length <= 6,
  );
}

/** The local rules: length, the bundled common-password list and the account's own details. No network. */
export function checkPasswordLocal(password: string, context: PasswordContext = {}): PasswordCheck {
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) return fail("too_short");
  if (length > PASSWORD_MAX_LENGTH) return fail("too_long");
  if (isCommonPassword(password)) return fail("too_common");
  if (containsPersonalDetail(password, context)) return fail("contains_personal_detail");
  return { ok: true };
}

// ── Have I Been Pwned (optional) ────────────────────────────────────────────

export const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** Upper-case hex SHA-1, split into the five-character prefix we send and the suffix we keep. */
export function hibpHashParts(password: string): { prefix: string; suffix: string } {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/**
 * Reads a range response (`SUFFIX:COUNT` per line) and returns how often our suffix appears.
 * Padding rows, which the API adds to hide the response size, have a count of 0.
 */
export function hibpCountInRange(body: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const [candidate, count] = line.trim().split(":");
    if (candidate?.toUpperCase() !== wanted) continue;
    const n = Number.parseInt(count ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Asks the Have I Been Pwned range API whether the password is in a known leak.
 * Returns `null` when the service cannot be reached: a third party being down must never stop a
 * family from signing up, and the local rules have already run.
 */
export async function isBreachedPassword(
  password: string,
  fetchImpl: FetchLike,
  timeoutMs = 3000,
): Promise<boolean | null> {
  const { prefix, suffix } = hibpHashParts(password);
  try {
    const response = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!response.ok) return null;
    return hibpCountInRange(await response.text(), suffix) > 0;
  } catch {
    return null;
  }
}

export type PasswordPolicyOptions = {
  /** `env.PASSWORD_BREACH_CHECK`. Anything other than `"hibp"` means no network call is made. */
  breachCheck: "local" | "hibp";
  context?: PasswordContext;
  /** Injected so tests never touch the network. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
};

/** The full policy: local rules first, then the breach check only if it is switched on. */
export async function checkPassword(
  password: string,
  options: PasswordPolicyOptions,
): Promise<PasswordCheck> {
  const local = checkPasswordLocal(password, options.context);
  if (!local.ok) return local;
  if (options.breachCheck !== "hibp") return local;
  const breached = await isBreachedPassword(password, options.fetchImpl ?? ((url, init) => fetch(url, init)));
  return breached === true ? fail("breached") : { ok: true };
}
