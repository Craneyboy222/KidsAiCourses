"use client";

import { ActionForm, Field, FormError, Input, RadioGroup, SubmitButton, useActionForm, type ActionState, type ButtonVariant, type RadioOption } from "@/components/ui";

export type BillingAction = (prev: ActionState<null>, formData: FormData) => Promise<ActionState<null>>;

export type BillingActionFormProps = {
  /** A Server Action that redirects on success (to Stripe, or back to the billing page). */
  action: BillingAction;
  label: string;
  pendingText?: string;
  variant?: ButtonVariant;
  /** What this button does, for the form's accessible name. */
  describedAs: string;
  /** Hidden fields sent with the form. */
  fields?: Record<string, string>;
};

/** One button that sends the person to a Stripe-hosted page. Works without JavaScript; errors are read out. */
export function BillingActionForm({ action, label, pendingText = "Opening the secure page…", variant = "primary", describedAs, fields }: BillingActionFormProps) {
  const form = useActionForm<null>(action);
  return (
    <ActionForm action={form.formAction} aria-label={describedAs} className="flex flex-col gap-3">
      <FormError {...form.summaryProps} />
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <SubmitButton variant={variant} pendingText={pendingText}>
          {label}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export type PlanChoiceFormProps = {
  action: BillingAction;
  planKey: string;
  /** One per way of paying. The labels carry the amounts, worked out on the server from the plan's own data. */
  options: RadioOption[];
  defaultInterval: string;
  submitLabel: string;
};

/**
 * The plan choice: how often to be billed, and an optional promo code. Rendered only for a parent,
 * a carer or an adult account owner: the page that uses it has already checked.
 */
export function PlanChoiceForm({ action, planKey, options, defaultInterval, submitLabel }: PlanChoiceFormProps) {
  const form = useActionForm<null>(action);
  return (
    <ActionForm action={form.formAction} aria-label="Choose how to be billed" className="flex flex-col gap-5">
      <FormError {...form.summaryProps} fieldLabels={{ interval: "How you'd like to be billed", promoCode: "Promo code" }} />
      <input type="hidden" name="planKey" value={planKey} />
      <RadioGroup legend="How would you like to be billed?" name="interval" options={options} defaultValue={defaultInterval} error={form.fieldError("interval")} required />
      <Field label="Promo code" optional hint="If you have one, add it here. It is checked before you leave this page." error={form.fieldError("promoCode")}>
        <Input name="promoCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} className="max-w-xs" />
      </Field>
      <div>
        <SubmitButton pendingText="Opening the secure page…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
