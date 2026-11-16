import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Badge, Breadcrumbs, Callout, Card, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getCtx } from "@/server/context";
import { DELETION_UNDO_DAYS } from "@/server/services/children";
import { DELETION_STATEMENT, EXPORT_LINK_DAYS, listDataRequests } from "@/server/services/data-request";
import { resolveAfterSignIn } from "@/server/services/sign-in";
import { DeleteOwnAccountForm, KeepOwnAccountForm, OwnExportForm } from "./privacy-forms";

export const metadata: Metadata = { title: "Your data" };

/**
 * Download or delete your own data, for learners aged 18 (spec 3.6; parents brief). For anyone
 * under 18 this page does not exist: a parent or carer does this for them. It stays available
 * while the account is waiting to be deleted, because this is where that is undone.
 */
export default async function OwnPrivacyPage() {
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") redirect("/signin?next=%2Fsettings%2Fprivacy");
  if (ctx.actor.type !== "learner") redirect((await resolveAfterSignIn(ctx)).path);
  if (ctx.actor.safetyBand !== "adult_18") notFound();

  const requests = await listDataRequests(ctx);
  const exports = requests.filter((request) => request.kind === "export");
  const deletion = requests.find((request) => request.kind === "delete" && (request.status === "requested" || request.status === "processing" || request.status === "failed"));
  const exportInProgress = exports.some((request) => request.status === "requested" || request.status === "processing");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Your data" }]} />} title="Your data" description="You're 18, so this is yours to decide: get a copy of everything we hold about you, or delete your account." />

      {deletion && (
        <Callout tone="danger" title={`Your account will be deleted on ${deletion.undoUntil ? formatDate(deletion.undoUntil) : "the date we told you"}`}>
          <p>Nothing has been deleted yet. Until that date you can change your mind.</p>
          {deletion.canUndo && <KeepOwnAccountForm requestId={deletion.id} />}
        </Callout>
      )}

      <section aria-labelledby="download-title" className="flex flex-col gap-4">
        <h2 id="download-title" className="text-2xl font-bold">
          Download your data
        </h2>
        <p>
          A ZIP file with your profile, progress, notes and reflections, projects and the files we hold, certificates, permissions, and your Coach chats that we still have. It stays here for {EXPORT_LINK_DAYS} days, and only you can download it.
        </p>
        <OwnExportForm inProgress={exportInProgress} />
        {exports.length > 0 && (
          <ul className="flex flex-col gap-2">
            {exports.map((request) => (
              <li key={request.id} className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2">
                <span>Asked for on {formatDate(request.requestedAt)}</span>
                <Badge tone={request.downloadReady ? "success" : "neutral"}>
                  {request.downloadReady ? "Ready" : request.status === "requested" || request.status === "processing" ? "Being put together" : request.status === "failed" ? "Couldn't be made. Ask again" : "Run out"}
                </Badge>
                {request.downloadReady && request.exportExpiresAt && (
                  <>
                    <a href={`/api/v1/data-requests/${request.id}/download`} className="link font-bold">
                      Download the ZIP
                    </a>
                    <span className="text-ink-muted text-sm">Available until {formatDate(request.exportExpiresAt)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!deletion && (
        <section aria-labelledby="delete-title" className="flex flex-col gap-4">
          <h2 id="delete-title" className="text-2xl font-bold">
            Delete your account
          </h2>
          <p>
            Your account stops working straight away and everything in it is removed {DELETION_UNDO_DAYS} days later. During those {DELETION_UNDO_DAYS} days you can sign in and undo it from this page. After that it can&apos;t be brought back, so you may want
            to download a copy first.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Card variant="plain" padding="sm" className="flex flex-col gap-2">
              <h3 className="font-bold">What is deleted</h3>
              <ul className="flex list-disc flex-col gap-1 pl-6">
                <li>Your profile: nickname, username, birth month and year, interests and settings.</li>
                <li>All your progress: courses, steps, quiz attempts, notes and reflections.</li>
                <li>Every project, with the files and links you sent in, and every certificate.</li>
                <li>Coach chats we still hold, and the record of how you used Coach.</li>
              </ul>
            </Card>
            <Card variant="plain" padding="sm" className="flex flex-col gap-2">
              <h3 className="font-bold">What we must keep</h3>
              <ul className="flex list-disc flex-col gap-1 pl-6">
                {DELETION_STATEMENT.kept.map((line) => (
                  <li key={line}>{line.replace("the permissions you gave or withdrew", "the permissions given or withdrawn for your account").replace("about the adult who paid, never the child", "only about whoever paid")}</li>
                ))}
              </ul>
            </Card>
          </div>
          <DeleteOwnAccountForm undoDays={DELETION_UNDO_DAYS} />
        </section>
      )}
    </div>
  );
}
