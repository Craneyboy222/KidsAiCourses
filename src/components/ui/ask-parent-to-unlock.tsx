import { CircleCheck, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "./card";
import { cx } from "./cn";
import { SubmitButton } from "./submit-button";

/** Anything that looks like money. Copy containing it is replaced by the default wording. */
const PRICE_PATTERN =
  /[£$€]|\bGBP\b|\bpence\b|\b\d+(\.\d{2})?\s?p\b|\bper (week|month|year)\b|\ba (week|month|year)\b|\/\s?(mo|month|yr|year)\b/i;

function priceFree(text: string | undefined, fallback: string): string {
  return text && !PRICE_PATTERN.test(text) ? text : fallback;
}

export type AskParentToUnlockProps = {
  /**
   * Sends the unlock request. Pass a Server Action (or any function): it is used
   * as the form action, so it works without JavaScript and shows progress by itself.
   */
  onAsk: (formData: FormData) => void | Promise<void>;
  /** True once a request has been sent and is waiting for the parent. */
  asked: boolean;
  /** What is locked, for example the course title. */
  itemName?: string;
  title?: string;
  description?: string;
  /** Extra hidden form fields, for example `<input type="hidden" name="courseId" value="…" />`. */
  children?: ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
};

/**
 * Shown wherever a learner under 18 would otherwise meet a price, a checkout or
 * locked paid content. It never shows a price: there is no price prop, and any
 * `title` or `description` that mentions money is swapped for the default copy.
 */
export function AskParentToUnlock({
  onAsk,
  asked,
  itemName,
  title,
  description,
  children,
  headingLevel: Heading = "h2",
  className,
}: AskParentToUnlockProps) {
  const defaultTitle = itemName
    ? `${itemName} needs a parent to unlock it`
    : "This one needs a parent to unlock it";
  const defaultDescription =
    "Send them a request and we'll let them know. You'll see it open up here as soon as they say yes.";

  return (
    <Card as="section" variant="raised" className={cx("flex flex-col gap-3", className)}>
      <div className="flex items-start gap-3">
        <span className="border-ink bg-accent text-on-accent flex size-10 shrink-0 items-center justify-center rounded-full border-2">
          <Lock aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <Heading className="text-xl font-bold">{priceFree(title, defaultTitle)}</Heading>
          <p className="text-ink-muted">{priceFree(description, defaultDescription)}</p>
        </div>
      </div>
      {asked ? (
        <p
          role="status"
          className="rounded-control border-success bg-success-soft text-ink flex items-start gap-2 border-2 p-3 font-bold"
        >
          <CircleCheck aria-hidden="true" className="text-success mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
          <span>Request sent. We&apos;ve asked your parent, so there&apos;s nothing more to do for now.</span>
        </p>
      ) : (
        <form action={onAsk} className="flex flex-wrap items-center gap-3">
          {children}
          <SubmitButton pendingText="Sending your request…">Ask a parent to unlock</SubmitButton>
        </form>
      )}
    </Card>
  );
}
