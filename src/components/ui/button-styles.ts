import { cx } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex max-w-full items-center justify-center gap-2 rounded-control border-2 text-center font-bold no-underline select-none " +
  "transition-[translate,box-shadow,background-color] duration-150 " +
  "disabled:opacity-60 aria-disabled:opacity-60";

const RAISED =
  "shadow-raised active:translate-y-(--press) active:shadow-none disabled:translate-y-0 aria-disabled:translate-y-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `border-ink bg-primary text-on-primary hover:bg-primary-hover ${RAISED}`,
  secondary: `border-ink bg-surface text-ink hover:bg-tint ${RAISED}`,
  ghost: "border-transparent bg-transparent text-ink hover:bg-tint hover:underline hover:underline-offset-4",
  danger: `border-ink bg-danger text-on-danger hover:bg-danger-hover ${RAISED}`,
};

/** Heights are 38, 47 and 55 px at the default text size: all above the 24 px minimum, `md` and `lg` above 44 px for touch. */
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1 text-sm",
  md: "min-h-11 px-4 py-2 text-base",
  lg: "min-h-13 px-6 py-3 text-lg",
};

const ICON_ONLY: Record<ButtonSize, string> = {
  sm: "size-9 shrink-0 p-0",
  md: "size-11 shrink-0 p-0",
  lg: "size-13 shrink-0 p-0",
};

export type ButtonStyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconOnly?: boolean;
  className?: string;
};

/** The one source of button looks, shared by Button, LinkButton, IconButton and SubmitButton. */
export function buttonStyles({
  variant = "primary",
  size = "md",
  fullWidth = false,
  iconOnly = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cx(
    BASE,
    VARIANTS[variant],
    iconOnly ? ICON_ONLY[size] : SIZES[size],
    fullWidth && "w-full",
    className,
  );
}
