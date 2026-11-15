import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/link-button";
import { ProgressBar, Stepper, type StepperStep } from "@/components/ui/progress";

export type PlayerShellProps = {
  /** The step content. Rendered inside `<main>` in one focused column (72ch, or 60ch in dyslexia-friendly mode). */
  children: ReactNode;
  courseTitle: string;
  lessonTitle: string;
  /** Where "Back to course" goes: the course page. */
  exitHref: string;
  /** The steps of this lesson, in order, with their status. Exactly one should be `current`. */
  steps: StepperStep[];
  /**
   * The Coach control: usually `<Sheet modal={false} trigger={<Button>Ask Coach</Button>} …>`.
   * The Sheet is a side panel on wide screens and a bottom sheet on phones.
   */
  coach?: ReactNode;
  /** Other header controls, for example `<ReportButton />`. */
  headerActions?: ReactNode;
  /** The Previous control: `<PlayerPrevious href="…" />`, or leave out on the first step. */
  previous?: ReactNode;
  /** The Next control: `<PlayerNext href="…" />`, or a SubmitButton when moving on completes the step. */
  next?: ReactNode;
  /** Notices above the step, for example "Preview mode: nothing you do here is saved." */
  notices?: ReactNode;
};

export function PlayerPrevious({ href, children = "Previous" }: { href: string; children?: ReactNode }) {
  return (
    <LinkButton
      href={href}
      variant="secondary"
      iconStart={<ArrowLeft aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />}
    >
      {children}
    </LinkButton>
  );
}

export function PlayerNext({ href, children = "Next" }: { href: string; children?: ReactNode }) {
  return (
    <LinkButton
      href={href}
      iconEnd={<ArrowRight aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />}
    >
      {children}
    </LinkButton>
  );
}

/**
 * The course player frame. One focused reading column; the step list sits to
 * the left from 900 px and collapses to a progress bar (with the full list one
 * tap away) on phones; Coach has its own slot; Previous and Next stay pinned to
 * the bottom. The top bar is pinned only from 900 px, so on a phone at 150% text
 * the step itself keeps most of the screen. Nothing here depends on the external tool, so the player stays
 * usable while the tool is open in another tab.
 */
export function PlayerShell({
  children,
  courseTitle,
  lessonTitle,
  exitHref,
  steps,
  coach,
  headerActions,
  previous,
  next,
  notices,
}: PlayerShellProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.status === "current"),
  );
  const done = steps.filter((step) => step.status === "done").length;
  const positionText = steps.length > 0 ? `Step ${currentIndex + 1} of ${steps.length}` : "No steps yet";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-ink bg-surface rail:sticky rail:top-0 z-30 border-b-2">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <Link
            href={exitHref}
            data-button=""
            className="rounded-control text-ink hover:bg-tint inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 font-bold no-underline hover:underline hover:underline-offset-4"
          >
            <ArrowLeft aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />
            Back to course
          </Link>
          <p className="text-ink-muted min-w-0 flex-1 truncate text-sm">
            <span className="sr-only">Course:</span> {courseTitle}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {headerActions}
            {coach}
          </div>
        </div>
      </header>

      <div className="rail:py-8 mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 py-4">
        <nav aria-label="Steps in this lesson" className="rail:block hidden w-64 shrink-0">
          <div className="sticky top-24 flex flex-col gap-3">
            <p className="text-ink font-bold">{lessonTitle}</p>
            <p className="text-ink-muted text-sm">
              {positionText}, {done} done
            </p>
            <Stepper steps={steps} />
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <nav aria-label="Lesson progress and steps" className="rail:hidden flex flex-col gap-2">
            <ProgressBar
              label={lessonTitle}
              value={done}
              max={Math.max(steps.length, 1)}
              valueText={positionText}
            />
            <details className="group rounded-control border-ink bg-surface border-2">
              <summary className="text-ink flex min-h-11 list-none items-center justify-between gap-2 px-3 font-bold -outline-offset-4 [&::-webkit-details-marker]:hidden">
                Show all steps
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 transition-transform duration-150 group-open:rotate-180"
                  strokeWidth={2.5}
                />
              </summary>
              <div className="border-line border-t-2 p-2">
                <Stepper steps={steps} />
              </div>
            </details>
          </nav>

          {notices && (
            <section aria-label="Notices" className="max-w-measure mx-auto flex w-full flex-col gap-3">
              {notices}
            </section>
          )}

          <main id="main" tabIndex={-1} className="max-w-measure mx-auto w-full flex-1 pb-6 outline-none">
            {children}
          </main>
        </div>
      </div>

      {(previous || next) && (
        <div className="border-ink bg-surface sticky bottom-0 z-30 border-t-2 pb-[env(safe-area-inset-bottom)]">
          <nav
            aria-label="Previous and next step"
            className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
          >
            <div className="min-w-0">{previous}</div>
            <div className="ml-auto min-w-0">{next}</div>
          </nav>
        </div>
      )}
    </div>
  );
}
