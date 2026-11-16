"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { addLinkAction, completeUploadAction, removeEvidenceAction, requestUploadAction, submitWorkAction } from "@/app/(learner)/portfolio/actions";
import { Button, Callout, Checkbox, Field, FormError, Input, LiveRegion, RadioGroup, SubmitButton, Textarea, useActionForm } from "@/components/ui";
import type { Rubric } from "@/content/schema";
import type { EvidenceItem, SubmissionState } from "@/server/services/submission";
import { KIND_LABELS, NO_PEOPLE_RULE, declaredTypeFor, type EvidenceKind } from "./evidence-copy";
import { EvidenceItemRow } from "./EvidenceItemRow";

type UploadKind = Exclude<EvidenceKind, "link">;

const TYPE_HINTS: Record<UploadKind, string> = { screenshot: "PNG, JPG or WebP", file: "PDF, Word, text, CSV or audio", video: "MP4, WebM or MOV" };

/** A full reload, so the player around this step picks up the step's new state from the server. */
const reloadPage = (): void => window.location.reload();

function LinkForm({ state, onAdded }: { state: SubmissionState; onAdded: () => void }) {
  const form = useActionForm(addLinkAction, { onSuccess: onAdded });
  return (
    <form action={form.formAction} className="flex flex-col gap-3">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="enrolmentId" value={state.enrolmentId} />
      <input type="hidden" name="stepId" value={state.stepId} />
      <Field label="Link to your project" hint="Use the Share button in your project and paste the link. It must start with https://" error={form.fieldError("url")}>
        <Input name="url" type="url" inputMode="url" autoComplete="off" placeholder="https://" required />
      </Field>
      <Checkbox
        name="declaredNoPeople"
        label="My project doesn't show any real people, including me"
        description="We don't open your link to look, so we're trusting you. If someone real is in it, swap them for the sample image, a cartoon or an object first."
        error={form.fieldError("declaredNoPeople")}
      />
      <div>
        <SubmitButton variant="secondary" pendingText="Checking your link…">
          Add link
        </SubmitButton>
      </div>
    </form>
  );
}

function UploadField({ kind, state, onDone }: { kind: UploadKind; state: SubmissionState; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const limit = state.limitsMb[kind];

  async function send(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || busy) return;
    setError(undefined);
    const fail = (message: string) => {
      setError(message);
      setBusy(false);
      if (input.current) input.current.value = "";
    };
    if (file.size > limit * 1024 * 1024) return fail(`That file is too big. The limit here is ${limit} MB.`);
    setBusy(true);
    try {
      // The file's own name stays on this device: only its type and size are sent.
      const ticket = await requestUploadAction({ enrolmentId: state.enrolmentId, stepId: state.stepId, kind, contentType: declaredTypeFor(file), sizeBytes: file.size });
      if (!ticket.ok) return fail(ticket.error.message);
      const sent = await fetch(ticket.data.upload.url, { method: ticket.data.upload.method, headers: ticket.data.upload.headers, body: file });
      if (!sent.ok) return fail("The upload didn't finish. Check your connection and try again.");
      const done = await completeUploadAction(ticket.data.artefactId);
      if (!done.ok) return fail(done.error.message);
      setBusy(false);
      if (input.current) input.current.value = "";
      onDone(done.data.state === "rejected" ? (done.data.message ?? "That wasn't accepted.") : `${KIND_LABELS[kind].name} added.`);
    } catch {
      fail("The upload didn't finish. Check your connection and try again.");
    }
  }

  return (
    <Field label={KIND_LABELS[kind].add} hint={`${TYPE_HINTS[kind]}, up to ${limit} MB.${busy ? " Uploading and checking…" : ""}`} error={error}>
      <Input ref={input} type="file" accept={state.acceptTypes[kind].join(",")} onChange={send} disabled={busy} />
    </Field>
  );
}

function HandInForm({ state, criteria, deliverables, onDone }: { state: SubmissionState; criteria: Rubric["criteria"]; deliverables: readonly string[]; onDone: (showCrisisScript: boolean) => void }) {
  const form = useActionForm(submitWorkAction, { onSuccess: (data) => onDone(data.showCrisisScript) });
  return (
    <form action={form.formAction} className="flex flex-col gap-5">
      <h3 className="text-xl font-bold">Hand in your project</h3>
      <FormError {...form.summaryProps} />
      <input type="hidden" name="enrolmentId" value={state.enrolmentId} />
      <input type="hidden" name="stepId" value={state.stepId} />
      {deliverables.length > 0 && (
        <div>
          <p className="font-bold">Before you hand in, check your project has:</p>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {deliverables.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      <Field label="Project title" optional hint="Give it a name, or keep this one." error={form.fieldError("title")}>
        <Input name="title" defaultValue={state.title} maxLength={80} />
      </Field>
      {criteria.length > 0 && (
        <fieldset className="flex flex-col gap-4">
          <legend className="text-lg font-bold">Rate your own project</legend>
          <p className="text-ink-muted">Be honest: &ldquo;Not yet&rdquo; never stops you handing in.</p>
          {criteria.map((criterion) => (
            <RadioGroup
              key={criterion.id}
              legend={criterion.name}
              hint={criterion.description}
              name={`selfCheck.${criterion.id}`}
              required={state.requireSelfCheck}
              defaultValue={state.selfCheck[criterion.id]}
              options={criterion.levels.map((level) => ({ value: level.label, label: level.label, description: level.descriptor }))}
              error={form.fieldError(`selfCheck.${criterion.id}`)}
            />
          ))}
        </fieldset>
      )}
      <Field label="Honesty note" optional hint="Did AI, a friend or a tutorial help with any of it? Say what, in a sentence or two. Leave out personal details." error={form.fieldError("note")}>
        <Textarea name="note" rows={3} maxLength={1000} defaultValue={state.note} />
      </Field>
      <div>
        <SubmitButton size="lg" pendingText="Checking and sending…">
          {state.status === "needs_changes" ? "Hand in again" : "Hand in my project"}
        </SubmitButton>
      </div>
    </form>
  );
}

export type EvidenceFormProps = {
  state: SubmissionState;
  hint: string;
  deliverables: readonly string[];
  criteria: Rubric["criteria"];
  /** The fixed urgent-help wording, shown if a note raises a safety flag. */
  urgentHelp: string;
};

/**
 * The evidence step as the learner uses it: add a link or an upload, see what happened to each
 * one, and (on the final step) rate the project and hand it in. All state comes from the server;
 * after each action the page is refreshed rather than guessed at.
 */
export function EvidenceForm({ state, hint, deliverables, criteria, urgentHelp }: EvidenceFormProps) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");
  const [failure, setFailure] = useState<string>();
  const [showHelp, setShowHelp] = useState(false);
  const isSubmit = state.stepType === "submit";
  const locked = isSubmit && (state.status === "awaiting_review" || state.status === "accepted");
  const uploadKinds = state.allowedKinds.filter((kind): kind is UploadKind => kind !== "link");

  const changed = (message: string) => {
    setAnnouncement(message);
    // On an upload step every addition can change whether the step is done, so the whole page is reloaded.
    if (isSubmit) router.refresh();
    else reloadPage();
  };

  async function remove(item: EvidenceItem) {
    setFailure(undefined);
    const result = await removeEvidenceAction(item.id);
    if (!result.ok) setFailure(result.error.message);
    else changed(`${KIND_LABELS[item.kind].name} removed.`);
  }

  if (showHelp) {
    return (
      <div className="flex flex-col gap-4" data-testid="evidence-form">
        <Callout tone="info" title="Your project has been sent in" live="status">
          <p>A person on our team will look at it.</p>
        </Callout>
        <Callout tone="danger" live="alert">
          <p>{urgentHelp}</p>
        </Callout>
        <div>
          <Button onClick={reloadPage}>Carry on</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="evidence-form">
      <LiveRegion>{announcement}</LiveRegion>

      {state.status === "accepted" && (
        <Callout tone="success" title={isSubmit ? "Accepted: it's in your portfolio" : "Accepted"}>
          {isSubmit && state.projectId ? (
            <p>
              Nice work.{" "}
              <Link className="link" href={`/portfolio/${state.projectId}`}>
                See it in your portfolio
              </Link>
              .
            </p>
          ) : (
            <p>Nice work. You can carry on.</p>
          )}
        </Callout>
      )}
      {state.status === "awaiting_review" && (
        <Callout tone="info" title="Sent in: awaiting review">
          <p>A person on our team checks some work before it&apos;s accepted. It usually takes a day or two. You don&apos;t need to do anything, and we&apos;ll tell you as soon as it&apos;s done.</p>
        </Callout>
      )}
      {state.status === "needs_changes" && (
        <Callout tone="warning" title="This needs a change before it can be accepted">
          {state.submitted?.message && <p>{state.submitted.message}</p>}
          <p>Add what&apos;s needed below, then {isSubmit ? "hand it in again" : "send it again"}. Your earlier go is kept.</p>
        </Callout>
      )}

      {hint && <p>{hint}</p>}

      {!locked && (
        <section aria-label="Add your evidence" className="flex flex-col gap-5">
          <Callout tone="info" title="No real people">
            <p>{NO_PEOPLE_RULE}</p>
          </Callout>
          <FormError message={failure} />
          {state.allowedKinds.includes("link") && <LinkForm state={state} onAdded={() => changed("Link added.")} />}
          {uploadKinds.map((kind) => (
            <UploadField key={kind} kind={kind} state={state} onDone={changed} />
          ))}
        </section>
      )}

      {state.items.length > 0 && (
        <section aria-labelledby="evidence-list" className="flex flex-col gap-3">
          <h3 id="evidence-list" className="text-xl font-bold">
            {isSubmit ? "Ready to hand in" : "What you've sent"}
          </h3>
          <ul className="flex list-none flex-col gap-3 p-0">
            {state.items.map((item) => {
              const removable = !locked && (item.state === "rejected" || (isSubmit && item.state === "ready"));
              return (
                <EvidenceItemRow
                  key={item.id}
                  item={item}
                  action={
                    removable ? (
                      <Button variant="ghost" size="sm" iconStart={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => remove(item)}>
                        {item.state === "rejected" ? "Clear this" : "Remove"}
                        <span className="sr-only"> {KIND_LABELS[item.kind].name.toLowerCase()}</span>
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      {isSubmit && !locked && <HandInForm state={state} criteria={criteria} deliverables={deliverables} onDone={(crisis) => (crisis ? setShowHelp(true) : reloadPage())} />}

      {state.submitted && (
        <section aria-labelledby="evidence-sent" className="flex flex-col gap-3">
          <h3 id="evidence-sent" className="text-xl font-bold">
            {state.status === "needs_changes" ? "What you sent last time" : "What you handed in"}
          </h3>
          <ul className="flex list-none flex-col gap-3 p-0">
            {state.submitted.items.map((item) => (
              <EvidenceItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
