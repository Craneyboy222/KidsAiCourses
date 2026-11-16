import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Callout, LinkButton, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireParent } from "@/server/context";
import { isAppError } from "@/server/errors";
import { getAgeAssurance } from "@/server/services/age-assurance";
import { getConsentCentre, type ConsentCentre } from "@/server/services/consent";
import { getLearnerSummary, isIndependentLearner } from "@/server/services/family";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Permissions" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The consent centre for one child (spec 3.6). Three permissions the account needs and two that
 * are the parent's choice, each with its full plain-English wording. Until the three are given
 * the account is held; withdrawing one later pauses it.
 */
export default async function ChildConsentPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const from = (await searchParams).from;
  const ctx = await requireParent();

  let centre: ConsentCentre;
  try {
    centre = await getConsentCentre(ctx, id);
  } catch (error) {
    // Another family's child, or no such child: the same answer, so nothing is confirmed.
    if (isAppError(error) && (error.code === "forbidden" || error.code === "not_found")) notFound();
    throw error;
  }
  const learner = await getLearnerSummary(ctx, id);
  const independent = await isIndependentLearner(ctx, id);
  const assurance = await getAgeAssurance(ctx, id);
  const name = learner.nickname;

  const header = (
    <PageHeader
      title={`${name}'s permissions`}
      description="What we need your agreement for, in plain English. Each one shows the exact wording you are agreeing to."
      breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: name, href: `/parent/children/${id}` }, { label: "Permissions" }]} />}
      eyebrow={
        centre.complete ? <Badge tone="success">All needed permissions given</Badge> : <Badge tone="warning">{centre.missingRequired.length} still needed</Badge>
      }
    />
  );

  if (independent) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        {header}
        <Callout tone="info" title={`${name} is 18 and runs their own account`}>
          <p>These choices are now theirs to make, so they can&apos;t be changed from here. This is what currently stands.</p>
        </Callout>
        <ul className="flex flex-col gap-2">
          {centre.items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{item.title}</span>
              <Badge tone={item.granted ? "success" : "neutral"}>{item.granted ? "Given" : "Not given"}</Badge>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {header}
      {from === "approval" && !centre.complete && (
        <Callout tone="success" title={`${name} is now part of your family`}>
          <p>One last step: their account stays locked until you have given the three permissions below.</p>
        </Callout>
      )}
      {from === "new" && !centre.complete && (
        <Callout tone="info" title="Nearly there">
          <p>{name}&apos;s account stays locked until you have given the three permissions below.</p>
        </Callout>
      )}
      {learner.status === "pending_deletion" && (
        <Callout tone="warning" title="This account is set to be deleted">
          <p>
            You can undo that from your{" "}
            <Link href="/parent/privacy" className="link">
              Privacy page
            </Link>
            .
          </p>
        </Callout>
      )}

      <ConsentForm
        learnerId={id}
        nickname={name}
        from={from === "approval" ? "approval" : ""}
        accountInUse={learner.status === "active"}
        items={centre.items.map((item) => ({
          key: item.key,
          title: item.title,
          body: item.body,
          required: item.required,
          needsReconsent: item.needsReconsent,
          // Given already: ticked. Never decided and optional: the default for their age group (off for 13 to 15).
          defaultChecked: item.granted || (!item.required && item.decidedAt === null && item.defaultOn),
          decided: item.decidedAt ? `${item.granted ? "Given" : item.needsReconsent ? "Given for earlier wording" : "Withdrawn"} on ${formatDate(item.decidedAt)}` : null,
        }))}
      />

      {/* TODO(legal): the age-assurance method is a setting (`safety.age_assurance_mode`), to be confirmed with a lawyer before launch. This only explains what the current setting asks for. */}
      {centre.complete && !assurance.satisfied && assurance.missing.includes("card_or_subscription") && (
        <Callout
          tone="info"
          title={`One more step before ${name} can use Coach`}
          actions={
            <LinkButton href="/parent/billing" variant="secondary">
              Go to Billing
            </LinkButton>
          }
        >
          <p>
            Because {name} is under 16, we need to check that an adult is behind this account before they can use Coach, our AI helper. You can do that from your Billing page, with a card check that takes no money or by starting a plan. Everything else in their account works now.
          </p>
        </Callout>
      )}
      {centre.complete && !assurance.satisfied && assurance.missing.includes("parent_email") && (
        <Callout tone="info" title={`One more step before ${name} can use Coach`}>
          <p>Please confirm your own email address using the link we sent you. Sign out and in again to get a fresh one.</p>
        </Callout>
      )}
      {centre.complete && (
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/parent" variant="secondary">
            Back to your dashboard
          </LinkButton>
          <LinkButton href="/parent/children/new" variant="ghost">
            Add another child
          </LinkButton>
        </div>
      )}
    </div>
  );
}
