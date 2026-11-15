/**
 * Accessibility preferences: text size, theme, reading mode and reduced motion.
 *
 * Pure and safe on both server and client. The root layout reads the `a11y`
 * cookie with `parseA11yPrefs` and spreads `a11yHtmlAttributes` onto <html>, so
 * the right theme is in the first byte of HTML and nothing flashes. The same
 * shape is stored in `learner_profile.a11y` for signed-in learners.
 */
export const A11Y_COOKIE = "a11y";
/** One year. The cookie is only written when someone changes a preference. */
export const A11Y_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEMES = ["light", "dark", "contrast"] as const;
export const READING_MODES = ["default", "dyslexia"] as const;
export const TEXT_SIZES = ["100", "112", "125", "150"] as const;
export const MOTION_MODES = ["auto", "reduce"] as const;

export type Theme = (typeof THEMES)[number];
export type ReadingMode = (typeof READING_MODES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type MotionMode = (typeof MOTION_MODES)[number];

export type A11yPrefs = {
  theme: Theme;
  reading: ReadingMode;
  /** Root font-size percentage. */
  text: TextSize;
  /** `auto` follows the device setting; `reduce` always switches motion off. */
  motion: MotionMode;
};

export const DEFAULT_A11Y_PREFS: A11yPrefs = {
  theme: "light",
  reading: "default",
  text: "100",
  motion: "auto",
};

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  const candidate = typeof value === "number" ? String(value) : value;
  return typeof candidate === "string" && (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : fallback;
}

function toObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    for (const attempt of [raw, safeDecode(raw)]) {
      try {
        const parsed: unknown = JSON.parse(attempt);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        // Not JSON: fall through to the defaults.
      }
    }
    return {};
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Accepts the cookie value (JSON, URL-encoded or not), a stored profile object, or anything else.
 * Unknown or malformed values fall back to the defaults, so nothing from the cookie reaches the HTML unchecked.
 */
export function parseA11yPrefs(raw: unknown): A11yPrefs {
  const o = toObject(raw);
  return {
    theme: pick(THEMES, o.theme, DEFAULT_A11Y_PREFS.theme),
    reading: pick(READING_MODES, o.reading, DEFAULT_A11Y_PREFS.reading),
    text: pick(TEXT_SIZES, o.text, DEFAULT_A11Y_PREFS.text),
    motion: pick(MOTION_MODES, o.motion, DEFAULT_A11Y_PREFS.motion),
  };
}

export function serialiseA11yPrefs(prefs: A11yPrefs): string {
  return JSON.stringify({
    theme: prefs.theme,
    reading: prefs.reading,
    text: prefs.text,
    motion: prefs.motion,
  });
}

export type A11yHtmlAttributes = {
  "data-theme": Theme;
  "data-reading": ReadingMode;
  "data-text": TextSize;
  "data-motion": MotionMode;
};

/** Spread onto <html>. globals.css keys every theme and reading rule off these attributes. */
export function a11yHtmlAttributes(prefs: A11yPrefs): A11yHtmlAttributes {
  return {
    "data-theme": prefs.theme,
    "data-reading": prefs.reading,
    "data-text": prefs.text,
    "data-motion": prefs.motion,
  };
}

/** Client only: reads the preferences currently applied to <html>. */
export function readA11yPrefsFromDocument(): A11yPrefs {
  if (typeof document === "undefined") return DEFAULT_A11Y_PREFS;
  const d = document.documentElement.dataset;
  return parseA11yPrefs({ theme: d.theme, reading: d.reading, text: d.text, motion: d.motion });
}

/** Client only: reads the `a11y` cookie, if there is one. */
export function readA11yCookie(): A11yPrefs | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${A11Y_COOKIE}=`));
  return entry ? parseA11yPrefs(entry.slice(A11Y_COOKIE.length + 1)) : null;
}

/** Client only: applies the preferences to <html> straight away. */
export function applyA11yPrefsToDocument(prefs: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const d = document.documentElement.dataset;
  d.theme = prefs.theme;
  d.reading = prefs.reading;
  d.text = prefs.text;
  d.motion = prefs.motion;
}

/** Client only: stores the preferences in the `a11y` cookie for a year. */
export function writeA11yCookie(prefs: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${A11Y_COOKIE}=${encodeURIComponent(serialiseA11yPrefs(prefs))}; Path=/; Max-Age=${A11Y_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}
