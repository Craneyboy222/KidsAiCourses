import { Award } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportControl } from "@/components/safety/ReportControl";
import { STATUS_LABELS } from "@/components/submissions/evidence-copy";
import { EvidenceItemRow } from "@/components/submissions/EvidenceItemRow";
import { Badge, Breadcrumbs, Callout, Card, LinkButton, type BadgeTone } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getProject, type ProjectDetail } from "@/server/services/portfolio";
import { requireLearnerPage } from "../../_lib/learner-page";
import { AccountOnHold } from "../../_lib/paused";

// Generic on purpose: a project this person may not see must not be named in a tab title either.
export const metadata: Metadata = { title: "Project" };

type Params = Promise<{ projectId: string }>;

const TONES: Record<ProjectDetail["status"], BadgeTone> = { accepted: "success", awaiting_review: "info", needs_changes: "warning" };

/**
 * One project: the brief, the evidence, the rubric self-check and where it has got to (spec 3.4).
 * A project that is not this learner's answers with the ordinary not-found page.
 */
export default async function ProjectPage({ params }: { params: Params }) {
  const { projectId } = await params;
  const page = await requireLearnerPage(`/portfolio/${projectId}`);
  if (!page.active) return <AccountOnHold title="Project" />;
  const project = await getProject(page.ctx, projectId);
  if (!project) notFound();

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Portfolio", href: "/portfolio" }, { label: project.title }]} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">{project.title}</h1>
          <Badge tone={TONES[project.status]}>{STATUS_LABELS[project.status]}</Badge>
        </div>
        <p className="text-ink-muted">
          From the course{" "}
          <Link href={`/explore/${project.courseSlug}`} className="link">
            {project.courseTitle}
          </Link>
          {" · "}
          {project.acceptedAt ? `accepted ${formatDate(project.acceptedAt)}` : `handed in ${formatDate(project.submittedAt)}`}
        </p>
      </header>

      {project.status === "awaiting_review" && (
        <Callout tone="info" title="Awaiting review">
          <p>A person on our team is checking this before it&apos;s accepted. It usually takes a day or two. Only you can see it until then.</p>
        </Callout>
      )}
      {project.status === "needs_changes" && (
        <Callout
          tone="warning"
          title="This needs a change before it can be accepted"
          actions={project.stepKeyToResume ? <LinkButton href={`/learn/${project.courseSlug}/${project.stepKeyToResume}`}>Change it and hand in again</LinkButton> : undefined}
        >
          {project.message && <p>{project.message}</p>}
          <p>Nothing is wrong with you or your account. Your earlier go is kept.</p>
        </Callout>
      )}
      {project.status === "accepted" && project.certificateId && (
        <Callout tone="success" title="You earned a certificate for this" actions={<LinkButton href="/certificates" variant="secondary" iconStart={<Award aria-hidden="true" className="size-5" />}>See your certificates</LinkButton>} />
      )}

      {project.brief && (
        <section aria-labelledby="project-brief" className="flex flex-col gap-3">
          <h2 id="project-brief" className="text-2xl font-bold">
            The brief
          </h2>
          <p className="max-w-measure">{project.brief.scenario}</p>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {project.brief.deliverables.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="project-evidence" className="flex flex-col gap-3">
        <h2 id="project-evidence" className="text-2xl font-bold">
          Evidence
        </h2>
        {project.evidence.length === 0 ? (
          <p className="text-ink-muted">There&apos;s nothing to show here at the moment.</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {project.evidence.map((item) => (
              <EvidenceItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
        <p className="text-ink-muted text-sm">Links open the project on the tool&apos;s own site. Files are private and open through a link that only works for a couple of minutes.</p>
      </section>

      {project.rubric.length > 0 && (
        <section aria-labelledby="project-rubric" className="flex flex-col gap-3">
          <h2 id="project-rubric" className="text-2xl font-bold">
            How you rated it
          </h2>
          <ul className="flex list-none flex-col gap-3 p-0">
            {project.rubric.map((criterion) => (
              <li key={criterion.key}>
                <Card padding="sm" variant="plain" className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-bold">{criterion.name}</span>
                    <span className="text-ink-muted text-sm">{criterion.description}</span>
                  </div>
                  <Badge tone="neutral">{criterion.answer ?? "Not rated"}</Badge>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.note && (
        <section aria-labelledby="project-note" className="flex flex-col gap-2">
          <h2 id="project-note" className="text-2xl font-bold">
            Your honesty note
          </h2>
          <p className="max-w-measure whitespace-pre-wrap">{project.note}</p>
          <p className="text-ink-muted text-sm">Only you can see this note.</p>
        </section>
      )}

      {project.versions.length > 1 && (
        <section aria-labelledby="project-versions" className="flex flex-col gap-2">
          <h2 id="project-versions" className="text-2xl font-bold">
            Every time you handed in
          </h2>
          <ol className="flex list-none flex-col gap-1 p-0">
            {project.versions.map((entry) => (
              <li key={entry.version}>
                Go {entry.version}, {formatDate(entry.submittedAt)}: {STATUS_LABELS[entry.state].toLowerCase()}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer>
        <ReportControl target={{ type: "project", id: project.id, courseId: project.courseId }} />
      </footer>
    </article>
  );
}
