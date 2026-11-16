import type { Metadata } from "next";
import Link from "next/link";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Callout, Card, EmptyState, GeneratedAvatar, LinkButton, PageHeader, ProgressBar, Stat, StatGroup } from "@/components/ui";
import { formatMinutes } from "@/lib/dates";
import { getParentDashboard, type ChildOverview } from "@/server/services/parent-dashboard";
import { minutesLabel } from "./_lib/view";

export const metadata: Metadata = { title: "Dashboard" };

function StatusBadges({ child }: { child: ChildOverview }) {
  return (
    <>
      {child.closing && <Badge tone="danger">Set to be deleted</Badge>}
      {!child.closing && child.needsConsent && <Badge tone="warning">Waiting for your permissions</Badge>}
      {!child.closing && child.controls.paused && <Badge tone="warning">Paused by you</Badge>}
      {child.independent && <Badge tone="info">Runs their own account</Badge>}
    </>
  );
}

function ChildCard({ child }: { child: ChildOverview }) {
  const { learner, progress, coach } = child;
  const name = learner.nickname;
  const href = `/parent/children/${learner.learnerId}`;
  const cap = child.controls.dailyMinutesCap;
  return (
    <Card as="section" aria-labelledby={`child-${learner.learnerId}`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <GeneratedAvatar seed={learner.avatarSeed} size="md" />
        <div className="flex min-w-0 flex-col">
          <h2 id={`child-${learner.learnerId}`} className="text-2xl font-bold">
            {name}
          </h2>
          <p className="text-ink-muted text-sm">
            Age {learner.age} · username {learner.username}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadges child={child} />
        </div>
      </div>

      <StatGroup>
        <Stat label="Time this week" value={minutesLabel(progress.minutesThisWeek)} detail={cap === null ? `${minutesLabel(progress.minutesToday)} today. No daily limit.` : `${minutesLabel(progress.minutesToday)} today, of ${formatMinutes(cap)} allowed.`} />
        <Stat label="Courses" value={progress.inProgress.length} detail={`in progress, ${progress.completed.length} finished`} />
        <Stat label="Projects" value={child.completedProjects} detail={`accepted, with ${child.certificates} ${child.certificates === 1 ? "certificate" : "certificates"}`} />
        <Stat label="Coach" value={coach.messagesThisWeek} detail={`${coach.messagesThisWeek === 1 ? "message" : "messages"} to our AI helper this week`} />
        <Stat label="Safety notices" value={child.safetyNotices} detail={child.safetyNotices === 0 ? "Nothing to look at" : "Open on your Notices page"} />
        <Stat label="Waiting for you" value={child.pendingApprovals} detail={child.pendingApprovals === 1 ? "request to answer" : "requests to answer"} />
      </StatGroup>

      {progress.inProgress.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-bold">In progress</h3>
          <ul className="flex flex-col gap-3">
            {progress.inProgress.slice(0, 3).map((course) => (
              <li key={course.courseId}>
                <ProgressBar label={course.title} value={course.percent} valueText={`${course.percent}% of steps done`} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {coach.topics.length > 0 && (
        <p>
          <span className="font-bold">Coach topics: </span>
          {coach.topics.join(", ")}. <span className="text-ink-muted">You see topics and a count, never the chat itself.</span>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <LinkButton href={href}>See {name}&apos;s progress</LinkButton>
        {!child.independent && !child.closing && (
          <LinkButton href={`${href}/controls`} variant="secondary">
            Time and limits
          </LinkButton>
        )}
        {child.safetyNotices > 0 && (
          <LinkButton href="/parent/notices" variant="secondary">
            Read safety notices
          </LinkButton>
        )}
      </div>
    </Card>
  );
}

/**
 * The parent dashboard (spec 3.6): one card per child with progress, time this week, projects,
 * certificates, Coach use as a count and topics, safety notices and requests waiting. The family
 * is the signed-in parent's own; nothing on this page takes an id from the address.
 */
export default async function ParentDashboardPage() {
  const ctx = await requireParentPage();
  const dashboard = await getParentDashboard(ctx);
  const waiting = dashboard.pendingApprovals.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your dashboard" description="How each of your children is getting on, and anything that needs you." />

      {waiting > 0 && (
        <Callout tone="warning" title={waiting === 1 ? "One request is waiting for you" : `${waiting} requests are waiting for you`} actions={<LinkButton href="/parent/approvals">Go to approvals</LinkButton>}>
          <p>Your child can&apos;t carry on with that course until you have answered.</p>
        </Callout>
      )}
      {dashboard.unreadNotices > 0 && (
        <Callout
          tone="info"
          title={dashboard.unreadNotices === 1 ? "You have one unread notice" : `You have ${dashboard.unreadNotices} unread notices`}
          actions={
            <LinkButton href="/parent/notices" variant="secondary">
              Read notices
            </LinkButton>
          }
        />
      )}

      {dashboard.children.length === 0 ? (
        <EmptyState title="Add your first child" description="A child profile is a nickname, a birth month and year, and a username. No email address or photo is needed." action={<LinkButton href="/parent/children/new">Add a child</LinkButton>} />
      ) : (
        dashboard.children.map((child) => <ChildCard key={child.learner.learnerId} child={child} />)
      )}

      <p className="text-ink-muted">
        Wondering what you can see, and what stays private to your child?{" "}
        <Link href="/parent/settings#what-you-see" className="link">
          What you can see
        </Link>
      </p>
    </div>
  );
}
