// CONTRACT — owner: Studio content slice. See _contract.ts.
import type { Ctx } from "@/server/context";
import type { SafetyBand } from "@/server/authz";
import type { Course } from "@/content/schema";
import { notImplemented } from "./_contract";

export type PreviewSession = {
  versionId: string;
  courseId: string;
  revision: number;
  /** The full draft, including internal fields: staff only. */
  content: Course;
  /** Which safety band the staff member is testing as. */
  asBand: SafetyBand;
  canEdit: boolean;
};

/**
 * Resolves a staff preview of a draft. Requires a signed-in staff member with a verified second
 * factor and `course.preview`; a preview token narrows access to one version and can be revoked.
 * Returns null for everyone else (learners, parents, signed-out visitors, a guessed slug): callers
 * must then respond exactly as for a course that does not exist.
 */
export async function resolvePreview(_ctx: Ctx, _input: { versionId?: string; token?: string; asBand?: SafetyBand }): Promise<PreviewSession | null> {
  return notImplemented("preview.resolvePreview");
}
