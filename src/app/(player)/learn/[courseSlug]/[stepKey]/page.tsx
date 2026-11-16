import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireLearnerPage } from "@/app/(learner)/_lib/learner-page";
import { PlayerView } from "@/components/course";
import { timeStop } from "@/server/services/learning-gate";
import { loadPlayer } from "@/server/services/progress";
import { TakenDownScreen, TimeStopScreen } from "../../../_components/player-states";

export const metadata: Metadata = { title: "Learn" };

type Params = Promise<{ courseSlug: string; stepKey: string }>;

/**
 * The course player. Every load runs the same gate as the Start button (`loadPlayer`): a direct
 * link to a step is refused exactly as the button would be. The content is the version this
 * learner started, already stripped of answers, feedback and Coach guidance.
 */
export default async function PlayerPage({ params }: { params: Params }) {
  const { courseSlug, stepKey } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(courseSlug) || courseSlug.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(stepKey)) notFound();
  const page = await requireLearnerPage(`/learn/${courseSlug}/${stepKey}`);
  if (!page.active) redirect("/home");
  const player = await loadPlayer(page.ctx, { learnerId: page.learnerId, courseSlug, stepKey });

  if (player.kind === "not_found") notFound();
  if (player.kind === "not_enrolled") redirect(`/explore/${player.courseSlug}`);
  if (player.kind === "taken_down") return <TakenDownScreen courseTitle={player.courseTitle} />;
  if (player.kind === "blocked") {
    if (timeStop(player.gate)) return <TimeStopScreen gate={player.gate} />;
    // A tool approval, a locked course, a paused account: the course page explains each, with its "ask a parent" action.
    redirect(`/explore/${player.courseSlug}`);
  }
  if (!player.current) notFound();

  return (
    <PlayerView
      content={player.course}
      courseId={player.enrolment.courseId}
      mode={{ kind: "live", enrolmentId: player.enrolment.id, learnerId: page.learnerId }}
      stepKey={stepKey}
      courseHref={`/explore/${player.enrolment.courseSlug}`}
      playerBasePath={`/learn/${player.enrolment.courseSlug}`}
      live={{ steps: player.steps, current: player.current }}
    />
  );
}
