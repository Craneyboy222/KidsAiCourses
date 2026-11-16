import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Breadcrumbs, Callout, Card, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireOwnChild } from "@/server/services/parent-dashboard";
import { getProject } from "@/server/services/portfolio";
import { UUID, loadOr404 } from "../../../../_lib/view";

export const metadata: Metadata = { title: "Project" };

type Props = { params: Promise<{ id: string; projectId: string }> };

const KIND: Record<string, string> = { link: "Link", screenshot: "Screenshot", file: "File", video: "Video" };

/**
 * One accepted project from a child's private portfolio (spec 3.4: "visible only to them and
 * their linked parents"). The portfolio service refuses anything that is not accepted, and
 * anything from another family; this page also checks the project belongs to the child in the
 * address. The child's own note to the reviewer and the reviewer's messages are not shown here.
 */
export default async function ChildProjectPage({ params }: Props) {
  const { id, projectId } = await params;
  if (!UUID.test(id) || !UUID.test(projectId)) notFound();
  const ctx = await requireParentPage();
  const learner = await loadOr404(() => requireOwnChild(ctx, id));
  const project = await loadOr404(() => getProject(ctx, projectId));
  if (!project || project.learnerId !== learner.learnerId || project.status !== "accepted") notFound();
  const name = learner.nickname;
  const evidence = project.evidence.filter((item) => item.state === "accepted");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={project.title}
        description={`${project.courseTitle} · accepted on ${formatDate(project.acceptedAt ?? project.submittedAt)}`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: name, href: `/parent/children/${learner.learnerId}` }, { label: "Project" }]} />}
        eyebrow={<Badge tone="success">Accepted</Badge>}
      />

      {project.brief && (
        <section aria-labelledby="brief-title" className="flex flex-col gap-2">
          <h2 id="brief-title" className="text-2xl font-bold">
            What the project asked for
          </h2>
          <p>{project.brief.scenario}</p>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {project.brief.deliverables.map((deliverable) => (
              <li key={deliverable}>{deliverable}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence-title" className="flex flex-col gap-3">
        <h2 id="evidence-title" className="text-2xl font-bold">
          What {name} handed in
        </h2>
        <Callout tone="info" title="The project itself lives in the tool it was made with">
          <p>We keep only the links and files {name} sent us as evidence. We don&apos;t host or run the project, and we haven&apos;t checked where a link leads beyond our safety checks.</p>
        </Callout>
        {evidence.length === 0 ? (
          <p className="text-ink-muted">There is nothing to show for this project.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {evidence.map((item, index) => (
              <Card as="li" key={item.id} padding="sm" className="flex flex-col gap-1">
                <span className="font-bold">
                  {KIND[item.kind] ?? "Evidence"} {index + 1}
                </span>
                {item.kind === "link" && item.url ? (
                  // Shown as text, not a link: it leads off our site to something we do not control.
                  <span className="break-all">{item.url}</span>
                ) : item.hasFile ? (
                  <a href={`/api/v1/artefacts/${item.id}/download`} className="link">
                    Download this {(KIND[item.kind] ?? "file").toLowerCase()}
                    <span className="sr-only">
                      {" "}
                      ({KIND[item.kind] ?? "Evidence"} {index + 1})
                    </span>
                  </a>
                ) : (
                  <span className="text-ink-muted">We no longer hold this file.</span>
                )}
                <span className="text-ink-muted text-sm">Added on {formatDate(item.addedAt)}</span>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
