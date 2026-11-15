"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cx } from "./cn";
import { controlStyles } from "./field";

export type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  /** `current-password` for sign-in, `new-password` when choosing one. Password managers rely on this. */
  autoComplete?: "current-password" | "new-password";
};

/**
 * Password box with a show/hide toggle. Paste, autofill and password managers
 * are never blocked: there is no `onPaste` handler and `autoComplete` is always set.
 */
export function PasswordInput({
  className,
  autoComplete = "current-password",
  disabled,
  ...props
}: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block w-full">
      <input
        {...props}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        className={cx(controlStyles, "pr-24", className)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setShown((s) => !s)}
        className="text-ink hover:bg-tint absolute top-1/2 right-1.5 inline-flex min-h-8 -translate-y-1/2 items-center gap-1.5 rounded-md px-2 text-sm font-bold disabled:opacity-60"
      >
        {shown ? (
          <EyeOff aria-hidden="true" className="size-4" strokeWidth={2.5} />
        ) : (
          <Eye aria-hidden="true" className="size-4" strokeWidth={2.5} />
        )}
        {/* The visible word is part of the accessible name, so voice control ("click Show") works. */}
        <span>
          {shown ? "Hide" : "Show"} <span className="sr-only">password</span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {shown ? "Your password is showing." : ""}
      </span>
    </span>
  );
}
