import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Breadcrumbs, Callout, Card, ExternalToolLink, LastVerified, LinkButton, Markdown, PageHeader } from "@/components/ui";
import type { SetupGuide } from "@/content/schema";
import { getToolGuideForParent } from "@/server/services/approvals";
import { UUID, loadOr404 } from "../../../_lib/view";

export const metadata: Metadata = { title: "Setup guide" };

type Props = { params: Promise<{ id: string }> };

const KIND_LABELS: Record<SetupGuide["steps"][number]["kind"], string> = {
  create_account: "Create the account",
  verify_email: "Verify the email",
  choose_free_plan: "Stay on the free plan",
  privacy_settings: "Privacy settings",
  do_in_tool: "In the tool",
  export: "Export",
  other: "Step",
};

/**
 * The setup guide for a tool a parent has been asked to approve, or to set up and run themselves
 * (spec 3.3). It is the guide from the published course, read at request time: the same steps the
 * child is shown. Reached through the request, so only the family that received the request can
 * open it; any other id is not found.
 */
export default async function ApprovalGuidePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireParentPage();
  const { approval, purpose, guide, media } = await loadOr404(() => getToolGuideForParent(ctx, id));
  const tool = approval.tool;
  if (!tool) notFound();
  const operated = approval.kind === "parent_operated";
  const who = approval.learnerNickname;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Setting up ${tool.name}`}
        description={`For “${approval.courseTitle}”, which ${who} ${approval.status === "approved" ? "is doing" : "would like to start"}.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: "Approvals", href: "/parent/approvals" }, { label: `${tool.name} setup guide` }]} />}
        eyebrow={<Badge tone={operated ? "warning" : "info"}>{operated ? "You set this one up" : "Your child sets this up"}</Badge>}
        actions={
          approval.status === "pending" ? (
            <LinkButton href="/parent/approvals" variant="secondary">
              Back to answer the request
            </LinkButton>
          ) : undefined
        }
      />

      {operated ? (
        <Callout tone="warning" title={`${tool.name} is for adults to run`}>
          <p>
            Its terms don&apos;t allow accounts for under-18s. If you approve, you create the account in your own name using the steps below, keep the sign-in details to yourself, and stay with {who} while they use it for this course.
          </p>
        </Callout>
      ) : (
        <Callout tone="info" title={`These are the steps ${who} will follow`}>
          <p>You don&apos;t need to do anything here yourself. This is so you can see exactly what {who} will be asked to click and enter before you decide.</p>
        </Callout>
      )}
      <Callout tone="info" title="Keep sign-in details private">
        <p>Never type a password, a code from an email or text, or card details for {tool.name} anywhere on our site. We will never ask for them, and neither will Coach, our AI helper.</p>
      </Callout>

      <section aria-labelledby="about-title" className="flex flex-col gap-2">
        <h2 id="about-title" className="text-2xl font-bold">
          About {tool.name}
        </h2>
        {purpose && <p>In this course it is used for: {purpose}</p>}
        <ul className="flex list-disc flex-col gap-1 pl-6">
          <li>{tool.minAge !== null ? `Minimum age under its own terms: ${tool.minAge}.` : "We have no minimum age on record for it."}</li>
          {tool.consentRule && <li>{tool.consentRule}</li>}
          <li>{tool.freeTier ? `Free plan: ${tool.freeTier}` : "The course is designed to be done on the free plan."}</li>
          {tool.cost && <li>Paid plans: {tool.cost}. Nothing in the course needs one.</li>}
        </ul>
        {tool.officialUrl && tool.available && (
          <p>
            <ExternalToolLink href={tool.officialUrl} toolName={tool.name} allowed>
              Open {tool.name}&apos;s own site
            </ExternalToolLink>
          </p>
        )}
        {!tool.available && <p className="font-bold">{tool.name} isn&apos;t available to use at the moment while we check something about it.</p>}
      </section>

      <section aria-labelledby="steps-title" className="flex flex-col gap-4">
        <h2 id="steps-title" className="text-2xl font-bold">
          {guide ? guide.title : "Setup steps"}
        </h2>
        {guide ? (
          <>
            <LastVerified date={guide.lastVerifiedAt} prefix="Guide last checked" />
            <ol className="flex flex-col gap-4">
              {guide.steps.map((step, index) => (
                <Card as="li" key={step.id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{`${index + 1} of ${guide.steps.length}`}</Badge>
                    <Badge tone="info">{KIND_LABELS[step.kind]}</Badge>
                  </div>
                  <h3 className="text-xl font-bold">{step.title}</h3>
                  <Markdown topHeadingLevel={4}>{step.body}</Markdown>
                  {(step.screenshotAssetIds ?? []).map((assetId) => {
                    const asset = media[assetId];
                    if (!asset) return null;
                    return asset.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link cannot go through the image optimiser
                      <img key={assetId} src={asset.url} alt={asset.altText ?? ""} loading="lazy" decoding="async" className="rounded-card border-ink bg-tint aspect-video w-full border-2 object-contain" />
                    ) : (
                      <p key={assetId} className="rounded-card border-ink bg-tint border-2 border-dashed p-4">
                        <span className="font-bold">Picture: </span>
                        {asset.altText ?? "a screenshot of this step"}
                      </p>
                    );
                  })}
                </Card>
              ))}
            </ol>
            <p className="text-ink-muted">If a screen in {tool.name} no longer matches these steps, {who} can use “This doesn&apos;t match what I see” on the step, and our team will check the guide.</p>
          </>
        ) : (
          <Callout tone="warning" title="We couldn't show the guide just now">
            <p>The setup steps for {tool.name} aren&apos;t available at the moment. Try again later, or wait before deciding.</p>
          </Callout>
        )}
      </section>
    </div>
  );
}
