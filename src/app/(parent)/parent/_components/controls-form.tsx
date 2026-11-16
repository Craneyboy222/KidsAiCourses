"use client";

import { ActionForm, Callout, Checkbox, Field, FormError, Input, Select, SubmitButton, Switch, useActionForm } from "@/components/ui";
import { saveControlsAction } from "../children/[id]/actions";

export type ControlsFormProps = {
  learnerId: string;
  nickname: string;
  /** Minutes, as text, or `none`. */
  dailyCap: string;
  capOptions: { value: string; label: string }[];
  quietEnabled: boolean;
  /** `HH:MM`. */
  quietStart: string;
  quietEnd: string;
  categories: { slug: string; label: string; blocked: boolean }[];
  courses: { id: string; title: string; detail: string; blocked: boolean }[];
  /** Courses that are blocked but not in the list just now (taken down, or for an older age group). Kept blocked on save. */
  keptCourseIds: string[];
  requireApprovalForPro: boolean;
};

/**
 * The limits for one child. A plain form: it posts and saves without JavaScript, and every
 * control has a visible label. Nothing here is applied until Save.
 */
export function ControlsForm(props: ControlsFormProps) {
  const form = useActionForm(saveControlsAction);
  const { nickname } = props;

  return (
    <ActionForm action={form.formAction} aria-label={`${nickname}'s limits`} className="gap-8">
      <FormError
        {...form.summaryProps}
        fieldLabels={{ dailyCap: "Daily time limit", quietStart: "Quiet hours start", quietEnd: "Quiet hours end", blockedCategories: "Blocked subjects", blockedCourseIds: "Blocked courses" }}
      />
      {form.succeeded && (
        <Callout tone="success" title="Saved" live="status">
          <p>These limits apply from {nickname}&apos;s next page or step. Nothing they have done is lost.</p>
        </Callout>
      )}
      <input type="hidden" name="learnerId" value={props.learnerId} />
      {props.keptCourseIds.map((id) => (
        <input key={id} type="hidden" name="blockedCourseIds" value={id} />
      ))}

      <section aria-labelledby="time-title" className="flex flex-col gap-4">
        <h2 id="time-title" className="text-2xl font-bold">
          Time
        </h2>
        <Field
          label="Daily time limit"
          hint={`How long ${nickname} can spend learning each day. When the time is up their work is saved and they can carry on tomorrow.`}
          error={form.fieldError("dailyCap")}
          className="max-w-md"
        >
          <Select name="dailyCap" defaultValue={props.dailyCap} options={props.capOptions} />
        </Field>

        <fieldset className="rounded-card border-line flex flex-col gap-3 border-2 p-4">
          <legend className="px-1 font-bold">Quiet hours</legend>
          <p className="text-ink-muted">A stretch of the day or night with no learning and no notices, for example overnight. The times are UK time.</p>
          <Switch name="quietEnabled" label="Use quiet hours" defaultChecked={props.quietEnabled} description="Switch off to allow learning at any time of day." />
          <div className="flex flex-wrap gap-4">
            <Field label="Quiet hours start" error={form.fieldError("quietStart")}>
              <Input type="time" name="quietStart" defaultValue={props.quietStart} className="w-40" />
            </Field>
            <Field label="Quiet hours end" error={form.fieldError("quietEnd")}>
              <Input type="time" name="quietEnd" defaultValue={props.quietEnd} className="w-40" />
            </Field>
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="content-title" className="flex flex-col gap-4">
        <h2 id="content-title" className="text-2xl font-bold">
          What they can see
        </h2>
        <p className="text-ink-muted">
          A blocked subject or course disappears from {nickname}&apos;s catalogue and can&apos;t be opened, even from a direct link. Courses for older age groups are already hidden.
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-bold">Blocked subjects</legend>
          {form.fieldError("blockedCategories") && <p className="text-danger font-bold">{form.fieldError("blockedCategories")}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-x-6 gap-y-1">
            {props.categories.map((category) => (
              <Checkbox key={category.slug} name="blockedCategories" value={category.slug} label={category.label} defaultChecked={category.blocked} />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-bold">Blocked courses</legend>
          {form.fieldError("blockedCourseIds") && <p className="text-danger font-bold">{form.fieldError("blockedCourseIds")}</p>}
          {props.courses.length === 0 ? (
            <p className="text-ink-muted">There are no courses to choose from yet.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-x-6 gap-y-1">
              {props.courses.map((course) => (
                <Checkbox key={course.id} name="blockedCourseIds" value={course.id} label={course.title} description={course.detail} defaultChecked={course.blocked} />
              ))}
            </div>
          )}
        </fieldset>

        <Checkbox
          name="requireApprovalForPro"
          label="Ask me before a Pro course is started"
          description={`Pro is our hardest level. With this on, ${nickname} sends you a request and can't start a Pro course until you say yes.`}
          defaultChecked={props.requireApprovalForPro}
        />
      </section>

      <div>
        <SubmitButton loading={form.pending} pendingText="Saving…">
          Save limits
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
