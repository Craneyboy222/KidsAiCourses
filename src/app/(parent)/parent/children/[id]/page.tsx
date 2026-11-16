import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireParentPage } from "@/app/(auth)/_lib/after-sign-in";
import { Badge, Breadcrumbs, Callout, Card, EmptyState, GeneratedAvatar, LinkButton, PageHeader, ProgressBar, Stat, StatGroup } from "@/components/ui";
import { formatDate, formatMinutes } from "@/lib/dates";
import { MAX_PAUSE_REASON } from "@/lib/parents/controls-rules";
import { minutesToClock } from "@/lib/learning/time-rules";
import { getChildDetail } from "@/server/services/parent-dashboard";
import { ApprovalCard } from "../../_components/approval-card";
import { PauseForm } from "../../_components/pause-form";
import { ResetPasswordForm } from "../../_components/reset-password-form";
import { UUID, loadOr404, minutesLabel, toCardItem } from "../../_lib/view";

export const metadata: Metadata = { title: "Your child" };

type Props = { params: Promise<{ id: string }> };

const dayName = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/**
 * One child in full (spec 3.6): progress, time, portfolio, certificates, Coach summary, safety
 * notices, their requests, and the things only a parent can do: limits, pause and password reset.
 * The id in the address only chooses among this parent's own children; anything else is not found.
 */
export default async function ChildDetailPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireParentPage();
  const child = await loadOr404(() => getChildDetail(ctx, id));
  const { learner, progress, coach, controls } = child;
  const name = learner.nickname;
  const base = `/parent/children/${learner.learnerId}`;
  const manageable = !child.independent && !child.closing;
  const quietOn = controls.quietStartMin !== controls.quietEndMin;
  const pending = child.approvals.filter((item) => item.status === "pending");
  const answered = child.approvals.filter((item) => item.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={name}
        description={`Age ${learner.age} · username ${learner.username}`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: name }]} />}
        eyebrow={<GeneratedAvatar seed={learner.avatarSeed} size="lg" />}
        actions={
          manageable ? (
            <div className="flex flex-wrap gap-3">
              <LinkButton href={`${base}/controls`}>Time and limits</LinkButton>
              <LinkButton href={`${base}/consent`} variant="secondary">
                Permissions
              </LinkButton>
            </div>
          ) : undefined
        }
      />

      {child.closing && (
        <Callout tone="danger" title={`${name}'s account is set to be deleted`} actions={<LinkButton href="/parent/privacy">Go to Privacy</LinkButton>}>
          <p>The account is closed and will be deleted when the 14 days are up. Until then you can undo this from your Privacy page.</p>
        </Callout>
      )}
      {child.independent && (
        <Callout tone="info" title={`${name} is 18 and runs their own account`}>
          <p>You can still see their progress while they stay linked to your family. Limits, pausing, their password and their data are now theirs to manage.</p>
        </Callout>
      )}
      {!child.closing && child.needsConsent && (
        <Callout tone="warning" title={`${name}'s account is waiting for your permissions`} actions={<LinkButton href={`${base}/consent`}>Review permissions</LinkButton>}>
          <p>They can&apos;t use their account until the permissions it needs have been given.</p>
        </Callout>
      )}

      <section aria-labelledby="summary-title" className="flex flex-col gap-4">
        <h2 id="summary-title" className="text-2xl font-bold">
          This week
        </h2>
        <StatGroup>
          <Stat label="Time this week" value={minutesLabel(progress.minutesThisWeek)} detail={`${minutesLabel(progress.minutesToday)} today`} />
          <Stat label="Courses in progress" value={progress.inProgress.length} detail={`${progress.completed.length} finished so far`} />
          <Stat label="Accepted projects" value={child.completedProjects} />
          <Stat label="Certificates" value={child.certificates} />
          <Stat label="Coach messages" value={coach.messagesThisWeek} detail={`${coach.messagesTotal} in total`} />
          <Stat label="Safety notices" value={child.safetyNotices} detail={child.safetyNotices === 0 ? "Nothing to look at" : "Open on your Notices page"} />
        </StatGroup>
        {child.safetyNotices > 0 && (
          <Callout tone="warning" title={child.safetyNotices === 1 ? "There is a safety notice about this account" : `There are ${child.safetyNotices} safety notices about this account`} actions={<LinkButton href="/parent/notices">Read your notices</LinkButton>}>
            <p>A notice tells you that something needed attention and what we have done. It never includes the detail of what your child wrote or said.</p>
          </Callout>
        )}
      </section>

      <section aria-labelledby="learning-title" className="flex flex-col gap-4">
        <h2 id="learning-title" className="text-2xl font-bold">
          Courses
        </h2>
        {progress.inProgress.length === 0 && progress.completed.length === 0 ? (
          <EmptyState headingLevel="h3" title="No courses started yet" description={`When ${name} starts a course, it shows here with how far through they are.`} />
        ) : (
          <>
            {progress.inProgress.length > 0 && (
              <ul className="flex flex-col gap-3">
                {progress.inProgress.map((course) => (
                  <Card as="li" key={course.courseId} padding="sm" className="flex flex-col gap-2">
                    <ProgressBar label={course.title} value={course.percent} valueText={`${course.percent}% of steps done`} />
                    <p className="text-ink-muted text-sm">{course.lastActiveAt ? `Last worked on ${formatDate(course.lastActiveAt)}` : "Not worked on yet"}</p>
                  </Card>
                ))}
              </ul>
            )}
            {progress.completed.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="font-bold">Finished</h3>
                <ul className="flex list-disc flex-col gap-1 pl-6">
                  {progress.completed.map((course) => (
                    <li key={course.courseId}>
                      {course.title}, finished on {formatDate(course.completedAt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="time-title" className="flex flex-col gap-3">
        <h2 id="time-title" className="text-2xl font-bold">
          Time, day by day
        </h2>
        <p className="text-ink-muted">
          {controls.dailyMinutesCap === null ? "No daily limit is set." : `The daily limit is ${formatMinutes(controls.dailyMinutesCap)}.`}{" "}
          {quietOn ? `Quiet hours run from ${minutesToClock(controls.quietStartMin)} to ${minutesToClock(controls.quietEndMin)}.` : "There are no quiet hours."}
        </p>
        <ul className="flex flex-col">
          {child.usage.map((day) => (
            <li key={day.date} className="border-line flex justify-between gap-4 border-b py-2">
              <span>{dayName(day.date)}</span>
              <span className="font-bold">{minutesLabel(Math.floor(day.seconds / 60))}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="portfolio-title" className="flex flex-col gap-4">
        <h2 id="portfolio-title" className="text-2xl font-bold">
          Portfolio and certificates
        </h2>
        <p className="text-ink-muted">Finished projects that have passed our checks. Work that is still being checked, or was sent back for changes, is {name}&apos;s to finish first.</p>
        {child.projects.length === 0 ? (
          <EmptyState headingLevel="h3" title="No finished projects yet" description="A project appears here once it has been handed in and accepted." />
        ) : (
          <ul className="flex flex-col gap-3">
            {child.projects.map((project) => (
              <Card as="li" key={project.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-bold">{project.title}</span>
                  <span className="text-ink-muted text-sm">
                    {project.courseTitle} · accepted {formatDate(project.acceptedAt ?? project.submittedAt)}
                  </span>
                </div>
                <LinkButton href={`${base}/projects/${project.id}`} variant="secondary" size="sm">
                  View project<span className="sr-only">: {project.title}</span>
                </LinkButton>
              </Card>
            ))}
          </ul>
        )}
        {child.certificateList.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">Certificates</h3>
            <ul className="flex flex-col gap-2">
              {child.certificateList.map((certificate) => (
                <li key={certificate.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    {certificate.courseTitle}, issued {formatDate(certificate.issuedAt)}
                  </span>
                  {certificate.revokedAt ? (
                    <Badge tone="danger">Withdrawn</Badge>
                  ) : (
                    <>
                      <a href={`/api/v1/certificates/${certificate.id}/pdf`} className="link">
                        Download PDF<span className="sr-only">: {certificate.courseTitle}</span>
                      </a>
                      <Link href={`/verify/${certificate.verifyCode}`} className="link">
                        Public check page<span className="sr-only">: {certificate.courseTitle}</span>
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="coach-title" className="flex flex-col gap-3">
        <h2 id="coach-title" className="text-2xl font-bold">
          Coach
        </h2>
        <p>
          Coach is our AI helper. It gives hints and asks questions; it doesn&apos;t do the project. {name} has sent it {coach.messagesThisWeek} {coach.messagesThisWeek === 1 ? "message" : "messages"} this week and {coach.messagesTotal} in total
          {coach.lastUsedAt ? `, most recently on ${formatDate(coach.lastUsedAt)}` : ""}.
        </p>
        {coach.topics.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">Topics they asked about</h3>
            <ul className="flex flex-wrap gap-2">
              {coach.topics.map((topic) => (
                <li key={topic}>
                  <Badge>{topic}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-ink-muted">No topics yet.</p>
        )}
        <p className="text-ink-muted">
          You see a count and the topics, not what was typed. That is so {name} can ask questions freely. If a chat ever raised a safety concern, you would get a safety notice.{" "}
          <Link href="/parent/settings#what-you-see" className="link">
            What you can see
          </Link>
        </p>
      </section>

      <section aria-labelledby="requests-title" className="flex flex-col gap-4">
        <h2 id="requests-title" className="text-2xl font-bold">
          Tools and requests
        </h2>
        {child.approvals.length === 0 ? (
          <p className="text-ink-muted">{name} hasn&apos;t asked you to approve anything yet. Requests to use an outside tool or unlock a course will show here.</p>
        ) : (
          <>
            {pending.map((item) => (
              <ApprovalCard key={item.key} item={toCardItem(item)} headingLevel="h3" />
            ))}
            {answered.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="font-bold">Already answered</h3>
                {answered.map((item) => (
                  <ApprovalCard key={item.key} item={toCardItem(item)} headingLevel="h3" />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {manageable && (
        <>
          <section aria-labelledby="limits-title" className="flex flex-col gap-3">
            <h2 id="limits-title" className="text-2xl font-bold">
              Limits
            </h2>
            <ul className="flex list-disc flex-col gap-1 pl-6">
              <li>{controls.dailyMinutesCap === null ? "No daily time limit." : `Up to ${formatMinutes(controls.dailyMinutesCap)} of learning a day.`}</li>
              <li>{quietOn ? `Quiet hours from ${minutesToClock(controls.quietStartMin)} to ${minutesToClock(controls.quietEndMin)}.` : "No quiet hours."}</li>
              <li>
                {controls.blockedCategories.length + controls.blockedCourseIds.length === 0
                  ? "Nothing is blocked."
                  : `${controls.blockedCategories.length} ${controls.blockedCategories.length === 1 ? "subject" : "subjects"} and ${controls.blockedCourseIds.length} ${controls.blockedCourseIds.length === 1 ? "course" : "courses"} blocked.`}
              </li>
              <li>{controls.requireApprovalForPro ? "Pro courses need your approval first." : "Pro courses don't need your approval."}</li>
            </ul>
            <div>
              <LinkButton href={`${base}/controls`} variant="secondary">
                Change time and limits
              </LinkButton>
            </div>
          </section>

          <section aria-labelledby="pause-title" className="flex flex-col gap-3">
            <h2 id="pause-title" className="text-2xl font-bold">
              Pause the account
            </h2>
            <PauseForm learnerId={learner.learnerId} nickname={name} paused={controls.paused} reason={controls.pausedReason} maxReason={MAX_PAUSE_REASON} />
          </section>

          <section aria-labelledby="password-title" className="flex flex-col gap-3">
            <h2 id="password-title" className="text-2xl font-bold">
              Reset their password
            </h2>
            <ResetPasswordForm learnerId={learner.learnerId} nickname={name} username={learner.username} />
          </section>

          <section aria-labelledby="data-title" className="flex flex-col gap-3">
            <h2 id="data-title" className="text-2xl font-bold">
              Their data
            </h2>
            <p>
              You can download a copy of {name}&apos;s data, or delete their account, from your{" "}
              <Link href="/parent/privacy" className="link">
                Privacy page
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </div>
  );
}
