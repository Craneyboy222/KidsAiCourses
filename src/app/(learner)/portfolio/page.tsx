import { Award, FolderHeart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_LABELS } from "@/components/submissions/evidence-copy";
import { Badge, Card, EmptyState, LinkButton, PageHeader, type BadgeTone } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { listProjects, type ProjectView } from "@/server/services/portfolio";
import { requireLearnerPage } from "../_lib/learner-page";
import { AccountOnHold } from "../_lib/paused";

export const metadata: Metadata = { title: "Portfolio" };

const TONES: Record<ProjectView["status"], BadgeTone> = { accepted: "success", awaiting_review: "info", needs_changes: "warning" };

/**
 * The learner's own portfolio (spec 3.4). Private: only the learner and their linked parents can
 * ever see these projects, and there is no public or shareable page. Work that is still being
 * checked, or needs a change, is shown to the learner here and to nobody else.
 */
export default async function PortfolioPage() {
  const page = await requireLearnerPage("/portfolio");
  if (!page.active) return <AccountOnHold title="Portfolio" />;
  const projects = await listProjects(page.ctx, page.learnerId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Portfolio"
        description="Everything you've made and handed in. It's private: only you and your parent or carer can see it."
        actions={
          <LinkButton href="/certificates" variant="secondary" iconStart={<Award aria-hidden="true" className="size-5" />}>
            Certificates
          </LinkButton>
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderHeart aria-hidden="true" className="size-8" />}
          title="Nothing here yet"
          description="When you hand in a project at the end of a course, it shows up here."
          action={<LinkButton href="/explore">Find a project to make</LinkButton>}
        />
      ) : (
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Card as="article" className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-xl font-bold">
                    <Link href={`/portfolio/${project.id}`} className="link">
                      {project.title}
                    </Link>
                  </h2>
                  <Badge tone={TONES[project.status]}>{STATUS_LABELS[project.status]}</Badge>
                </div>
                {project.title !== project.courseTitle && <p className="text-ink-muted">{project.courseTitle}</p>}
                <p className="text-ink-muted text-sm">
                  {project.acceptedAt ? `Accepted ${formatDate(project.acceptedAt)}` : `Handed in ${formatDate(project.submittedAt)}`}
                  {" · "}
                  {project.artefactCount === 1 ? "1 piece of evidence" : `${project.artefactCount} pieces of evidence`}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
