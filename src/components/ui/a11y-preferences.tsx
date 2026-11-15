"use client";

import { useState, useSyncExternalStore } from "react";
import {
  applyA11yPrefsToDocument,
  DEFAULT_A11Y_PREFS,
  parseA11yPrefs,
  readA11yPrefsFromDocument,
  serialiseA11yPrefs,
  writeA11yCookie,
  type A11yPrefs,
  type TextSize,
  type Theme,
} from "./a11y-prefs";
import { cx } from "./cn";
import { RadioGroup } from "./radio-group";
import { Switch } from "./switch";

/** The <html> attributes are the source of truth; this keeps every mounted panel in step with them. */
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => serialiseA11yPrefs(readA11yPrefsFromDocument());

const TEXT_OPTIONS: Array<{ value: TextSize; label: string }> = [
  { value: "100", label: "Standard" },
  { value: "112", label: "Large" },
  { value: "125", label: "Larger" },
  { value: "150", label: "Largest" },
];

const THEME_OPTIONS: Array<{ value: Theme; label: string; description: string }> = [
  { value: "light", label: "Light", description: "Dark text on warm paper." },
  { value: "dark", label: "Dark", description: "Light text on a dark background." },
  {
    value: "contrast",
    label: "High contrast",
    description: "Black on white, stronger outlines, no shadows.",
  },
];

export type A11yPreferencesProps = {
  /**
   * The preferences the server rendered with (from the cookie or the profile).
   * Used for the first paint so the panel matches the page.
   */
  initial?: A11yPrefs;
  /**
   * Called after every change, once the cookie and the page have been updated.
   * A signed-in page passes a Server Action here to save to the profile.
   */
  onSave?: (prefs: A11yPrefs) => void | Promise<void>;
  headingLevel?: "h2" | "h3";
  className?: string;
};

/**
 * Text size, theme, dyslexia-friendly reading mode and reduced motion.
 * Each change applies to the page immediately, is stored in the `a11y` cookie
 * (so the next page load is right from the first paint) and is announced.
 */
export function A11yPreferences({
  initial,
  onSave,
  headingLevel: Heading = "h2",
  className,
}: A11yPreferencesProps) {
  const fallback = serialiseA11yPrefs(initial ?? DEFAULT_A11Y_PREFS);
  const prefs = parseA11yPrefs(useSyncExternalStore(subscribe, snapshot, () => fallback));
  const [status, setStatus] = useState("");

  function update(patch: Partial<A11yPrefs>, message: string) {
    const next = { ...prefs, ...patch };
    applyA11yPrefsToDocument(next);
    writeA11yCookie(next);
    for (const listener of listeners) listener();
    setStatus(message);
    void Promise.resolve(onSave?.(next)).catch(() => {
      setStatus(
        "Changed on this device, but we couldn't save it to your account. It will try again next time you change a setting.",
      );
    });
  }

  return (
    <section className={cx("text-ink flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-1">
        <Heading className="text-xl font-bold">Make it easier to read</Heading>
        <p className="text-ink-muted">These change straight away and are remembered on this device.</p>
      </div>

      <RadioGroup
        legend="Text size"
        name="a11y-text"
        layout="row"
        options={TEXT_OPTIONS}
        value={prefs.text}
        onChange={(event) => {
          const option = TEXT_OPTIONS.find((o) => o.value === event.target.value);
          if (option) update({ text: option.value }, `Text size set to ${option.label.toLowerCase()}.`);
        }}
      />

      <RadioGroup
        legend="Theme"
        name="a11y-theme"
        options={THEME_OPTIONS}
        value={prefs.theme}
        onChange={(event) => {
          const option = THEME_OPTIONS.find((o) => o.value === event.target.value);
          if (option) update({ theme: option.value }, `${option.label} theme is on.`);
        }}
      />

      <div className="divide-line border-line flex flex-col divide-y-2 border-y-2">
        <Switch
          label="Dyslexia-friendly reading mode"
          description="A clearer font, more space between lines, letters and words, shorter lines and a cream background."
          checked={prefs.reading === "dyslexia"}
          onChange={(event) =>
            update(
              { reading: event.target.checked ? "dyslexia" : "default" },
              event.target.checked
                ? "Dyslexia-friendly reading mode is on."
                : "Dyslexia-friendly reading mode is off.",
            )
          }
        />
        <Switch
          label="Reduce motion"
          description="Switches off animations and transitions. We also follow your device's own setting."
          checked={prefs.motion === "reduce"}
          onChange={(event) =>
            update(
              { motion: event.target.checked ? "reduce" : "auto" },
              event.target.checked ? "Reduced motion is on." : "Reduced motion is off.",
            )
          }
        />
      </div>

      <p role="status" aria-live="polite" className="text-ink min-h-6 text-sm font-bold">
        {status}
      </p>
    </section>
  );
}
