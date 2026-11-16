import { Award, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Breadcrumbs, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getCertificateName, issueOutstandingCertificates, listCertificates } from "@/server/services/certificate";
import { requireLearnerPage } from "../_lib/learner-page";
import { AccountOnHold } from "../_lib/paused";
import { CertificateNameForm } from "./CertificateNameForm";

export const metadata: Metadata = { title: "Certificates" };

/**
 * The learner's certificates (spec 3.4). One is issued when a course is complete and its project
 * has been accepted. Each has a PDF and a public check link that shows the name, course and date
 * and nothing else.
 */
export default async function CertificatesPage() {
  const page = await requireLearnerPage("/certificates");
  if (!page.active) return <AccountOnHold title="Certificates" />;
  // A project accepted before the last step was finished gets its certificate here, the first time the learner looks.
  await issueOutstandingCertificates(page.ctx, page.learnerId);
  const [certificates, name] = await Promise.all([listCertificates(page.ctx, page.learnerId), getCertificateName(page.ctx, page.learnerId)]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Portfolio", href: "/portfolio" }, { label: "Certificates" }]} />}
        title="Certificates"
        description="You earn one when you finish a course and your project is accepted."
      />

      {certificates.length === 0 ? (
        <EmptyState
          icon={<Award aria-hidden="true" className="size-8" />}
          title="No certificates yet"
          description="Finish every step of a course and hand in your project. Once it's accepted, your certificate appears here."
          action={<LinkButton href="/home">Carry on learning</LinkButton>}
        />
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {certificates.map((certificate) => (
            <li key={certificate.id}>
              <Card as="article" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-xl font-bold">{certificate.courseTitle}</h2>
                  {certificate.revokedAt ? <Badge tone="danger">Withdrawn</Badge> : <Badge tone="success">Issued</Badge>}
                </div>
                <p className="text-ink-muted">
                  Awarded to {certificate.displayName} on {formatDate(certificate.issuedAt)}
                </p>
                {certificate.revokedAt ? (
                  <p>This certificate was withdrawn on {formatDate(certificate.revokedAt)}. If you think that&apos;s a mistake, ask a parent or carer to get in touch with us.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <a href={`/api/v1/certificates/${certificate.id}/pdf`} className="link inline-flex items-center gap-1.5 font-bold">
                      <Download aria-hidden="true" className="size-4" strokeWidth={2.5} />
                      Download the PDF<span className="sr-only"> for {certificate.courseTitle}</span>
                    </a>
                    <Link href={`/verify/${certificate.verifyCode}`} className="link">
                      See the check page<span className="sr-only"> for {certificate.courseTitle}</span>
                    </Link>
                  </div>
                )}
                <p className="text-ink-muted text-sm">Check code: {certificate.verifyCode}. Anyone with this code can confirm the certificate is real. They see the name above, the course and the date: nothing else.</p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="certificate-name" className="flex flex-col gap-3">
        <h2 id="certificate-name" className="text-2xl font-bold">
          The name on your certificates
        </h2>
        <p className="text-ink-muted">Changing this affects certificates you earn from now on. Ones you already have keep their name.</p>
        <CertificateNameForm choice={name.choice} nickname={name.nickname} firstName={name.firstName} />
      </section>
    </div>
  );
}
