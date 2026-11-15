import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A11yPreferences, a11yHtmlAttributes, DEFAULT_A11Y_PREFS, parseA11yPrefs } from "@/components/ui";

function readCookie(): unknown {
  const entry = document.cookie.split("; ").find((c) => c.startsWith("a11y="));
  return entry ? JSON.parse(decodeURIComponent(entry.slice("a11y=".length))) : undefined;
}

function reset() {
  document.cookie = "a11y=; Path=/; Max-Age=0";
  for (const key of ["theme", "reading", "text", "motion"]) delete document.documentElement.dataset[key];
}

describe("A11yPreferences", () => {
  beforeEach(reset);
  afterEach(reset);

  it("does not set a cookie until something is changed", () => {
    render(<A11yPreferences />);
    expect(readCookie()).toBeUndefined();
    expect(screen.getByRole("radio", { name: /^Light/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Dyslexia-friendly reading mode" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Reduce motion" })).not.toBeChecked();
  });

  it("writes the a11y cookie and updates <html> as soon as the theme changes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<A11yPreferences onSave={onSave} />);

    await user.click(screen.getByRole("radio", { name: /^Dark/ }));

    expect(readCookie()).toEqual({ theme: "dark", reading: "default", text: "100", motion: "auto" });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(onSave).toHaveBeenLastCalledWith({
      theme: "dark",
      reading: "default",
      text: "100",
      motion: "auto",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Dark theme is on.");
    expect(screen.getByRole("radio", { name: /^Dark/ })).toBeChecked();
  });

  it("stores text size, reading mode and reduced motion together in one cookie", async () => {
    const user = userEvent.setup();
    render(<A11yPreferences />);

    await user.click(screen.getByRole("radio", { name: "Largest" }));
    await user.click(screen.getByRole("switch", { name: "Dyslexia-friendly reading mode" }));
    await user.click(screen.getByRole("switch", { name: "Reduce motion" }));
    await user.click(screen.getByRole("radio", { name: /^High contrast/ }));

    expect(readCookie()).toEqual({ theme: "contrast", reading: "dyslexia", text: "150", motion: "reduce" });
    const html = document.documentElement;
    expect(html).toHaveAttribute("data-theme", "contrast");
    expect(html).toHaveAttribute("data-reading", "dyslexia");
    expect(html).toHaveAttribute("data-text", "150");
    expect(html).toHaveAttribute("data-motion", "reduce");

    // And it can be switched back off.
    await user.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(readCookie()).toMatchObject({ motion: "auto" });
    expect(html).toHaveAttribute("data-motion", "auto");
  });

  it("starts from the preferences already on <html>", () => {
    Object.assign(document.documentElement.dataset, {
      theme: "contrast",
      reading: "dyslexia",
      text: "125",
      motion: "reduce",
    });
    render(<A11yPreferences />);
    expect(screen.getByRole("radio", { name: /^High contrast/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Larger" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Dyslexia-friendly reading mode" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Reduce motion" })).toBeChecked();
  });

  it("can be used with the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<A11yPreferences />);
    screen.getByRole("radio", { name: "Standard" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(readCookie()).toMatchObject({ text: "112" });
    screen.getByRole("switch", { name: "Reduce motion" }).focus();
    await user.keyboard(" ");
    expect(readCookie()).toMatchObject({ motion: "reduce" });
  });
});

describe("parseA11yPrefs", () => {
  it("reads the cookie whether or not it is URL-encoded", () => {
    const prefs = { theme: "dark", reading: "dyslexia", text: "125", motion: "reduce" } as const;
    expect(parseA11yPrefs(JSON.stringify(prefs))).toEqual(prefs);
    expect(parseA11yPrefs(encodeURIComponent(JSON.stringify(prefs)))).toEqual(prefs);
    expect(parseA11yPrefs({ ...prefs, text: 125 })).toEqual(prefs);
  });

  it.each([
    undefined,
    null,
    "",
    "not json",
    "%E0%A4%A",
    "[]",
    '{"theme":"neon","text":"900","reading":7,"motion":null}',
    '{"theme":"\\"><script>alert(1)</script>"}',
  ])("falls back to safe defaults for %j", (raw) => {
    expect(parseA11yPrefs(raw)).toEqual(DEFAULT_A11Y_PREFS);
  });

  it("turns preferences into the data attributes globals.css expects", () => {
    expect(a11yHtmlAttributes(DEFAULT_A11Y_PREFS)).toEqual({
      "data-theme": "light",
      "data-reading": "default",
      "data-text": "100",
      "data-motion": "auto",
    });
  });
});
