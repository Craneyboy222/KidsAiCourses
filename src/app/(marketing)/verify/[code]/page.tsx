import { BadgeCheck, CircleSlash, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { Callout, Card } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";
import { formatDate } from "@/lib/dates";
import { getCtx } from "@/server/context";
import { checkRateLimit } from "@/server/ratelimit";
import { verifyCertificate } from "@/server/services/certificate";

// Never indexed, never cached: a certificate page is for the person holding the link, and it can be revoked at any time.
export const metadata: Metadata = { title: "Check a certificate", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

type Params = Promise<{ code: string }>;

/**
 * Public certificate check (spec 3.4, Section 5). Shows the first name or nickname on the
 * certificate, the course, the date and whether it has been withdrawn, and nothing else: no
 * surname, username, age, school, progress or link to anything about the learner. An unknown code
 * and a malformed one get the same answer. Rate limited by address, so codes cannot be guessed in bulk.
 *
 * No `<main>` here: the marketing layout (owned by the marketing slice) provides the page frame.
 */
export default async function VerifyCertificatePage({ params }: { params: Params }) {
  const { code } = await params;
  const ctx = await getCtx();
  const limit = await checkRateLimit(ctx, "certificate.verify", { limit: 30, windowSec: 600 });

  if (!limit.allowed) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
        <h1 className="text-3xl font-bold sm:text-4xl">Check a certificate</h1>
        <Callout tone="warning" title="That's a lot of checks in a short time">
          <p>Please wait a few minutes, then try again.</p>
        </Callout>
      </div>
    );
  }

  const found = code.length <= 64 ? await verifyCertificate(ctx, code) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">Check a certificate</h1>
      {!found ? (
        <Card className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <SearchX aria-hidden="true" className="size-6 shrink-0" strokeWidth={2.25} />
            We couldn&apos;t find a certificate with that code
          </h2>
          <p>Check the code or link and try again. Codes look like ABCD-EFGH-JKMN-PQRS.</p>
        </Card>
      ) : found.revoked ? (
        <Card className="flex flex-col gap-3" data-testid="certificate-revoked">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <CircleSlash aria-hidden="true" className="text-danger size-6 shrink-0" strokeWidth={2.25} />
            This certificate has been revoked
          </h2>
          <p>
            A certificate was issued to <strong>{found.displayName}</strong> for <strong>{found.courseTitle}</strong> on {formatDate(found.issuedAt)}. It has since been withdrawn and is no longer valid.
          </p>
        </Card>
      ) : (
        <Card variant="raised" className="flex flex-col gap-3" data-testid="certificate-valid">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <BadgeCheck aria-hidden="true" className="text-success size-6 shrink-0" strokeWidth={2.25} />
            This certificate is real
          </h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-ink-muted text-sm font-bold">Awarded to</dt>
              <dd className="text-lg font-bold">{found.displayName}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-sm font-bold">Course</dt>
              <dd className="text-lg font-bold">{found.courseTitle}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-sm font-bold">Date</dt>
              <dd className="text-lg font-bold">{formatDate(found.issuedAt)}</dd>
            </div>
          </dl>
        </Card>
      )}
      <p className="text-ink-muted text-sm">
        {BRAND_NAME} certificates show a first name or nickname only. To protect young people&apos;s privacy, this page never shows anything else about the person.
      </p>
    </div>
  );
}
