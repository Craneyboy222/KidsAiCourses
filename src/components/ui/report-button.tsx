"use client";

import { CircleCheck, Flag } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { Callout } from "./callout";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { FormError } from "./form-error";
import { RadioGroup } from "./radio-group";
import { Textarea } from "./textarea";

export type ReportReason = {
  value: string;
  label: string;
  description?: string;
  /** Marks the "Someone is in danger" reason. Choosing it shows the urgent-help message straight away. */
  urgent?: boolean;
};

export type ReportSubmission = { reason: string; details: string };

export type ReportButtonProps = {
  /** The reasons to offer. Must include one for "Someone is in danger" (mark it `urgent`). */
  reasons: ReportReason[];
  /** Sends the report. Throw (or reject) with a friendly message to show it in the dialog. */
  onSubmit: (report: ReportSubmission) => void | Promise<void>;
  /** What is being reported, in the sentence "Report {subject}": "this step", "this Coach reply". */
  subject?: string;
  /** The button's text. */
  label?: string;
  /** `quiet` is a small text button for use on every step and AI reply; `button` is a full secondary button. */
  appearance?: "quiet" | "button";
  /** Icon only, for tight spaces. The label is still the button's accessible name. */
  iconOnly?: boolean;
  /**
   * Shown when an urgent reason is picked. Replace it with the approved crisis wording once the DSL has signed it off.
   */
  urgentHelp?: ReactNode;
};

const DEFAULT_URGENT_HELP = (
  <>
    <p>If someone is in danger right now, call 999.</p>
    <p>
      You can also talk to Childline free on 0800 1111, any time. Send this report as well and our
      safeguarding lead will see it straight away.
    </p>
  </>
);

/**
 * The Report control that sits on every step, course, project and AI output.
 * Opens a dialog with the reasons passed in, an optional note, and a clear
 * confirmation once the report has gone.
 */
export function ReportButton({
  reasons,
  onSubmit,
  subject = "this",
  label = "Report",
  appearance = "quiet",
  iconOnly = false,
  urgentHelp = DEFAULT_URGENT_HELP,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const formId = useId();
  const chosen = reasons.find((r) => r.value === reason);

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setReason("");
      setDetails("");
      setReasonError(undefined);
      setFailure(undefined);
      setSent(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!reason) {
      setReasonError("Choose the reason that fits best.");
      return;
    }
    setReasonError(undefined);
    setFailure(undefined);
    try {
      setBusy(true);
      await onSubmit({ reason, details: details.trim() });
      setSent(true);
    } catch (error) {
      setFailure(
        error instanceof Error && error.message
          ? error.message
          : "Your report didn't send. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      title={sent ? "Report sent" : `Report ${subject}`}
      description={sent ? undefined : "Tell us what's wrong. Reports go to our team, not to anyone else."}
      trigger={
        iconOnly ? (
          <IconButton
            label={label}
            variant={appearance === "button" ? "secondary" : "ghost"}
            size="sm"
            icon={<Flag aria-hidden="true" className="size-4" strokeWidth={2.5} />}
          />
        ) : (
          <Button
            variant={appearance === "button" ? "secondary" : "ghost"}
            size={appearance === "button" ? "md" : "sm"}
            iconStart={<Flag aria-hidden="true" className="size-4" strokeWidth={2.5} />}
          >
            {label}
          </Button>
        )
      }
      footer={
        sent ? (
          <Button onClick={() => changeOpen(false)}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={busy} loadingText="Sending…">
              Send report
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="flex items-start gap-2 font-bold">
            <CircleCheck
              aria-hidden="true"
              className="text-success mt-0.5 size-5 shrink-0"
              strokeWidth={2.5}
            />
            <span>Thanks for telling us. A person on our team will look at it.</span>
          </p>
          {chosen?.urgent && <Callout tone="danger">{urgentHelp}</Callout>}
        </div>
      ) : (
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError message={failure} title="That didn't send" />
          <RadioGroup
            legend="What's the problem?"
            name="reason"
            required
            options={reasons.map((r) => ({ value: r.value, label: r.label, description: r.description }))}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(undefined);
            }}
            error={reasonError}
          />
          {chosen?.urgent && (
            <Callout tone="danger" live="alert">
              {urgentHelp}
            </Callout>
          )}
          <Field
            label="Anything else we should know?"
            optional
            hint="Leave out passwords and personal details like your address or phone number."
          >
            <Textarea
              name="details"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </Field>
        </form>
      )}
    </Dialog>
  );
}
