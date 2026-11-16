"use client";

import { ArrowDown, ArrowUp, Check, Lightbulb, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { EditableBlock, EditableText } from "@/components/course/Editable";
import { VideoPlayer, type VideoPlayerProps } from "@/components/course/VideoPlayer";
import { Badge, Button, Callout, Checkbox, Field, IconButton, LiveRegion, RadioGroup, Textarea } from "@/components/ui";
import type { LearnerQuiz, LearnerQuizQuestion } from "@/content/schema";
import { coursePaths } from "@/lib/learning/paths";
import type { QuizAnswers, QuizResult } from "@/lib/learning/quiz-grading";
import { usePlayer } from "./store";

const MAX_TEXT_LENGTH = 5000;

/** The video on a `video` step: remembers the position and speed, and reports how much was watched. */
export function StepVideo(props: Pick<VideoPlayerProps, "title" | "src" | "captionsSrc" | "posterSrc" | "transcript">) {
  const store = usePlayer();
  const { data } = store.current;
  return (
    <VideoPlayer
      {...props}
      initialPosition={data.position}
      initialSpeed={data.speed}
      onProgress={(watchedFraction, position) => store.update({ data: { watchedFraction, position } })}
      onSpeedChange={(speed) => store.update({ data: { speed } })}
      onTranscriptRead={() => store.update({ data: { transcriptRead: true } })}
      unavailableText="You can carry on to the next step: this one won't hold you up."
    />
  );
}

/** "I've done this": the learner's own word that a step is finished (`self_tick`, `setup_acknowledged`). */
export function TickBox({ label, description }: { label: ReactNode; description?: ReactNode }) {
  const store = usePlayer();
  const done = store.current.status === "completed";
  return (
    <Checkbox
      label={label}
      description={description}
      checked={done || store.current.data.ticked === true}
      disabled={done || store.step.disabled}
      onChange={(event) => store.update({ data: { ticked: event.target.checked } })}
    />
  );
}

/** One setup-guide step ticked off. */
export function GuideTick({ guideStepId, label }: { guideStepId: string; label: ReactNode }) {
  const store = usePlayer();
  const ticks = store.current.data.guideTicks ?? [];
  const done = store.current.status === "completed";
  return (
    <Checkbox
      label={label}
      checked={done || ticks.includes(guideStepId)}
      disabled={done || store.step.disabled}
      onChange={(event) => store.update({ data: { guideTicks: event.target.checked ? [...new Set([...ticks, guideStepId])] : ticks.filter((id) => id !== guideStepId) } })}
    />
  );
}

/**
 * The learner's own words on a reflection or an ethics checkpoint. Autosaved. Never shown to a parent
 * or to another learner. The wording does not promise that nobody at all can ever read it: whether
 * staff may see flagged text for safeguarding is an open question (docs/OPEN_QUESTIONS.md).
 */
export function ResponseBox({ label }: { label: ReactNode }) {
  const store = usePlayer();
  return (
    <Field label={label} hint="This is private. Your parent or carer and other learners can't read it.">
      <Textarea rows={6} maxLength={MAX_TEXT_LENGTH} value={store.current.response} disabled={store.step.disabled} onChange={(event) => store.update({ response: event.target.value })} />
    </Field>
  );
}

/** Private notes on any step. */
export function NotesBox() {
  const store = usePlayer();
  if (store.step.disabled) return null;
  return (
    <details className="rounded-card border-ink bg-surface border-2" open={store.current.notes.length > 0 || undefined}>
      <summary className="hover:bg-tint flex min-h-11 items-center px-4 py-2 font-bold -outline-offset-4">My notes</summary>
      <div className="border-line border-t-2 p-4">
        <Field label="Notes for this step" hint="Private to you: your parent or carer and other learners can't see these. They save by themselves.">
          <Textarea rows={4} maxLength={MAX_TEXT_LENGTH} value={store.current.notes} onChange={(event) => store.update({ notes: event.target.value })} />
        </Field>
      </div>
    </details>
  );
}

/**
 * Tiered hints, one at a time (spec 3.2). Coach is offered once the step's own hints have run out,
 * so a learner always tries the course's hints before asking the AI.
 */
export function HintLadder({ hints }: { hints: ReactNode[] }) {
  const store = usePlayer();
  const [announcement, setAnnouncement] = useState("");
  if (hints.length === 0 || store.step.disabled) return null;
  const shown = Math.min(store.current.data.hintLevel ?? 0, hints.length);
  const more = shown < hints.length;
  return (
    <section aria-label="Hints" className="rounded-card border-ink bg-surface flex flex-col gap-3 border-2 p-4">
      <LiveRegion>{announcement}</LiveRegion>
      {shown > 0 && (
        <ol className="flex flex-col gap-2">
          {hints.slice(0, shown).map((hint, index) => (
            <li key={index} className="flex gap-2">
              <Lightbulb aria-hidden="true" className="mt-1 size-5 shrink-0" strokeWidth={2.25} />
              <p>
                <span className="font-bold">
                  Hint {index + 1} of {hints.length}:
                </span>{" "}
                {hint}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {more ? (
          <Button
            variant="secondary"
            onClick={() => {
              store.update({ data: { hintLevel: shown + 1 } });
              setAnnouncement(`Hint ${shown + 1} of ${hints.length} is showing.`);
            }}
          >
            {shown === 0 ? "Show a hint" : "Show another hint"}
          </Button>
        ) : (
          <>
            <p className="text-ink-muted">That&apos;s all the hints for this step.</p>
            <Button variant="secondary" onClick={() => store.setCoachOpen(true)}>
              Still stuck? Ask Coach
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/** A small "Done" marker once the step is complete. Words and an icon, never colour alone. */
export function DoneBadge() {
  const store = usePlayer();
  if (store.current.status !== "completed") return null;
  return (
    <Badge tone="success" icon={<Check aria-hidden="true" className="size-4" strokeWidth={3} />}>
      Done
    </Badge>
  );
}

/** How far through the course the learner is, for a checkpoint. Disabled steps are not counted. */
export function CheckpointProgress({ order }: { order: { key: string; disabled: boolean }[] }) {
  const store = usePlayer();
  const counted = order.filter((entry) => !entry.disabled);
  const done = counted.filter((entry) => store.statuses[entry.key] === "completed" || entry.key === store.step.key).length;
  const skipped = counted.filter((entry) => store.statuses[entry.key] === "skipped" && entry.key !== store.step.key).length;
  return (
    <p className="text-lg">
      <span className="font-bold">
        {done} of {counted.length} steps done.
      </span>{" "}
      {skipped > 0 ? `${skipped} skipped: you can go back to ${skipped === 1 ? "it" : "them"} any time.` : "Nice work. Take a break if you want one: your place is saved."}
    </p>
  );
}

// ───────────────────────────── Quiz ─────────────────────────────

const moved = (list: string[], index: number, delta: number): string[] => {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
};

type QuestionProps = {
  quizId: string;
  question: LearnerQuizQuestion;
  number: number;
  value: string[];
  onChange: (value: string[]) => void;
  graded: QuizResult["questions"][number] | undefined;
  locked: boolean;
};

function Question({ quizId, question, number, value, onChange, graded, locked }: QuestionProps) {
  const name = useId();
  const path = coursePaths.question(quizId, question.id);
  const optionText = (optionId: string, text: string) => <EditableText path={`${coursePaths.option(quizId, question.id, optionId)}.text`} value={text} />;
  const prompt = (
    <>
      <span className="text-ink-muted">Question {number}. </span>
      <EditableText path={`${path}.prompt`} value={question.prompt} />
    </>
  );
  const feedbackFor = (optionId: string) => graded?.options.find((option) => option.optionId === optionId);

  let control: ReactNode;
  if (question.kind === "order") {
    // No dragging: every item has Move up and Move down buttons (WCAG 2.5.7).
    const order = value.length === question.options.length ? value : question.options.map((option) => option.id);
    const byId = new Map(question.options.map((option) => [option.id, option]));
    control = (
      <fieldset className="flex min-w-0 flex-col gap-2" disabled={locked}>
        <legend className="text-ink font-bold">{prompt}</legend>
        <p className="text-ink-muted text-sm">Put these in order with the arrow buttons. The first item is at the top.</p>
        <ol className="flex flex-col gap-2">
          {order.map((optionId, index) => {
            const option = byId.get(optionId);
            if (!option) return null;
            const mark = feedbackFor(optionId);
            return (
              <li key={optionId} className="rounded-control border-ink bg-surface flex items-center gap-2 border-2 p-2">
                <span className="w-6 shrink-0 text-center font-bold">{index + 1}</span>
                <span className="min-w-0 flex-1">{optionText(option.id, option.text)}</span>
                <IconButton
                  label={`Move “${option.text}” up`}
                  icon={<ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.5} />}
                  variant="secondary"
                  size="sm"
                  aria-disabled={index === 0 || undefined}
                  onClick={() => index > 0 && onChange(moved(order, index, -1))}
                />
                <IconButton
                  label={`Move “${option.text}” down`}
                  icon={<ArrowDown aria-hidden="true" className="size-4" strokeWidth={2.5} />}
                  variant="secondary"
                  size="sm"
                  aria-disabled={index === order.length - 1 || undefined}
                  onClick={() => index < order.length - 1 && onChange(moved(order, index, 1))}
                />
                {mark && <span className="sr-only">{mark.correct ? "In the right place." : "Not in the right place."}</span>}
              </li>
            );
          })}
        </ol>
      </fieldset>
    );
  } else if (question.kind === "multi") {
    control = (
      <fieldset className="flex min-w-0 flex-col" disabled={locked}>
        <legend className="text-ink font-bold">{prompt}</legend>
        <p className="text-ink-muted text-sm">Choose every answer that fits.</p>
        {question.options.map((option) => (
          <Checkbox
            key={option.id}
            label={optionText(option.id, option.text)}
            checked={value.includes(option.id)}
            onChange={(event) => onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))}
          />
        ))}
      </fieldset>
    );
  } else {
    control = (
      <fieldset disabled={locked} className="min-w-0">
        <RadioGroup
          legend={prompt}
          hint={question.kind === "spot_the_problem" ? "Pick the one with the problem." : undefined}
          name={name}
          value={value[0] ?? ""}
          onChange={(event) => onChange([event.target.value])}
          options={question.options.map((option) => ({ value: option.id, label: optionText(option.id, option.text) }))}
        />
      </fieldset>
    );
  }

  return (
    <EditableBlock path={path} kind="quiz_question" label={`Question ${number}`}>
      <div className="rounded-card border-ink bg-surface flex flex-col gap-3 border-2 p-4">
        {control}
        {graded && (
          <div className="border-line flex flex-col gap-2 border-t-2 pt-3">
            <p className="flex items-center gap-2 font-bold">
              {graded.correct ? <Check aria-hidden="true" className="size-5 shrink-0" strokeWidth={3} /> : <X aria-hidden="true" className="size-5 shrink-0" strokeWidth={3} />}
              {graded.correct ? "Correct" : graded.answered ? "Not quite" : "Not answered"}
            </p>
            {graded.options
              .filter((option) => option.feedback.trim().length > 0)
              .map((option) => (
                <p key={option.optionId} className="text-ink-muted">
                  <span className="text-ink font-bold">{question.options.find((entry) => entry.id === option.optionId)?.text}: </span>
                  {option.feedback}
                </p>
              ))}
          </div>
        )}
      </div>
    </EditableBlock>
  );
}

/**
 * A quiz (spec 3.2): single choice, multiple choice, put-in-order and spot-the-problem. No timer,
 * as many tries as you like. Answers are marked on the server, which sends back feedback for what
 * was chosen; this component never holds the answer key.
 */
export function QuizForm({ quiz, passMark }: { quiz: LearnerQuiz; passMark: number }) {
  const store = usePlayer();
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passedBefore = store.current.quiz?.passed === true;
  const locked = busy || result !== null || store.step.disabled;

  async function check() {
    setBusy(true);
    setError(null);
    // An untouched ordering question is answered with the order on screen.
    const complete: QuizAnswers = Object.fromEntries(quiz.questions.map((question) => [question.id, answers[question.id] ?? (question.kind === "order" ? question.options.map((option) => option.id) : [])]));
    const outcome = await store.submitQuiz(complete);
    setBusy(false);
    if ("error" in outcome) setError(outcome.error);
    else setResult(outcome);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted">
        {quiz.questions.length} {quiz.questions.length === 1 ? "question" : "questions"}. You need {Math.round(passMark * 100)}% to pass. No timer, and you can try as many times as you like.
      </p>
      {passedBefore && !result && (
        <Callout tone="success" title="You've already passed this quiz">
          <p>You can have another go if you want the practice. It won&apos;t undo your pass.</p>
        </Callout>
      )}
      {quiz.questions.map((question, index) => (
        <Question
          key={question.id}
          quizId={quiz.id}
          question={question}
          number={index + 1}
          value={answers[question.id] ?? []}
          onChange={(value) => setAnswers((before) => ({ ...before, [question.id]: value }))}
          graded={result?.questions.find((entry) => entry.questionId === question.id)}
          locked={locked}
        />
      ))}
      {error && (
        <Callout tone="danger" live="alert" title="That didn't go through">
          <p>{error}</p>
        </Callout>
      )}
      {result ? (
        <Callout
          tone={result.passed ? "success" : "warning"}
          live="status"
          title={result.passed ? `Passed: ${result.correctCount} of ${result.total} right` : `${result.correctCount} of ${result.total} right. You need ${result.passMark}% to pass`}
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setAnswers({});
              }}
            >
              {result.passed ? "Try it again for practice" : "Try again"}
            </Button>
          }
        >
          <p>{result.passed ? "This step is done. Read the feedback, then carry on when you're ready." : "Read the feedback under each question, then have another go. There's no limit on tries."}</p>
        </Callout>
      ) : (
        <div>
          <Button onClick={() => void check()} loading={busy} loadingText="Checking your answers…" aria-disabled={store.step.disabled || undefined}>
            Check my answers
          </Button>
        </div>
      )}
    </div>
  );
}
