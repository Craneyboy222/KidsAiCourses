import { env } from "@/env";

/**
 * "Does this picture or video show a real person?" behind one interface (decision D3).
 *
 * No classifier is in the approved stack, so the default is `manual`: it never says "clear", which
 * means an image or video FILE is never accepted without a person looking at it. `fixture` is for
 * tests only and reads a marker in the bytes. A real provider is a data processor: it can be added
 * here only after the owner approves it and a DPA is on record.
 */
export type PeopleVerdict =
  /** Checked, and nobody real is in it. Only an automatic detector can say this. */
  | "clear"
  /** It appears to show a real person: rejected and deleted at once while people screening is off. */
  | "people"
  /** Not checked by a machine: a person must look. */
  | "needs_human"
  /** Possibly illegal: quarantined, never deleted, and a critical safeguarding case is opened. */
  | "illegal_suspected";

export type PeopleDetectionInput = { bytes: Buffer; mime: string; kind: "screenshot" | "video" };

export interface PeopleDetector {
  readonly name: string;
  detect(input: PeopleDetectionInput): Promise<PeopleVerdict>;
}

export const manualDetector: PeopleDetector = {
  name: "manual",
  detect: async () => "needs_human",
};

export const FIXTURE_MARKERS = { people: "fixture:people", illegal: "fixture:illegal", unsure: "fixture:unsure" } as const;

/** Tests only. A file containing one of the markers gets that verdict; anything else is clear. */
export const fixtureDetector: PeopleDetector = {
  name: "fixture",
  detect: async ({ bytes }) => {
    if (bytes.includes(FIXTURE_MARKERS.illegal)) return "illegal_suspected";
    if (bytes.includes(FIXTURE_MARKERS.people)) return "people";
    if (bytes.includes(FIXTURE_MARKERS.unsure)) return "needs_human";
    return "clear";
  },
};

let override: PeopleDetector | undefined;

/** Test helper: swap in a detector, or pass `undefined` to go back to the configured one. */
export function setPeopleDetector(detector: PeopleDetector | undefined): void {
  override = detector;
}

export function getPeopleDetector(): PeopleDetector {
  if (override) return override;
  // The fixture detector calls everything without a marker "clear". It must never run for real children.
  if (env.PEOPLE_DETECTION_PROVIDER === "fixture" && (env.APP_ENV === "test" || env.APP_ENV === "local")) return fixtureDetector;
  return manualDetector;
}
