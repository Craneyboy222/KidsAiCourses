"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { buttonStyles, type ButtonSize, type ButtonVariant } from "./button-styles";
import { Spinner } from "./spinner";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /**
   * Shows a spinner, ignores clicks and tells screen readers what is happening.
   * The button stays focusable, so keyboard users do not lose their place.
   */
  loading?: boolean;
  /** Shown and announced while loading, for example "Saving…". */
  loadingText?: string;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
};

/**
 * `type` defaults to "button" so a stray Button never submits a form. Use
 * SubmitButton inside a `<form action>`.
 */
export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  iconStart,
  iconEnd,
  className,
  children,
  onClick,
  type = "button",
  ...props
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <>
      <button
        data-button=""
        {...props}
        type={type}
        aria-disabled={loading || props["aria-disabled"] || undefined}
        aria-busy={loading || undefined}
        className={buttonStyles({ variant, size, fullWidth, className })}
        onClick={handleClick}
      >
        {loading ? <Spinner decorative size="sm" /> : iconStart}
        {loading && loadingText ? loadingText : children}
        {!loading && iconEnd}
      </button>
      {/* Outside the button on purpose: content inside a button is not announced as a live region. */}
      <span role="status" className="sr-only">
        {loading ? (loadingText ?? "Loading") : ""}
      </span>
    </>
  );
}

export type IconButtonProps = Omit<
  ButtonProps,
  "children" | "iconStart" | "iconEnd" | "fullWidth" | "aria-label"
> & {
  /** Required: the accessible name, for example "Close". An icon is never the only label. */
  label: string;
  /** Usually `<Icon icon={X} />`. */
  icon: ReactNode;
};

/** A square, icon-only button. `label` is required and becomes the accessible name. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size,
  className,
  loading = false,
  loadingText,
  onClick,
  type = "button",
  ...props
}: IconButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <>
      <button
        data-button=""
        {...props}
        type={type}
        aria-label={label}
        aria-disabled={loading || props["aria-disabled"] || undefined}
        aria-busy={loading || undefined}
        className={buttonStyles({ variant, size, iconOnly: true, className })}
        onClick={handleClick}
      >
        {loading ? <Spinner decorative size="sm" /> : icon}
      </button>
      <span role="status" className="sr-only">
        {loading ? (loadingText ?? "Loading") : ""}
      </span>
    </>
  );
}
