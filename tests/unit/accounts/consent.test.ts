import { describe, expect, it } from "vitest";
import { SAFETY_BANDS } from "@/server/authz/actor";
import {
  OPTIONAL_CONSENT_KEYS,
  REQUIRED_CONSENT_KEYS,
  consentDefaultForBand,
  consentState,
  currentDefinitions,
} from "@/server/services/consent";
import { consentFileSchema, readConsentFiles } from "../../../scripts/import-consents";

const when = new Date("2026-11-16T10:00:00Z");

describe("consent defaults by band", () => {
  it("never pre-selects a required consent, whatever the data says", () => {
    for (const band of SAFETY_BANDS) {
      expect(consentDefaultForBand({ required: true, defaultByBand: { [band]: true } }, band)).toBe(false);
    }
  });

  it("follows the definition for optional consents, and is off for anything not listed", () => {
    const definition = { required: false, defaultByBand: { teen_13_15: false, teen_16_17: true } };
    expect(consentDefaultForBand(definition, "teen_13_15")).toBe(false);
    expect(consentDefaultForBand(definition, "teen_16_17")).toBe(true);
    expect(consentDefaultForBand(definition, "adult_18")).toBe(false);
    expect(consentDefaultForBand({ required: false, defaultByBand: {} }, "teen_13_15")).toBe(false);
  });

  it("only an exact true switches a default on", () => {
    const sloppy = { required: false, defaultByBand: { teen_16_17: "yes" as unknown as boolean } };
    expect(consentDefaultForBand(sloppy, "teen_16_17")).toBe(false);
  });
});

describe("the consent definitions in content/consents", () => {
  const definitions = readConsentFiles();

  it("are the three required and two optional consents from the spec", () => {
    const required = definitions.filter((d) => d.required).map((d) => d.key).sort();
    const optional = definitions.filter((d) => !d.required).map((d) => d.key).sort();
    expect(required).toEqual([...REQUIRED_CONSENT_KEYS].sort());
    expect(optional).toEqual([...OPTIONAL_CONSENT_KEYS].sort());
  });

  it("default both optional consents to off for 13 to 15", () => {
    for (const definition of definitions.filter((d) => !d.required)) {
      expect(consentDefaultForBand(definition, "teen_13_15"), definition.key).toBe(false);
    }
  });

  it("are versioned, ordered and written in plain paragraphs", () => {
    const positions = definitions.map((d) => d.position);
    expect(new Set(positions).size).toBe(positions.length);
    for (const definition of definitions) {
      expect(definition.version).toBeGreaterThanOrEqual(1);
      expect(definition.title.length).toBeGreaterThan(5);
      expect(definition.body).not.toMatch(/<[a-z]/i);
    }
  });

  it("tells parents that outside tools have their own terms and that we only see what is handed back", () => {
    const tools = definitions.find((d) => d.key === "third_party_tools");
    expect(tools?.body).toMatch(/own terms/);
    expect(tools?.body).toMatch(/hand back|hands? (it )?back/);
  });

  it("the file check refuses a consent that is on by default for 13 to 15, or a pre-ticked required one", () => {
    const base = { key: "example_consent", version: 1, position: 1, title: "Example", body: "x".repeat(60) };
    const off = { teen_13_15: false, teen_16_17: false, adult_18: false };
    expect(consentFileSchema.safeParse({ ...base, required: false, defaultByBand: off }).success).toBe(true);
    expect(consentFileSchema.safeParse({ ...base, required: false, defaultByBand: { ...off, teen_13_15: true } }).success).toBe(false);
    expect(consentFileSchema.safeParse({ ...base, required: true, defaultByBand: { ...off, adult_18: true } }).success).toBe(false);
    expect(consentFileSchema.safeParse({ ...base, required: false, defaultByBand: { ...off, teen_16_17: true } }).success).toBe(true);
  });
});

describe("currentDefinitions", () => {
  it("keeps the highest active version of each key, in position order", () => {
    const rows = [
      { key: "b", version: 1, active: true, position: 20 },
      { key: "a", version: 1, active: false, position: 10 },
      { key: "a", version: 2, active: true, position: 10 },
      { key: "c", version: 3, active: false, position: 5 },
    ];
    expect(currentDefinitions(rows).map((r) => `${r.key}@${r.version}`)).toEqual(["a@2", "b@1"]);
  });
});

describe("consentState", () => {
  it("is not given when there is no record or the newest record is a withdrawal", () => {
    expect(consentState(1, undefined)).toEqual({ granted: false, needsReconsent: false });
    expect(consentState(1, { action: "revoked", consentVersion: 1, createdAt: when })).toEqual({ granted: false, needsReconsent: false });
  });

  it("is given only for the current version of the wording", () => {
    expect(consentState(2, { action: "granted", consentVersion: 2, createdAt: when })).toEqual({ granted: true, needsReconsent: false });
  });

  it("needs to be given again when the wording has moved on", () => {
    expect(consentState(2, { action: "granted", consentVersion: 1, createdAt: when })).toEqual({ granted: false, needsReconsent: true });
  });
});
