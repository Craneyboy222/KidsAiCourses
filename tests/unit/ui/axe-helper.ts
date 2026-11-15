import axe, { type Result, type RunOptions } from "axe-core";

/**
 * Runs axe-core on rendered markup and returns the violations in a readable form.
 * jsdom has no layout or painting, so the colour-contrast rule cannot run here:
 * contrast is covered by contrast.test.ts (token maths) and by the Playwright
 * axe checks against /dev/kit in a real browser.
 */
export async function axeViolations(
  node: Element = document.body,
  options: RunOptions = {},
): Promise<string[]> {
  const results = await axe.run(node, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
    },
    ...options,
    rules: { "color-contrast": { enabled: false }, ...options.rules },
  });
  return results.violations.map(describe);
}

function describe(violation: Result): string {
  const targets = violation.nodes.map((n) => n.target.join(" ")).join(", ");
  return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} -> ${targets}`;
}
