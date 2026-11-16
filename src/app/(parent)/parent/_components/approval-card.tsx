"use client";

import Link from "next/link";
import { ActionForm, Badge, Callout, Card, Checkbox, ExternalToolLink, FormError, LinkButton, SubmitButton, useActionForm } from "@/components/ui";
import { decideApprovalAction, revokeApprovalAction } from "../approvals/actions";

export type ApprovalCardItem = {
  source: "tool" | "unlock";
  id: string;
  kind: "tool_consent" | "parent_operated" | "paid_course" | "pro_course";
  learnerNickname: string;
  courseTitle: string;
  status: "pending" | "approved" | "declined" | "revoked";
  /** Already formatted for display, UK time. */
  requestedOn: string;
  tool: {
    name: string;
    vendorDomain: string | null;
    officialUrl: string | null;
    cost: string | null;
    freeTier: string | null;
    minAge: number | null;
    consentRule: string | null;
    lastCheckedOn: string | null;
    available: boolean;
  } | null;
  guideHref: string | null;
};

const KIND_LABEL: Record<ApprovalCardItem["kind"], string> = {
  tool_consent: "Tool approval",
  parent_operated: "Tool you would run",
  paid_course: "Unlock a course",
  pro_course: "Pro course",
};

const STATUS: Record<ApprovalCardItem["status"], { label: string; tone: "warning" | "success" | "neutral" }> = {
  pending: { label: "Waiting for you", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  revoked: { label: "Approval removed", tone: "neutral" },
};

function title(item: ApprovalCardItem): string {
  const who = item.learnerNickname;
  switch (item.kind) {
    case "tool_consent":
      return `${who} would like to use ${item.tool?.name ?? "a tool"}`;
    case "parent_operated":
      return `${who} needs you to set up ${item.tool?.name ?? "a tool"}`;
    case "paid_course":
      return `${who} would like to unlock “${item.courseTitle}”`;
    case "pro_course":
      return `${who} would like to start “${item.courseTitle}”`;
  }
}

/** What the tool is, what its own terms say, and what saying yes means, in plain English. */
function Explanation({ item }: { item: ApprovalCardItem }) {
  const who = item.learnerNickname;
  const tool = item.tool;
  if (tool) {
    const operated = item.kind === "parent_operated";
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">What it is</h3>
          <p>
            {tool.name} is a tool made by another company{tool.vendorDomain ? ` (${tool.vendorDomain})` : ""}, not by us. The course “{item.courseTitle}” uses it for the project work. It is not part of our site: {who} would use it in
            another tab.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">Its terms</h3>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            <li>{tool.minAge !== null ? `Its own terms set a minimum age of ${tool.minAge}.` : "We have no minimum age on record for it."}</li>
            {tool.consentRule && <li>{tool.consentRule}</li>}
            <li>{tool.freeTier ? `Free plan: ${tool.freeTier}` : "The course is designed to be done on the tool's free plan."}</li>
            {tool.cost && <li>Paid plans: {tool.cost}. Nothing in the course needs one.</li>}
            <li>
              It has its own terms and privacy policy. Anything typed into {tool.name} is handled by that company, not by us. We only ever see what {who} sends back to us as their finished work.
            </li>
          </ul>
          {tool.officialUrl && (
            <p>
              <ExternalToolLink href={tool.officialUrl} toolName={tool.name} allowed>
                Visit {tool.name}&apos;s own site to read its terms
              </ExternalToolLink>
            </p>
          )}
          {tool.lastCheckedOn && <p className="text-ink-muted text-sm">We last checked these details on {tool.lastCheckedOn}.</p>}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">What approving means</h3>
          {operated ? (
            <p>
              {tool.name} does not allow accounts for under-18s. Approving means <strong>you</strong> create the account in your own name, keep the sign-in details to yourself, and stay with {who} while they use it for this course. The setup guide is
              written for you.
            </p>
          ) : (
            <p>
              {who} can create their own {tool.name} account and use it for this one course. Each course asks separately. You can remove your approval at any time, which stops the setup steps straight away. We will never ask you or {who} for
              a password or code for {tool.name}.
            </p>
          )}
          <p>If you decline, {who} is told in the app and can ask you about it. Nothing else changes.</p>
        </div>
        {item.guideHref && (
          <p>
            <Link href={item.guideHref} className="link font-bold">
              Read the setup guide for {tool.name}
            </Link>
          </p>
        )}
      </div>
    );
  }
  if (item.kind === "paid_course") {
    return (
      <div className="flex flex-col gap-2">
        <p>“{item.courseTitle}” is not part of your current plan, so {who} has asked you to unlock it. They are never shown prices.</p>
        <p>
          <strong>What approving means:</strong> nothing is charged and nothing unlocks yet. You are taken to choose a plan, and the course opens for {who} once a plan that covers it is in place.
        </p>
        <p>If you decline, {who} is told “not this one for now” and can&apos;t ask again about this course for a week.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p>“{item.courseTitle}” is a Pro course, our hardest level. You asked to be consulted before {who} starts one.</p>
      <p>
        <strong>What approving means:</strong> {who} can start this course straight away. Other Pro courses will still ask you first. Any outside tool the course uses asks for its own approval.
      </p>
      <p>If you decline, {who} is told in the app and can&apos;t ask again about this course for a week.</p>
    </div>
  );
}

function Outcome({ status, item, nextHref }: { status: ApprovalCardItem["status"]; item: ApprovalCardItem; nextHref: string | null }) {
  const who = item.learnerNickname;
  if (status === "approved" && nextHref) {
    return (
      <Callout tone="success" title="Approved. One more step" live="status" actions={<LinkButton href={nextHref}>Choose a plan</LinkButton>}>
        <p>“{item.courseTitle}” opens for {who} once your plan covers it.</p>
      </Callout>
    );
  }
  if (status === "approved") {
    return (
      <Callout tone="success" title="Approved" live="status">
        <p>We&apos;ve let {who} know in the app.</p>
      </Callout>
    );
  }
  if (status === "revoked") {
    return (
      <Callout tone="info" title="Your approval has been removed" live="status">
        <p>We&apos;ve let {who} know. Their work is saved.</p>
      </Callout>
    );
  }
  return (
    <Callout tone="info" title="Declined" live="status">
      <p>We&apos;ve let {who} know in the app.</p>
    </Callout>
  );
}

/** One request with its explanation and the buttons to answer it. */
export function ApprovalCard({ item, headingLevel = "h2" }: { item: ApprovalCardItem; headingLevel?: "h2" | "h3" }) {
  const decide = useActionForm(decideApprovalAction);
  const revoke = useActionForm(revokeApprovalAction);
  const status = revoke.data?.status ?? decide.data?.status ?? item.status;
  const Heading = headingLevel;
  const operated = item.kind === "parent_operated";
  const unavailable = item.tool !== null && !item.tool.available;

  return (
    <Card as="article" className="flex flex-col gap-4" data-approval={`${item.source}:${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{KIND_LABEL[item.kind]}</Badge>
        <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
        <span className="text-ink-muted text-sm">Asked on {item.requestedOn}</span>
      </div>
      <Heading className="text-xl font-bold">{title(item)}</Heading>
      {(decide.data || revoke.data) && <Outcome status={status} item={item} nextHref={decide.data?.nextHref ?? null} />}

      {status === "pending" && (
        <>
          <Explanation item={item} />
          {unavailable && (
            <Callout tone="warning" title={`${item.tool?.name} isn't available at the moment`}>
              <p>We&apos;re checking something about this tool, so it can&apos;t be approved right now. You can decline the request, or leave it until the tool is back.</p>
            </Callout>
          )}
          <ActionForm action={decide.formAction} aria-label={`Answer: ${title(item)}`} className="gap-3">
            <FormError {...decide.summaryProps} fieldLabels={{ parentWillOperate: "Confirmation" }} />
            <input type="hidden" name="source" value={item.source} />
            <input type="hidden" name="id" value={item.id} />
            {operated && (
              <Checkbox
                name="parentWillOperate"
                label={`I will set up the ${item.tool?.name ?? "tool"} account myself and stay in charge of it`}
                description="Needed to approve. The account is yours, in your name."
                error={decide.fieldError("parentWillOperate")}
              />
            )}
            <div className="flex flex-wrap gap-3">
              {!unavailable && (
                <SubmitButton name="decision" value="approve" loading={decide.pending} pendingText="Saving…">
                  Approve
                </SubmitButton>
              )}
              <SubmitButton name="decision" value="decline" variant="secondary" loading={decide.pending} pendingText="Saving…">
                Decline
              </SubmitButton>
            </div>
          </ActionForm>
        </>
      )}

      {status === "approved" && item.source === "tool" && (
        <div className="flex flex-col gap-3">
          <p>
            {operated
              ? `You said you would set up and run ${item.tool?.name ?? "this tool"} for “${item.courseTitle}”.`
              : `${item.learnerNickname} may use ${item.tool?.name ?? "this tool"} for “${item.courseTitle}”.`}{" "}
            {item.guideHref && (
              <Link href={item.guideHref} className="link">
                Read the setup guide
              </Link>
            )}
          </p>
          <ActionForm action={revoke.formAction} aria-label={`Remove approval: ${title(item)}`}>
            <FormError {...revoke.summaryProps} />
            <input type="hidden" name="id" value={item.id} />
            <div>
              <SubmitButton variant="ghost" size="sm" loading={revoke.pending} pendingText="Removing…">
                Remove my approval
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}
    </Card>
  );
}
