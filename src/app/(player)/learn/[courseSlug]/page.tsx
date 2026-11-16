import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireLearnerPage } from "@/app/(learner)/_lib/learner-page";
import { timeStop } from "@/server/services/learning-gate";
import { loadPlayer } from "@/server/services/progress";
import { TakenDownScreen, TimeStopScreen } from "../../_components/player-states";

export const metadata: Metadata = { title: "Continue" };

/**
 * `/learn/[courseSlug]`: resume. Sends the learner to the exact step they should carry on from, on
 * whatever device this is. Not enrolled (or not allowed yet) goes to the course page, which is
 * where a course is started and where each blocker is explained.
 */
export default async function ResumePage({ params }: { params: Promise<{ courseSlug: string }> }) {
  const { courseSlug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(courseSlug) || courseSlug.length > 120) notFound();
  const page = await requireLearnerPage(`/learn/${courseSlug}`);
  if (!page.active) redirect("/home");
  const player = await loadPlayer(page.ctx, { learnerId: page.learnerId, courseSlug });
  if (player.kind === "not_found") notFound();
  if (player.kind === "not_enrolled") redirect(`/explore/${player.courseSlug}`);
  if (player.kind === "taken_down") return <TakenDownScreen courseTitle={player.courseTitle} />;
  if (player.kind === "blocked") {
    if (timeStop(player.gate)) return <TimeStopScreen gate={player.gate} />;
    redirect(`/explore/${player.courseSlug}`);
  }
  if (!player.resumeKey) redirect(`/explore/${player.enrolment.courseSlug}`);
  redirect(`/learn/${player.enrolment.courseSlug}/${player.resumeKey}`);
}
