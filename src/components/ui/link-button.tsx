import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { buttonStyles, type ButtonSize, type ButtonVariant } from "./button-styles";

export type LinkButtonProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  className?: string;
};

/**
 * A link that looks like a button, for navigation within the platform.
 * Links to external tools must use ExternalToolLink instead.
 */
export function LinkButton({
  variant,
  size,
  fullWidth,
  iconStart,
  iconEnd,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link data-button="" className={buttonStyles({ variant, size, fullWidth, className })} {...props}>
      {iconStart}
      {children}
      {iconEnd}
    </Link>
  );
}
