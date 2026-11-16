"use client";
// CONTRACT — owner: Coach slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import { Lightbulb, Send } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { isPreview, type PlayerMode } from "@/components/course/types";
import { ReportControl } from "@/components/safety/ReportControl";
import { AiLabel, Badge, Button, Callout, Field, LiveRegion, Markdown, Sheet, Spinner, Textarea } from "@/components/ui";
import type { CrisisScript } from "@/server/ai/crisis";
import type { EnergyView } from "@/server/ai/types";
import { CrisisPanel } from "./CrisisPanel";
import { EnergyMeter } from "./EnergyMeter";
import { fetchEnergy, sendCoachMessage, type CoachChatBody } from "./coach-client";

export type CoachPanelProps = {
  mode: PlayerMode;
  courseSlug: string;
  stepKey: string;
  stepTitle: string;
  /** Tiered hints for the step. "I'm stuck" offers these first, before any model call (spec 3.2). */
  hints: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Entry =
  | { id: string; kind: "learner"; text: string }
  | { id: string; kind: "hint"; text: string; number: number; total: number }
  | { id: string; kind: "notice"; text: string }
  | {
      id: string;
      kind: "coach";
      text: string;
      label: string;
      aiGenerated: boolean;
      messageId: string | null;
      crisis: CrisisScript | null;
      streaming: boolean;
    };

/** Reasons Coach is unavailable that typing again will not fix. The step's own hints still work. */
const STOPS = new Set(["paused", "time_cap_reached", "quiet_hours", "consent_required", "age_assurance_required", "credits_exhausted", "ai_break", "coach_off", "unauthenticated", "forbidden"]);

const STOP_TITLES: Record<string, string> = {
  credits_exhausted: "Out of Coach energy",
  ai_break: "AI break — back soon",
  coach_off: "Coach is switched off",
  quiet_hours: "It's quiet hours",
  time_cap_reached: "That's your time for today",
  consent_required: "Coach needs a grown-up's OK",
  age_assurance_required: "Coach isn't switched on yet",
  paused: "Your account is paused",
  unauthenticated: "You're signed out",
  forbidden: "Coach isn't available here",
};

const STILL_STUCK = "I've read the hints for this step and I'm still stuck. Can you help me work out what to try next?";
const JUST_STUCK = "I'm stuck on this step. Can you help me work out what to try next?";

/**
 * Coach: the AI tutor sheet inside the course player (spec 3.5 and Section 8).
 *
 * - "I'm stuck" gives the step's own hints first, one at a time. Only when they have run out does
 *   it ask the model.
 * - Every Coach message carries an AI label and a Report control. Text arrives from our own server
 *   after it has been checked; nothing here talks to a model provider.
 * - The crisis script is fixed text shown in its own calm panel with tappable numbers.
 * - Learners see energy, never prices.
 */
export function CoachPanel(props: CoachPanelProps) {
  // A new step is a new conversation: Coach only ever knows about the step in front of the learner.
  // Keying by step throws away the old thread, hints shown and draft in one go.
  return <CoachThread key={`${props.courseSlug}/${props.stepKey}`} {...props} />;
}

function CoachThread({ mode, courseSlug, stepKey, stepTitle, hints, open, onOpenChange }: CoachPanelProps) {
  const preview = isPreview(mode);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hintsShown, setHintsShown] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stop, setStop] = useState<{ code: string; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [energy, setEnergy] = useState<EnergyView | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const conversationId = useRef<string | null>(null);
  const learnerTurns = useRef(0);
  const counter = useRef(0);
  const logEnd = useRef<HTMLDivElement | null>(null);
  const inputId = useId();
  const nextId = () => `${stepKey}-${(counter.current += 1)}`;

  useEffect(() => {
    if (!open || preview) return;
    const controller = new AbortController();
    void fetchEnergy(controller.signal).then((value) => {
      if (value && !controller.signal.aborted) setEnergy(value);
    });
    return () => controller.abort();
  }, [open, preview]);

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [entries]);

  const ask = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setProblem(null);
      setAnnouncement("Coach is thinking.");
      const replyId = nextId();
      setEntries((list) => [...list, { id: nextId(), kind: "learner", text: message }]);

      const body: CoachChatBody = { courseSlug, stepKey, message };
      if (preview) body.preview = { versionId: mode.versionId, asBand: mode.asBand, turn: learnerTurns.current };
      else if (conversationId.current) body.conversationId = conversationId.current;

      let spoken = "";
      let crisisShown = false;
      const result = await sendCoachMessage(body, {
        onMeta: (meta) => {
          conversationId.current = meta.conversationId;
          crisisShown = meta.crisis !== null;
          setEntries((list) => [
            ...list,
            ...meta.notices.map((notice): Entry => ({ id: nextId(), kind: "notice", text: notice })),
            { id: replyId, kind: "coach", text: "", label: meta.label, aiGenerated: meta.aiGenerated, messageId: meta.messageId, crisis: meta.crisis, streaming: true },
          ]);
          if (meta.crisis) spoken = `${meta.crisis.title}. There are people you can talk to right now. Childline is free on 0800 1111. The full message is in the Coach panel.`;
        },
        onDelta: (chunk) => {
          setEntries((list) => list.map((entry) => (entry.id === replyId && entry.kind === "coach" ? { ...entry, text: entry.text + chunk } : entry)));
          if (!crisisShown) spoken += chunk;
        },
        onDone: (done) => {
          setEntries((list) => list.map((entry) => (entry.id === replyId && entry.kind === "coach" ? { ...entry, streaming: false } : entry)));
          if (done.energy) setEnergy(done.energy);
        },
      });

      if (result.ok) {
        learnerTurns.current += 1;
        // Announced once, when the whole reply is in, so a screen reader is not interrupted mid-sentence.
        setAnnouncement(spoken ? `Coach says: ${spoken}` : "Coach has replied.");
      } else if (STOPS.has(result.code)) {
        setStop({ code: result.code, message: result.message });
        setAnnouncement(result.message);
      } else {
        setProblem(result.message);
        setAnnouncement(result.message);
      }
      setBusy(false);
    },
    // `nextId` only touches a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, courseSlug, stepKey, preview, mode],
  );

  const hintsLeft = hints.length - hintsShown;
  function stuck() {
    if (hintsLeft > 0) {
      const number = hintsShown + 1;
      const text = hints[hintsShown] ?? "";
      setHintsShown(number);
      setEntries((list) => [...list, { id: nextId(), kind: "hint", text, number, total: hints.length }]);
      setAnnouncement(`Hint ${number} of ${hints.length}: ${text}`);
      return;
    }
    void ask(hints.length > 0 ? STILL_STUCK : JUST_STUCK);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void ask(text);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const stuckLabel = hintsShown === 0 && hints.length > 0 ? "I'm stuck" : hintsLeft > 0 ? "Another hint" : hints.length > 0 ? "Still stuck? Ask Coach" : "I'm stuck";
  const canAskCoach = stop === null;

  return (
    <Sheet title="Coach" description={`An AI tutor for “${stepTitle}”. It gives hints and asks questions.`} open={open} onOpenChange={onOpenChange} modal={false}>
      <LiveRegion>{announcement}</LiveRegion>

      {preview && (
        <Badge tone="warning">Staff preview — nothing is saved</Badge>
      )}

      <Callout tone="info" title="What Coach will and won't do">
        <ul className="list-disc pl-5">
          <li>It gives hints, clues and questions to get you unstuck.</li>
          <li>It won&apos;t do the project for you, or write homework, essays or exam answers.</li>
          <li>It will never ask for your name, address, passwords, codes or card details. Don&apos;t share them.</li>
          <li>It&apos;s an AI, so it can get things wrong. Check anything important, and talk to an adult you trust about anything that worries you.</li>
        </ul>
      </Callout>

      {!preview && energy && <EnergyMeter energy={energy} />}

      <ol aria-label="Conversation with Coach" className="flex list-none flex-col gap-3 p-0">
        {entries.map((entry) => {
          if (entry.kind === "learner") {
            return (
              <li key={entry.id} className="bg-tint text-ink rounded-card ml-6 p-3">
                <span className="sr-only">You said: </span>
                <span className="whitespace-pre-wrap">{entry.text}</span>
              </li>
            );
          }
          if (entry.kind === "hint") {
            return (
              <li key={entry.id} className="border-ink bg-surface text-ink rounded-card flex flex-col gap-1 border-2 p-3">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Lightbulb aria-hidden="true" className="size-4" strokeWidth={2.5} />
                  Hint {entry.number} of {entry.total} · written by the course team
                </span>
                <span>{entry.text}</span>
              </li>
            );
          }
          if (entry.kind === "notice") {
            return (
              <li key={entry.id}>
                <Callout tone="warning">{entry.text}</Callout>
              </li>
            );
          }
          if (entry.crisis) {
            return (
              <li key={entry.id} className="flex flex-col gap-2">
                <CrisisPanel script={entry.crisis} label={entry.label} />
                <ReportControl target={{ type: "ai_output", id: entry.messageId ?? `${courseSlug}:${stepKey}`, stepKey }} compact />
              </li>
            );
          }
          return (
            <li key={entry.id} data-testid="coach-message" className="border-ink bg-surface text-ink rounded-card mr-6 flex flex-col gap-2 border-2 p-3">
              <AiLabel detail={entry.aiGenerated ? "Coach can get things wrong. Check anything important." : undefined}>{entry.label}</AiLabel>
              {entry.aiGenerated ? <Markdown topHeadingLevel={4}>{entry.text}</Markdown> : <p className="whitespace-pre-wrap">{entry.text}</p>}
              {!entry.streaming && (
                <div className="flex justify-end">
                  <ReportControl target={{ type: "ai_output", id: entry.messageId ?? `${courseSlug}:${stepKey}`, stepKey }} compact label="Report this answer" />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {busy && (
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <Spinner decorative size="sm" /> Coach is thinking…
        </p>
      )}

      {stop && (
        <Callout tone={stop.code === "credits_exhausted" || stop.code === "ai_break" ? "info" : "warning"} title={STOP_TITLES[stop.code] ?? "Coach isn't available right now"} live="status">
          <p>{stop.message}</p>
          {hints.length > 0 && <p>The hints for this step are still here whenever you need them.</p>}
        </Callout>
      )}
      {problem && (
        <Callout tone="warning" title="That didn't go through" live="status">
          <p>{problem}</p>
        </Callout>
      )}

      <div ref={logEnd} />

      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={stuck} loading={busy && hintsLeft <= 0} disabled={hintsLeft <= 0 && !canAskCoach} iconStart={<Lightbulb aria-hidden="true" className="size-5" strokeWidth={2.5} />}>
          {stuckLabel}
        </Button>
        {hints.length > 0 && hintsShown === 0 && <p className="text-ink-muted text-sm">You&apos;ll get the step&apos;s own hints first, one at a time. They don&apos;t use any energy.</p>}

        {canAskCoach && (
          <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Ask Coach">
            <Field label="Ask Coach a question" hint="Say what you've tried and what happened. Leave out personal details. Press Ctrl and Enter to send.">
              <Textarea id={inputId} name="message" rows={3} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} autoComplete="off" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={busy} loadingText="Sending…" aria-disabled={draft.trim().length === 0 || undefined} iconEnd={<Send aria-hidden="true" className="size-4" strokeWidth={2.5} />}>
                Send to Coach
              </Button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
