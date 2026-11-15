"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { ActionError, ActionState } from "@/server/action";
import { firstError } from "./field";

export type { ActionError, ActionState };

export type UseActionFormOptions<T> = {
  /** Called once each time the action succeeds. */
  onSuccess?: (data: T) => void;
};

export type UseActionForm<T> = {
  /** Pass to `<form action={formAction}>`. */
  formAction: (formData: FormData) => void;
  /** True while the action is running. */
  pending: boolean;
  /** The raw result of the last run, or `null` before the first. */
  state: ActionState<T>;
  /** The form-level message when the last run failed. Pass to `<FormError message>`. */
  error: string | undefined;
  /** All field errors from the last run. Pass to `<FormError fieldErrors>`. */
  fieldErrors: Record<string, string[]> | undefined;
  /** The first error for one field. Pass to `<Field error>`. */
  fieldError: (name: string) => string | undefined;
  /**
   * Spread onto `<FormError {...form.summaryProps} />`. It carries the message, the field errors and an `id`;
   * when the action fails, focus moves to the element with that id so the problem is read out.
   */
  summaryProps: {
    id: string;
    message: string | undefined;
    fieldErrors: Record<string, string[]> | undefined;
  };
  /** The data from the last successful run. */
  data: T | undefined;
  succeeded: boolean;
};

/**
 * A thin layer over React 19 `useActionState` for actions that return
 * `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`
 * (see `runAction` in `@/server/action`).
 *
 * ```tsx
 * const form = useActionForm(addChild);
 * <form action={form.formAction}>
 *   <FormError {...form.summaryProps} />
 *   <Field label="Nickname" error={form.fieldError("nickname")}><Input name="nickname" /></Field>
 *   <SubmitButton>Add child</SubmitButton>
 * </form>
 * ```
 */
export function useActionForm<T = unknown>(
  action: (prev: ActionState<T>, formData: FormData) => ActionState<T> | Promise<ActionState<T>>,
  options: UseActionFormOptions<T> = {},
): UseActionForm<T> {
  const [state, formAction, pending] = useActionState<ActionState<T>, FormData>(action, null);
  const summaryId = useId();
  const onSuccess = useRef(options.onSuccess);
  useEffect(() => {
    onSuccess.current = options.onSuccess;
  });

  useEffect(() => {
    if (!state) return;
    if (state.ok) onSuccess.current?.(state.data);
    // The summary is found by id rather than by ref, so the hook's return value holds no refs.
    else document.getElementById(summaryId)?.focus();
  }, [state, summaryId]);

  const failure = state && !state.ok ? state.error : undefined;
  return {
    formAction,
    pending,
    state,
    error: failure?.message,
    fieldErrors: failure?.fieldErrors,
    fieldError: (name) => firstError(failure?.fieldErrors?.[name]),
    summaryProps: { id: summaryId, message: failure?.message, fieldErrors: failure?.fieldErrors },
    data: state?.ok ? state.data : undefined,
    succeeded: state?.ok === true,
  };
}
