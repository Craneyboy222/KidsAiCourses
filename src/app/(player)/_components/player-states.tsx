import { Callout, LinkButton } from "@/components/ui";
import { timeStop, type LearningGate } from "@/server/services/learning-gate";
import { PlainScreen } from "./plain-screen";

/** A course that has been taken down: a clear notice and nothing else (no content, no outline). */
export function TakenDownScreen({ courseTitle }: { courseTitle: string }) {
  return (
    <PlainScreen title={courseTitle}>
      <Callout tone="warning" title="This project has been taken down for now">
        <p>We&apos;ve paused it while we check something. Your progress is saved, and we&apos;ll let you know if it comes back.</p>
      </Callout>
      <div>
        <LinkButton href="/explore">Explore other projects</LinkButton>
      </div>
    </PlainScreen>
  );
}

const STOP_TITLES = { time_cap: "That's your time for today", quiet_hours: "It's quiet hours" } as const;

/**
 * The daily cap or quiet hours, met on the way in. Friendly, and clear that nothing is lost.
 * Returns null for any other kind of block: those belong on the course page, which shows each
 * reason with its "ask a parent" action.
 */
export function TimeStopScreen({ gate }: { gate: LearningGate }) {
  const stop = timeStop(gate);
  if (!stop) return null;
  return (
    <PlainScreen title={STOP_TITLES[stop.reason]}>
      <Callout tone="info">
        <p>{stop.message}</p>
      </Callout>
      <p className="text-ink-muted">You&apos;ll come back to exactly the step you were on.</p>
      <div>
        <LinkButton href="/home">Back to home</LinkButton>
      </div>
    </PlainScreen>
  );
}
