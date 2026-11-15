import type { SafetyBand } from "@/server/authz/actor";

/**
 * CONTRACT (lead). How the course page and player are being used.
 *  - live: a learner on their own enrolment. Progress, analytics and certificates are real.
 *  - preview: staff looking at a draft through the real page and player. Nothing is recorded:
 *    no enrolment, no analytics, no certificate, nothing a parent could see (spec 6.3).
 */
export type PlayerMode =
  | { kind: "live"; enrolmentId: string; learnerId: string }
  | { kind: "preview"; versionId: string; asBand: SafetyBand; canEdit: boolean };

export const isPreview = (mode: PlayerMode): mode is Extract<PlayerMode, { kind: "preview" }> => mode.kind === "preview";
