// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import type { SetupGuide, ToolRequirement } from "@/content/schema";

export type ToolsYouNeedProps = {
  courseId: string | null;
  courseSlug: string;
  toolRequirements: ToolRequirement[];
  setupGuides: Pick<SetupGuide, "id" | "toolSlug" | "title" | "lastVerifiedAt">[];
  /**
   * public: marketing course page. learner: shows this learner's approval state and "Ask a parent".
   * parent: the "what a parent would see" view with approval controls. staff: preview, shows unverified flags.
   */
  viewer: { kind: "public" } | { kind: "learner"; learnerId: string } | { kind: "parent"; familyId: string; learnerId?: string } | { kind: "staff" };
};

/**
 * "Tools you'll need" (spec 3.3): each tool's name, official link, cost or free tier, minimum age,
 * whether a parent must approve or set up the account, and the setup-guide link — all read from
 * the Tool Register at request time. Server Component. Placeholder until the tools slice lands.
 */
export async function ToolsYouNeed(_props: ToolsYouNeedProps) {
  return null;
}
