import type { Metadata } from "next";
import Link from "next/link";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Callout, Card, PageHeader, Table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { assertCan } from "@/server/authz";
import { DELETION_UNDO_DAYS } from "@/server/services/children";
import { DELETION_STATEMENT, EXPORT_LINK_DAYS, getRetentionSummary, listDataRequests, type DataRequestView, type RetentionLine } from "@/server/services/data-request";
import { getFamily, isIndependentLearner, listChildren } from "@/server/services/family";
import { DeleteChildForm, DeleteFamilyForm, ExportForm, UndoDeletionForm } from "../_components/privacy-forms";

export const metadata: Metadata = { title: "Privacy and data" };

const EXPORT_STATUS: Record<DataRequestView["status"], string> = {
  requested: "Being put together",
  processing: "Being put together",
  ready: "Ready",
  completed: "Run out",
  cancelled: "Cancelled",
  failed: "Couldn't be made. Ask again",
};

function DeletionStatement() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card variant="plain" padding="sm" className="flex flex-col gap-2">
        <h3 className="font-bold">What is deleted</h3>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {DELETION_STATEMENT.deleted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <Card variant="plain" padding="sm" className="flex flex-col gap-2">
        <h3 className="font-bold">What we must keep</h3>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {DELETION_STATEMENT.kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * Privacy and data (spec 3.6, Section 9): what we hold and why, each child's permissions, a
 * download of a child's data, and deletion of a child's account or the whole family with 14 days
 * to undo. Everything is for the signed-in parent's own family.
 */
export default async function PrivacyPage() {
  const ctx = await requireParentPage();
  const { familyId, userId } = ctx.actor;
  assertCan(ctx.actor, "family.read", { familyId });
  const [children, requests, retention, family] = await Promise.all([listChildren(ctx, familyId), listDataRequests(ctx), getRetentionSummary(ctx), getFamily(ctx, familyId)]);
  const independent = new Set<string>();
  for (const child of children) if (await isIndependentLearner(ctx, child.learnerId)) independent.add(child.learnerId);

  const isOwner = family?.ownerUserId === userId;
  const exports = requests.filter((request) => request.kind === "export");
  const openDeletions = requests.filter((request) => request.kind === "delete" && (request.status === "requested" || request.status === "processing" || request.status === "failed"));
  const familyDeletion = openDeletions.find((request) => request.scope === "family");
  const deletionFor = (learnerId: string) => openDeletions.find((request) => request.learnerId === learnerId);
  const exportInProgress = (learnerId: string) => exports.some((request) => request.learnerId === learnerId && (request.status === "requested" || request.status === "processing"));
  const manageable = children.filter((child) => !independent.has(child.learnerId));

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <PageHeader title="Privacy and data" description="What we hold about your family and why, and how to get a copy of it or have it deleted." />

      {familyDeletion && (
        <Callout tone="danger" title={`Your family account will be deleted on ${familyDeletion.undoUntil ? formatDate(familyDeletion.undoUntil) : "the date we emailed you"}`}>
          <p>Your children&apos;s accounts are closed. Nothing has been deleted yet, and you can still change your mind.</p>
          {familyDeletion.canUndo && <UndoDeletionForm requestId={familyDeletion.id} label="Keep my family account" />}
        </Callout>
      )}

      <section aria-labelledby="hold-title" className="flex flex-col gap-4">
        <h2 id="hold-title" className="text-2xl font-bold">
          What we hold, and why
        </h2>
        <p>
          We keep as little as we can. A child&apos;s profile is a nickname, a birth month and year and a username: no real name, email address, photo, school or location. We never sell data or use it for advertising, and it is stored in the UK.
        </p>
        <Table<RetentionLine>
          caption="What we hold, why, and how long we keep it"
          hideCaption
          rowKey={(row) => row.key}
          rows={retention}
          columns={[
            { key: "what", header: "What", rowHeader: true, cell: (row) => row.what },
            { key: "why", header: "Why we hold it", cell: (row) => row.why },
            { key: "keptFor", header: "How long", cell: (row) => row.keptFor },
          ]}
        />
        <p>
          Projects are made in tools run by other companies. Those tools have their own terms, and what your child types into them is not held by us: we only have what they send back as their finished work. Our full{" "}
          <Link href="/legal/privacy" className="link">
            privacy notice
          </Link>{" "}
          has the detail.
        </p>
      </section>

      <section aria-labelledby="permissions-title" className="flex flex-col gap-4">
        <h2 id="permissions-title" className="text-2xl font-bold">
          Permissions
        </h2>
        <p>The permissions you have given for each child, in the exact words you agreed to. You can change them at any time.</p>
        {children.length === 0 ? (
          <p className="text-ink-muted">You haven&apos;t added a child yet.</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {children.map((child) => (
              <li key={child.learnerId}>
                <Link href={`/parent/children/${child.learnerId}/consent`} className="link">
                  {child.nickname}&apos;s permissions
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="download-title" className="flex flex-col gap-4">
        <h2 id="download-title" className="text-2xl font-bold">
          Download a child&apos;s data
        </h2>
        <p>
          You get a ZIP file with their profile, progress, accepted projects and the files we hold for them, certificates, the history of your permissions, and how Coach was used. We email you when it is ready. For your family&apos;s security the
          email only brings you back here: you download the file while signed in, within {EXPORT_LINK_DAYS} days.
        </p>
        <Callout tone="info" title="What is left out, and why">
          <p>
            The words of Coach chats, private notes, reflections and quiz answers are not in the download. We tell every learner that a parent or carer can&apos;t read these, so that they can ask questions freely. The counts and dates are
            included. If you need more, contact us and we will go through it with you.
          </p>
        </Callout>
        {manageable.length === 0 ? (
          <p className="text-ink-muted">There is nobody to download data for yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {manageable.map((child) => (
              <Card as="li" key={child.learnerId} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-bold">{child.nickname}</span>
                <ExportForm learnerId={child.learnerId} nickname={child.nickname} inProgress={exportInProgress(child.learnerId)} />
              </Card>
            ))}
          </ul>
        )}
        {exports.length > 0 && (
          <div id="downloads" className="flex scroll-mt-24 flex-col gap-2">
            <h3 className="font-bold">Your downloads</h3>
            <ul className="flex flex-col gap-2">
              {exports.map((request) => (
                <li key={request.id} className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2">
                  <span>
                    {request.learnerNickname ?? "A deleted account"}, asked for on {formatDate(request.requestedAt)}
                  </span>
                  <Badge tone={request.downloadReady ? "success" : "neutral"}>{request.status === "ready" && !request.downloadReady ? "Run out" : EXPORT_STATUS[request.status]}</Badge>
                  {request.downloadReady && request.exportExpiresAt && (
                    <>
                      <a href={`/api/v1/data-requests/${request.id}/download`} className="link font-bold">
                        Download the ZIP<span className="sr-only"> for {request.learnerNickname ?? "this account"}</span>
                      </a>
                      <span className="text-ink-muted text-sm">Available until {formatDate(request.exportExpiresAt)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="delete-title" className="flex flex-col gap-4">
        <h2 id="delete-title" className="text-2xl font-bold">
          Delete an account
        </h2>
        <p>
          Deleting closes the account straight away and removes everything in it {DELETION_UNDO_DAYS} days later. During those {DELETION_UNDO_DAYS} days nothing is removed and you can undo it from this page. After that it cannot be brought back. You may
          want to download a copy first.
        </p>
        <DeletionStatement />

        {children.length > 0 && (
          <ul className="flex flex-col gap-4">
            {children.map((child) => {
              const pending = deletionFor(child.learnerId);
              return (
                <Card as="li" key={child.learnerId} className="flex flex-col gap-3">
                  <h3 className="text-xl font-bold">{child.nickname}</h3>
                  {independent.has(child.learnerId) ? (
                    <p>{child.nickname} is 18 and runs their own account, so downloading or deleting their data is theirs to do, from their own settings.</p>
                  ) : pending ? (
                    <>
                      <p>
                        <strong>
                          {child.nickname}&apos;s account is closed and will be deleted{pending.undoUntil ? ` on ${formatDate(pending.undoUntil)}` : " soon"}.
                        </strong>{" "}
                        Nothing has been removed yet.
                      </p>
                      {pending.canUndo ? <UndoDeletionForm requestId={pending.id} label={`Keep ${child.nickname}'s account`} /> : <p className="text-ink-muted">The {DELETION_UNDO_DAYS} days have passed and the deletion is being carried out.</p>}
                    </>
                  ) : child.status === "pending_deletion" ? (
                    <p>{familyDeletion ? "This account is closed as part of deleting your family account." : `${child.nickname}'s account is closed and set to be deleted.`}</p>
                  ) : (
                    <DeleteChildForm learnerId={child.learnerId} nickname={child.nickname} undoDays={DELETION_UNDO_DAYS} />
                  )}
                </Card>
              );
            })}
          </ul>
        )}

        {!familyDeletion && (
          <Card className="flex flex-col gap-3">
            <h3 className="text-xl font-bold">The whole family account</h3>
            {isOwner ? (
              <>
                <p>
                  This deletes every child&apos;s account, your own account and any other parent or carer on it. Children&apos;s accounts close straight away; you can still sign in for {DELETION_UNDO_DAYS} days to undo it. If you have a paid plan,
                  it is cancelled when the deletion is carried out. An 18-year-old who runs their own account keeps it, on a free plan of their own.
                </p>
                <DeleteFamilyForm undoDays={DELETION_UNDO_DAYS} />
              </>
            ) : (
              <p>Only the person who set up this family account can delete all of it. You can still delete a child&apos;s account above.</p>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
