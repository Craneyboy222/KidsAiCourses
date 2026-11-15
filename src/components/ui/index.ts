/**
 * The UI kit. Import from "@/components/ui".
 *
 * Components without "use client" are safe in Server Components. The ones that
 * need the browser (overlays, toasts, password toggle, reorder list, preferences)
 * declare it themselves, so this barrel can be imported from either side.
 */

// Helpers
export { cx } from "./cn";
export {
  A11Y_COOKIE,
  DEFAULT_A11Y_PREFS,
  MOTION_MODES,
  READING_MODES,
  TEXT_SIZES,
  THEMES,
  a11yHtmlAttributes,
  parseA11yPrefs,
  serialiseA11yPrefs,
  type A11yPrefs,
  type MotionMode,
  type ReadingMode,
  type TextSize,
  type Theme,
} from "./a11y-prefs";

// Actions
export { Button, IconButton, type ButtonProps, type IconButtonProps } from "./button";
export { LinkButton, type LinkButtonProps } from "./link-button";
export { buttonStyles, type ButtonSize, type ButtonVariant } from "./button-styles";

// Forms
export { Field, FieldError, controlStyles, firstError, type FieldErrorValue, type FieldProps } from "./field";
export { Input, type InputProps } from "./input";
export { PasswordInput, type PasswordInputProps } from "./password-input";
export { Textarea, type TextareaProps } from "./textarea";
export { Select, type SelectOption, type SelectProps } from "./select";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { RadioGroup, type RadioGroupProps, type RadioOption } from "./radio-group";
export { Switch, type SwitchProps } from "./switch";
export { MonthYearPicker, type MonthYearPickerProps } from "./month-year-picker";
export { FormError, type FormErrorProps } from "./form-error";
export { SubmitButton, type SubmitButtonProps } from "./submit-button";
export {
  useActionForm,
  type ActionError,
  type ActionState,
  type UseActionForm,
  type UseActionFormOptions,
} from "./use-action-form";

// Surfaces
export { Card, CardTitle, type CardProps } from "./card";
export { Badge, type BadgeProps, type BadgeTone } from "./badge";
export { Sticker, type StickerProps } from "./sticker";
export { Callout, type CalloutProps, type CalloutTone } from "./callout";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Stat, StatGroup, type StatProps } from "./stat";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { Divider, type DividerProps } from "./divider";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { Breadcrumbs, type BreadcrumbsProps, type Crumb } from "./breadcrumbs";

// Overlays
export { Dialog, DialogClose, type DialogProps } from "./dialog";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { Sheet, type SheetProps } from "./sheet";
export {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  type DropdownMenuItemProps,
  type DropdownMenuProps,
} from "./dropdown-menu";
export { Tooltip, type TooltipProps } from "./tooltip";
export { Popover, type PopoverProps } from "./popover";

// Navigation and structure
export { Tabs, type TabItem, type TabsProps } from "./tabs";
export { Accordion, type AccordionItem, type AccordionProps } from "./accordion";
export { Pagination, pageWindow, type PaginationProps } from "./pagination";
export {
  ProgressBar,
  Stepper,
  type ProgressBarProps,
  type StepStatus,
  type StepperProps,
  type StepperStep,
} from "./progress";
export { Table, type SortDirection, type TableColumn, type TableProps, type TableSort } from "./table";
export { ReorderList, type ReorderItem, type ReorderListProps } from "./reorder-list";

// Feedback
export { Toaster, dismissToast, toast, useToast, type ToastOptions, type ToastTone } from "./toast";
export { LiveRegion } from "./live-region";
export { Spinner } from "./spinner";

// Content
export { Markdown, type MarkdownProps } from "./markdown";
export { VisuallyHidden } from "./visually-hidden";
export { SkipLink } from "./skip-link";
export { Icon, type IconProps } from "./icon";

// Platform patterns
export { GeneratedAvatar, type GeneratedAvatarProps } from "./generated-avatar";
export { AskParentToUnlock, type AskParentToUnlockProps } from "./ask-parent-to-unlock";
export { ExternalToolLink, type ExternalToolLinkProps } from "./external-tool-link";
export { AiLabel, type AiLabelProps } from "./ai-label";
export { LastVerified, type LastVerifiedProps } from "./last-verified";
export {
  CATEGORY_STYLES,
  CategoryBlock,
  categoryStyle,
  type CategoryBlockProps,
  type CategoryHue,
} from "./category-block";
export { DifficultyBadge, type Difficulty, type DifficultyBadgeProps } from "./difficulty-badge";
export {
  ReportButton,
  type ReportButtonProps,
  type ReportReason,
  type ReportSubmission,
} from "./report-button";
export { A11yPreferences, type A11yPreferencesProps } from "./a11y-preferences";
