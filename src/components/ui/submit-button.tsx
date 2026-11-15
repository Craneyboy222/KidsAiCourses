"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export type SubmitButtonProps = Omit<ButtonProps, "type" | "loadingText"> & {
  /** Shown and announced while the form's action is running, for example "Saving…". */
  pendingText?: string;
};

/** The submit button for a `<form action={...}>`. It shows the loading state by itself, using `useFormStatus`. */
export function SubmitButton({
  pendingText = "Working on it…",
  loading,
  children,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" loading={pending || loading} loadingText={pendingText}>
      {children}
    </Button>
  );
}
