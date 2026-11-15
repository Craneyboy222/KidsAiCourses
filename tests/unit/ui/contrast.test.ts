import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reads the theme tokens straight out of src/app/globals.css and checks every
 * text/background pair the kit uses against WCAG 2.2 AA: 4.5:1 for text and
 * 3:1 for component boundaries, in light, dark and high-contrast themes, and
 * on the cream paper of the dyslexia-friendly reading mode.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  const at = css.indexOf(`${selectorStart} {`);
  if (at < 0) throw new Error(`Token block not found: ${selectorStart}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1] ?? ""] = m[2] ?? "";
  return vars;
}

const light = block(`[data-theme="light"]`);
const themes: Record<string, Record<string, string>> = {
  light,
  // Category hues are fixed across themes, so dark and contrast inherit them from the light block.
  dark: { ...light, ...block(`[data-theme="dark"]`) },
  contrast: { ...light, ...block(`[data-theme="contrast"]`) },
  "light + dyslexia cream": {
    ...light,
    ...block(`[data-reading="dyslexia"]:not([data-theme="dark"], [data-theme="contrast"])`),
  },
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background] pairs that carry text. */
const TEXT_PAIRS: Array<[string, string]> = [
  ["--ink", "--paper"],
  ["--ink", "--surface"],
  ["--ink", "--tint"],
  ["--ink-muted", "--paper"],
  ["--ink-muted", "--surface"],
  ["--ink-muted", "--tint"],
  ["--paper", "--ink"],
  ["--on-primary", "--primary"],
  ["--on-primary", "--primary-hover"],
  ["--link", "--paper"],
  ["--link", "--surface"],
  ["--link", "--tint"],
  ["--on-accent", "--accent"],
  ["--success", "--paper"],
  ["--success", "--surface"],
  ["--success", "--success-soft"],
  ["--ink", "--success-soft"],
  ["--warning", "--warning-soft"],
  ["--warning", "--paper"],
  ["--warning", "--surface"],
  ["--ink", "--warning-soft"],
  ["--danger", "--paper"],
  ["--danger", "--surface"],
  ["--danger", "--danger-soft"],
  ["--ink", "--danger-soft"],
  ["--on-danger", "--danger"],
  ["--on-danger", "--danger-hover"],
  ["--info", "--paper"],
  ["--info", "--surface"],
  ["--info", "--info-soft"],
  ["--ink", "--info-soft"],
  ...[1, 2, 3, 4, 5, 6].map((n): [string, string] => ["--on-cat", `--cat-${n}`]),
];

/** [boundary or indicator, adjacent colour] pairs: outlines, focus ring, state fills. */
const COMPONENT_PAIRS: Array<[string, string]> = [
  ["--ink", "--paper"], // card, input and button outlines
  ["--ink", "--surface"],
  ["--ink", "--tint"],
  ["--focus", "--focus-gap"], // the two tones of the focus ring
  ["--focus", "--paper"],
  ["--focus", "--surface"],
  ["--primary", "--surface"], // checked checkbox, switch track, progress fill
  ["--primary", "--paper"],
  ["--on-primary", "--primary"], // tick and switch thumb
  ["--danger", "--surface"], // invalid field outline
  ["--danger", "--paper"],
  ["--success", "--surface"],
  ["--surface", "--success"], // tick inside a finished step marker
  ["--warning", "--warning-soft"],
  ["--info", "--info-soft"],
];

/** Colour blocks (accent and the six category hues): the outline or the fill itself must separate them from the page. */
const BLOCKS = ["--accent", ...[1, 2, 3, 4, 5, 6].map((n) => `--cat-${n}`)];

describe.each(Object.entries(themes))("colour contrast: %s theme", (_name, vars) => {
  const get = (token: string) => {
    const value = vars[token];
    if (!value) throw new Error(`Missing token ${token}`);
    return value;
  };

  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(COMPONENT_PAIRS)("%s against %s is at least 3:1", (fg, bg) => {
    expect(ratio(get(fg), get(bg))).toBeGreaterThanOrEqual(3);
  });

  it.each(BLOCKS)("%s block is separated from paper and surface by at least 3:1", (fill) => {
    for (const page of ["--paper", "--surface"]) {
      const byOutline = ratio(get("--ink"), get(fill));
      const byFill = ratio(get(fill), get(page));
      expect(Math.max(byOutline, byFill)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("design tokens", () => {
  it("keeps the DESIGN.md claims for the light theme", () => {
    expect(ratio(light["--ink-muted"] ?? "", light["--paper"] ?? "")).toBeGreaterThanOrEqual(7);
    expect(ratio(light["--on-primary"] ?? "", light["--primary"] ?? "")).toBeGreaterThanOrEqual(7);
  });

  it("defines every theme token in dark and contrast as well", () => {
    const fixed = /^--cat-\d$/;
    for (const name of ["dark", "contrast"] as const) {
      const own = block(`[data-theme="${name}"]`);
      for (const token of Object.keys(light)) {
        if (fixed.test(token)) continue;
        expect(own, `${name} is missing ${token}`).toHaveProperty(token);
      }
    }
  });
});
