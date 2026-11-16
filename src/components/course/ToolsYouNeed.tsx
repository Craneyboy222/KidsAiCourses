// CONTRACT — owner: tools and submissions slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import { CircleCheck, CircleSlash, Clock, UserRoundCheck, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { Badge, Callout, Card, ExternalToolLink, LastVerified } from "@/components/ui";
import type { SetupGuide, ToolRequirement } from "@/content/schema";
import { getCtx, type Ctx } from "@/server/context";
import { course, step } from "@/server/db";
import { approvalFactsFor, courseVersionFor, toolsOnHold } from "@/server/services/course-tools";
import { getLearnerSummary } from "@/server/services/family";
import { approvalIsValid, type ApprovalFacts } from "@/server/services/start-rules";
import { listToolApprovalsForCourse, type ToolApprovalView } from "@/server/services/tool-approval";
import { DEV_SEED_NOTE, getToolsBySlugs, toolViewForLearners, type LearnerToolView, type ToolRow } from "@/server/services/tools";
import { AskParentForTool, ParentToolDecision, ParentToolRevoke } from "./ToolsYouNeedActions";

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

type Guide = ToolsYouNeedProps["setupGuides"][number];

/** What is known about the person the tools are being shown for. Null when there is nobody in particular. */
type Person = { learnerId: string; name: string; age: number; approvals: Map<string, ToolApprovalView>; facts: Record<string, ApprovalFacts | undefined> };

/**
 * The learner this view is about, with their approvals for this course. Read through the same
 * checks as everything else, so a learner id that the signed-in person may not ask about simply
 * gives no personal detail (a staff preview "as a learner", for instance).
 */
async function loadPerson(ctx: Ctx, viewer: ToolsYouNeedProps["viewer"], courseId: string | null, tools: readonly ToolRow[]): Promise<Person | null> {
  const learnerId = viewer.kind === "learner" ? viewer.learnerId : viewer.kind === "parent" ? viewer.learnerId : undefined;
  if (!learnerId || !courseId) return null;
  if (viewer.kind === "parent" && (ctx.actor.type !== "parent" || ctx.actor.familyId !== viewer.familyId)) return null;
  try {
    const approvals = await listToolApprovalsForCourse(ctx, { learnerId, courseId });
    const summary = await getLearnerSummary(ctx, learnerId);
    const facts = await approvalFactsFor(ctx, learnerId, courseId, tools);
    return { learnerId, name: summary.nickname, age: summary.age, approvals: new Map(approvals.map((entry) => [entry.toolSlug, entry])), facts };
  } catch {
    return null;
  }
}

/** Where each tool's setup guide sits in the player, for a learner. Empty when the course has no published steps to point at. */
async function guideLinks(ctx: Ctx, courseId: string | null, courseSlug: string, learnerId: string | undefined): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (!courseId || !learnerId) return links;
  const [target] = await ctx.db.select({ id: course.id, publishedVersionId: course.publishedVersionId }).from(course).where(eq(course.id, courseId)).limit(1);
  const versionId = target ? await courseVersionFor(ctx, learnerId, target) : null;
  if (!versionId) return links;
  const rows = await ctx.db.select({ key: step.key, toolSlug: step.toolSlug, position: step.position }).from(step).where(and(eq(step.courseVersionId, versionId), eq(step.type, "setup_guide"), eq(step.disabled, false)));
  for (const row of rows.sort((a, b) => a.position - b.position)) {
    if (row.toolSlug && !links.has(row.toolSlug)) links.set(row.toolSlug, `/learn/${courseSlug}/${row.key}`);
  }
  return links;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-muted text-sm font-bold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const WHO_SETS_UP: Record<LearnerToolView["under18Policy"], string> = {
  allowed: "You can set up your own account by following the guide.",
  parent_consent_required: "A parent or carer needs to say yes before you use it.",
  parent_operated: "A parent or carer sets up the account and stays in charge of it. Ask a parent to set this up.",
};
const WHO_SETS_UP_PARENT: Record<LearnerToolView["under18Policy"], string> = {
  allowed: "Your child can set up their own account by following our guide.",
  parent_consent_required: "This tool asks for a parent or carer's permission before someone under 18 uses it.",
  parent_operated: "This tool does not allow accounts for under-18s. You set up the account and stay in charge of it; your child uses it with you.",
};

/** Flags for staff previewing a draft: everything about this tool that has not been verified by a person. */
function staffFlags(row: ToolRow | undefined, guide: Guide | undefined, required: boolean, onHold: boolean): string[] {
  if (!row) return ["Not in the Tool Register"];
  const flags: string[] = [];
  if (row.status !== "approved") flags.push(`Register status: ${row.status.replace(/_/g, " ")}`);
  if (row.under18Policy === null) flags.push("No under-18 policy set");
  if (row.under18Policy === "blocked") flags.push("Blocked for under-18s");
  if (row.minAge === null) flags.push("Minimum age not verified");
  if (row.verifiedAt === null) flags.push("Not verified by a person");
  if (row.lastCheckedAt === null) flags.push("Never checked");
  if (row.officialUrl === null) flags.push("No official link");
  if (row.cost === null && row.freeTier === null) flags.push("No cost or free-plan details");
  if ((row.notes ?? "").includes(DEV_SEED_NOTE)) flags.push("Development seed: not checked against the vendor's live terms");
  if (onHold) flags.push("Open age-policy change: Start is on hold");
  if (required && !guide) flags.push("No setup guide in this course");
  return flags;
}

function LearnerState({ person, view, courseId, onHold }: { person: Person; view: LearnerToolView; courseId: string; onHold: boolean }) {
  if (person.age >= 18) return null;
  if (view.minAge !== null && person.age < view.minAge && !view.parentMustSetUp) {
    return <Badge tone="warning" icon={<CircleSlash aria-hidden="true" className="size-4" />}>For ages {view.minAge} and over</Badge>;
  }
  if (onHold) return <Badge tone="warning" icon={<Clock aria-hidden="true" className="size-4" />}>On hold while we re-check its rules</Badge>;
  if (!view.parentMustApprove) return <Badge tone="success" icon={<CircleCheck aria-hidden="true" className="size-4" />}>Ready to use</Badge>;
  const approval = person.approvals.get(view.slug);
  // An approval given before the tool became parent-operated no longer counts: the learner asks again.
  if (approvalIsValid(view.under18Policy, person.facts[view.slug])) {
    return <Badge tone="success" icon={<UserRoundCheck aria-hidden="true" className="size-4" />}>{view.parentMustSetUp ? "Your parent is setting this up" : "Approved by your parent"}</Badge>;
  }
  if (approval?.status === "pending") return <Badge tone="info" icon={<Clock aria-hidden="true" className="size-4" />}>Waiting for your parent to decide</Badge>;
  return (
    <div className="flex flex-col items-start gap-2">
      {approval?.status === "declined" && <Badge tone="warning">Your parent said no last time</Badge>}
      {approval?.status === "revoked" && <Badge tone="warning">Switched off by your parent</Badge>}
      <AskParentForTool courseId={courseId} toolSlug={view.slug} toolName={view.name} parentSetsUp={view.parentMustSetUp} />
    </div>
  );
}

function ParentState({ person, view, courseId }: { person: Person; view: LearnerToolView; courseId: string }) {
  if (!view.parentMustApprove || person.age >= 18) return null;
  const approval = person.approvals.get(view.slug);
  if (approval && approvalIsValid(view.under18Policy, person.facts[view.slug])) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Badge tone="success" icon={<UserRoundCheck aria-hidden="true" className="size-4" />}>You approved this for {person.name}</Badge>
        <ParentToolRevoke approvalId={approval.id} toolName={view.name} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {approval?.status === "pending" && <Badge tone="info" icon={<Clock aria-hidden="true" className="size-4" />}>{person.name} has asked you about this</Badge>}
      {approval?.status === "declined" && <Badge tone="neutral">You declined this</Badge>}
      {approval?.status === "revoked" && <Badge tone="neutral">You removed your approval</Badge>}
      <ParentToolDecision learnerId={person.learnerId} courseId={courseId} toolSlug={view.slug} toolName={view.name} childName={person.name} parentSetsUp={view.parentMustSetUp} declined={approval?.status === "declined"} />
    </div>
  );
}

/**
 * "Tools you'll need" (spec 3.3): each tool's name, official link, cost or free tier, minimum age,
 * whether a parent must approve or set up the account, and the setup-guide link — all read from
 * the Tool Register at request time. Server Component.
 *
 * Nothing about a tool is taken from the course: a course names a tool by slug and the facts come
 * from the Register now. A tool that is not approved in the Register is never shown as usable and
 * never linked. The only money mentioned is what the tool's own vendor charges, in the Register's
 * words; our own plans and prices never appear here.
 */
export async function ToolsYouNeed({ courseId, courseSlug, toolRequirements, setupGuides, viewer }: ToolsYouNeedProps) {
  if (toolRequirements.length === 0) {
    return (
      <section aria-labelledby="course-tools" className="flex flex-col gap-3">
        <h2 id="course-tools" className="text-2xl font-bold">
          Tools you&apos;ll need
        </h2>
        <p>You don&apos;t need any other tools for this course.</p>
      </section>
    );
  }

  const ctx = await getCtx();
  const slugs = toolRequirements.flatMap((entry) => (entry.fallbackToolSlug ? [entry.toolSlug, entry.fallbackToolSlug] : [entry.toolSlug]));
  const register = await getToolsBySlugs(ctx, slugs);
  const rows = [...register.values()];
  const person = await loadPerson(ctx, viewer, courseId, rows);
  const [held, guides] = await Promise.all([toolsOnHold(ctx, rows.map((row) => row.id)), guideLinks(ctx, courseId, courseSlug, viewer.kind === "learner" && person ? person.learnerId : undefined)]);
  const staff = viewer.kind === "staff";
  const forParent = viewer.kind === "parent";
  const whoSetsUp = forParent ? WHO_SETS_UP_PARENT : WHO_SETS_UP;

  return (
    <section aria-labelledby="course-tools" className="flex flex-col gap-4">
      <h2 id="course-tools" className="text-2xl font-bold">
        Tools you&apos;ll need
      </h2>
      <p className="text-ink-muted">
        {forParent
          ? "Your child builds their project in these tools, on the tool's own site. We check each one's rules for under-18s and write a setup guide for it."
          : "You build your project in these tools, on their own sites. We've checked each one's rules and written a setup guide for it."}
      </p>
      <ul className="flex list-none flex-col gap-4 p-0">
        {toolRequirements.map((requirement) => {
          const row = register.get(requirement.toolSlug);
          const view = row ? toolViewForLearners(row) : null;
          const guide = setupGuides.find((entry) => entry.toolSlug === requirement.toolSlug);
          const onHold = row ? held.has(row.id) : false;
          const fallbackRow = requirement.fallbackToolSlug ? register.get(requirement.fallbackToolSlug) : undefined;
          const fallback = fallbackRow ? toolViewForLearners(fallbackRow) : null;
          const flags = staff ? staffFlags(row, guide, requirement.required, onHold) : [];
          const name = row?.name ?? requirement.toolSlug;
          const guideHref = guides.get(requirement.toolSlug);

          return (
            <li key={requirement.toolSlug}>
              <Card as="article" className="flex flex-col gap-4">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="flex items-center gap-2 text-xl font-bold">
                      <Wrench aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
                      {name}
                    </h3>
                    <p>{requirement.purpose}</p>
                  </div>
                  <Badge tone={requirement.required ? "accent" : "neutral"}>{requirement.required ? "Needed" : "Optional"}</Badge>
                </header>

                {view ? (
                  <>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <Fact label="Official site">{view.officialUrl ? <ExternalToolLink href={view.officialUrl} toolName={view.name} allowed /> : "Link coming soon"}</Fact>
                      <Fact label="Cost">{view.freeTier ?? view.cost ?? "Not listed yet"}</Fact>
                      {view.freeTier && view.cost && <Fact label="If a parent chose to pay the tool">{view.cost}</Fact>}
                      <Fact label="Minimum age">{view.minAge !== null ? `${view.minAge} and over, under ${view.name}'s own rules` : "Not listed yet"}</Fact>
                      <Fact label={forParent ? "What you need to do" : "Who sets it up"}>{whoSetsUp[view.under18Policy]}</Fact>
                      <Fact label="Setup guide">
                        {guide ? (
                          <span className="flex flex-col gap-1">
                            {guideHref ? (
                              <Link href={guideHref} className="link">
                                {guide.title}
                              </Link>
                            ) : (
                              <span>{guide.title}: it&apos;s one of the first steps in the course</span>
                            )}
                            <LastVerified date={guide.lastVerifiedAt} prefix="Guide last checked" />
                          </span>
                        ) : (
                          "No guide needed"
                        )}
                      </Fact>
                    </dl>
                    {view.lastCheckedAt && <LastVerified date={view.lastCheckedAt} prefix={`${view.name}'s rules last checked`} />}
                    {person && courseId && viewer.kind === "learner" && <LearnerState person={person} view={view} courseId={courseId} onHold={onHold} />}
                    {person && courseId && forParent && <ParentState person={person} view={view} courseId={courseId} />}
                    {forParent && !person && view.parentMustApprove && <p className="text-ink-muted">You&apos;ll be asked to approve this for each child before they start.</p>}
                  </>
                ) : (
                  <Callout tone="warning" title={`${name} isn't available at the moment`}>
                    {fallback ? (
                      <p>
                        You can use {fallback.name} for this course instead. {fallback.officialUrl && <ExternalToolLink href={fallback.officialUrl} toolName={fallback.name} allowed />}
                      </p>
                    ) : (
                      <p>We&apos;re checking this tool, so the course can&apos;t be started just yet.</p>
                    )}
                  </Callout>
                )}

                {view && fallback && (
                  <p className="text-ink-muted text-sm">
                    If {view.name} isn&apos;t right for you, {fallback.name} works for this course too.
                  </p>
                )}

                {flags.length > 0 && (
                  <Callout tone="danger" title="Staff only: not yet verified">
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {flags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
