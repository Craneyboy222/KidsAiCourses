import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RETENTION_DEFAULTS } from "@/server/services/retention";

/**
 * The compliance documents are only useful while they are true. These checks are cheap ones: every
 * document the brief asks for exists, none of them claims a legal conclusion without the ⚖️ mark
 * being in use, and the retention schedule shows exactly the periods the code applies.
 */
const dir = resolve(process.cwd(), "docs", "compliance");
const read = (name: string): string => readFileSync(resolve(dir, name), "utf8");

const DOCUMENTS = [
  "README.md",
  "DPIA_TEMPLATE.md",
  "RECORD_OF_PROCESSING.md",
  "RETENTION_SCHEDULE.md",
  "CHILDRENS_CODE_MAPPING.md",
  "ONLINE_SAFETY_ACT_NOTES.md",
  "PROCESSOR_REGISTER.md",
  "INCIDENT_AND_BREACH_PROCEDURE.md",
  "SAFEGUARDING_POLICY.md",
];

describe("compliance documents", () => {
  it("has every document the README lists, and lists every document there is", () => {
    const readme = read("README.md");
    for (const name of DOCUMENTS) {
      expect(existsSync(resolve(dir, name)), name).toBe(true);
      if (name !== "README.md") expect(readme, name).toContain(`\`${name}\``);
    }
  });

  it("marks legal judgements as open in every document, and says none of them is legal advice", () => {
    for (const name of DOCUMENTS) {
      const text = read(name);
      expect(text, name).toContain("⚖️");
      if (name !== "PROCESSOR_REGISTER.md") expect(text, name).toMatch(/(not|nothing here is)\s+legal\s+advice|not\s+an\s+assessment|not\s+a\s+statement\s+of\s+conformance|not\s+a\s+policy\s+yet/i);
    }
  });

  it("goes through all 15 standards of the Children's code, each left for a lawyer to confirm", () => {
    const text = read("CHILDRENS_CODE_MAPPING.md");
    const headings = [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    const sections = text.split(/^## \d+\. /m).slice(1);
    // Standard 14 (connected toys) is the one that does not apply to a website.
    sections.forEach((section, index) => {
      if (index !== 13) expect(section, `standard ${index + 1}`).toContain("⚖️ TO CONFIRM");
    });
  });
});

describe("the retention schedule document", () => {
  const text = read("RETENTION_SCHEDULE.md");
  const row = (key: string): string => text.split("\n").find((line) => line.startsWith(`| \`${key}\` |`)) ?? "";

  it("has one row for every policy in the code, with the period the code applies", () => {
    for (const policy of RETENTION_DEFAULTS) {
      const line = row(policy.key);
      expect(line, policy.key).not.toBe("");
      const period = line.split("|")[2]?.trim() ?? "";
      if (policy.days === 0) expect(period, policy.key).toBe("Not a number of days");
      else expect(period.startsWith(`${policy.days} days`), `${policy.key}: "${period}"`).toBe(true);
    }
    const keysInDocument = [...text.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(keysInDocument.sort()).toEqual(RETENTION_DEFAULTS.map((policy) => policy.key).sort());
  });

  it("marks every period the law decides, and only those, as to confirm", () => {
    for (const policy of RETENTION_DEFAULTS) {
      expect(row(policy.key).split("|")[3]?.trim(), policy.key).toBe(policy.legal ? "⚖️ TO CONFIRM" : "Owner's choice");
    }
  });

  it("says which periods are fixed in code", () => {
    for (const policy of RETENTION_DEFAULTS) expect(row(policy.key).includes("Fixed in code"), policy.key).toBe(policy.fixedInCode !== undefined);
  });
});
