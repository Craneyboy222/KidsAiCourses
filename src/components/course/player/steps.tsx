import { Download, Headphones, type LucideIcon, BookOpenText, CircleCheckBig, Clapperboard, ClipboardCheck, Flag, Hammer, MessageSquareHeart, Scale, Send, Upload, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { EditableBlock, EditableText } from "@/components/course/Editable";
import type { PlayerMode } from "@/components/course/types";
import { ReportControl } from "@/components/safety/ReportControl";
import { SubmitStep, UploadStep } from "@/components/submissions/EvidenceSteps";
import { Badge, Callout, ExternalToolLink, LastVerified, Markdown, Sticker } from "@/components/ui";
import { safeParseStepConfig, type LearnerQuiz, type LearnerStep, type ProjectBrief, type Rubric, type SetupGuide, type StepType } from "@/content/schema";
import { formatMinutes } from "@/lib/dates";
import { coursePaths } from "@/lib/learning/paths";
import { CheckpointProgress, DoneBadge, GuideTick, HintLadder, NotesBox, QuizForm, ResponseBox, StepVideo, TickBox } from "./islands";

/** The media and tool facts a step needs, resolved on the server at request time. Structural, so tests can build it by hand. */
export type StepMedia = Record<string, { id: string; kind: string; url: string | null; altText: string | null; durationSec: number | null; attribution: string | null; text: string | null }>;
export type StepToolFacts = { slug: string; name: string; officialUrl: string | null; linkAllowed: boolean; parentMustSetUp: boolean };

export type StepBodyProps = {
  mode: PlayerMode;
  courseId: string;
  courseSlug: string;
  moduleId: string;
  lessonId: string;
  step: LearnerStep;
  /** The materialised `step.id`; null in a staff preview of a draft. */
  stepId: string | null;
  /** Switched off by staff (`step.disabled`): a short notice, and it can be passed. */
  disabled: boolean;
  /** The quiz for a `quiz` step, already without answers or feedback. */
  quiz: LearnerQuiz | null;
  /** The setup guide for a `setup_guide` step. */
  guide: SetupGuide | null;
  media: StepMedia;
  tools: Record<string, StepToolFacts>;
  brief: ProjectBrief;
  rubric: Rubric;
  /** Every step key in course order, for the checkpoint's count. */
  order: { key: string; disabled: boolean }[];
};

const TYPE_LABELS: Record<StepType, { label: string; icon: LucideIcon }> = {
  video: { label: "Watch", icon: Clapperboard },
  read: { label: "Read", icon: BookOpenText },
  setup_guide: { label: "Set up", icon: Wrench },
  external_task: { label: "Make", icon: Hammer },
  upload: { label: "Upload", icon: Upload },
  quiz: { label: "Quiz", icon: ClipboardCheck },
  ethics_checkpoint: { label: "Think it through", icon: Scale },
  reflection: { label: "Reflect", icon: MessageSquareHeart },
  checkpoint: { label: "Checkpoint", icon: Flag },
  submit: { label: "Hand in", icon: Send },
};

export const stepTypeLabel = (type: StepType): string => TYPE_LABELS[type].label;

const GUIDE_KIND_LABELS: Record<SetupGuide["steps"][number]["kind"], string> = {
  create_account: "Create the account",
  verify_email: "Verify the email",
  choose_free_plan: "Stay on the free plan",
  privacy_settings: "Privacy settings",
  do_in_tool: "In the tool",
  export: "Export",
  other: "Step",
};

function StepMarkdown({ path, value, label }: { path: string; value: string; label: string }) {
  return (
    <EditableText path={path} value={value} as="div" markdown multiline label={label}>
      <Markdown topHeadingLevel={2}>{value}</Markdown>
    </EditableText>
  );
}

/** Pictures, sound and downloads attached to a step. Captions and transcripts belong to the video and are not listed. */
function StepAssets({ assetIds, media, stepPath }: { assetIds: readonly string[]; media: StepMedia; stepPath: string }) {
  const items = assetIds.map((id) => media[id]).filter((asset): asset is StepMedia[string] => asset !== undefined && asset.kind !== "captions_vtt" && asset.kind !== "transcript_md" && asset.kind !== "video");
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((asset) => {
        const name = asset.altText ?? asset.id;
        let content: ReactNode;
        if (asset.kind === "image" || asset.kind === "guide_screenshot") {
          content = asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link cannot go through the image optimiser
            <img src={asset.url} alt={asset.altText ?? ""} loading="lazy" decoding="async" className="rounded-card border-ink bg-tint aspect-video w-full border-2 object-contain" />
          ) : (
            <p className="rounded-card border-ink bg-tint border-2 border-dashed p-4">
              <span className="font-bold">Picture: </span>
              {name}
            </p>
          );
        } else {
          const Glyph = asset.kind === "audio" ? Headphones : Download;
          const what = asset.kind === "audio" ? "Listen or download" : "Download";
          content = asset.url ? (
            <a href={asset.url} className="link inline-flex min-h-11 items-center gap-2 font-bold" target={asset.kind === "audio" ? "_blank" : undefined} rel={asset.kind === "audio" ? "noopener" : undefined}>
              <Glyph aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
              {what}: {name}
              {asset.durationSec ? ` (${Math.round(asset.durationSec)} seconds)` : ""}
              {asset.kind === "audio" && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          ) : (
            <p className="text-ink-muted flex items-center gap-2">
              <Glyph aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
              {name} isn&apos;t ready to download yet.
            </p>
          );
        }
        return (
          <li key={asset.id}>
            <EditableBlock path={`${stepPath}.assetIds[${asset.id}]`} kind="media" label={name}>
              {content}
              {asset.attribution && <p className="text-ink-muted text-sm">{asset.attribution}</p>}
            </EditableBlock>
          </li>
        );
      })}
    </ul>
  );
}

function VideoStepBody({ step, media, stepPath }: { step: LearnerStep; media: StepMedia; stepPath: string }) {
  const assets = (step.assetIds ?? []).map((id) => media[id]).filter((asset): asset is StepMedia[string] => asset !== undefined);
  const video = assets.find((asset) => asset.kind === "video");
  const captions = assets.find((asset) => asset.kind === "captions_vtt");
  const transcript = assets.find((asset) => asset.kind === "transcript_md");
  return (
    <EditableBlock path={`${stepPath}.assetIds`} kind="media" label="Video, captions and transcript">
      <StepVideo
        title={step.title}
        src={video?.url ?? null}
        captionsSrc={captions?.url ?? null}
        posterSrc={null}
        transcript={transcript?.text ? <Markdown topHeadingLevel={3}>{transcript.text}</Markdown> : null}
      />
    </EditableBlock>
  );
}

function ToolLine({ tool }: { tool: StepToolFacts | undefined }) {
  if (!tool) return null;
  if (tool.parentMustSetUp) {
    return (
      <Callout tone="info" title={`A parent or carer runs ${tool.name} for you`}>
        <p>Ask them to open it on their account. You direct, they click.</p>
      </Callout>
    );
  }
  if (!tool.linkAllowed || !tool.officialUrl) {
    return <p className="text-ink-muted">{tool.name} can&apos;t be opened from here at the moment. If that seems wrong, use Report to tell us.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ExternalToolLink href={tool.officialUrl} toolName={tool.name} allowed appearance="button" />
      <p className="text-ink-muted text-sm">It opens in a new tab. This page stays here, so you can come back to read the next bit, tick it off or ask Coach.</p>
    </div>
  );
}

function SetupGuideBody(props: StepBodyProps & { stepPath: string }) {
  const { step, guide, media, tools, courseId, stepPath } = props;
  const parsed = safeParseStepConfig(step);
  if (!parsed.success || parsed.data.type !== "setup_guide" || !guide) {
    return <Callout tone="warning" title="This setup guide isn't available right now">You can carry on to the next step, and use Report to tell us.</Callout>;
  }
  const config = parsed.data.config;
  const wanted = new Set(config.throughStepIds);
  const guideSteps = guide.steps.filter((entry) => wanted.has(entry.id));
  const tool = tools[config.toolSlug];
  const toolName = tool?.name ?? "the tool";
  const parentRuns = tool?.parentMustSetUp === true;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="font-bold">
          <EditableText path={`${coursePaths.guide(guide.id)}.title`} value={guide.title} />
        </p>
        <LastVerified date={guide.lastVerifiedAt} prefix="Guide last checked" />
      </div>
      {parentRuns ? (
        <Callout tone="info" title="Ask a parent to set this up">
          <p>{toolName} is for adults to run. Ask a parent or carer to follow these steps on their own account, with you alongside.</p>
        </Callout>
      ) : (
        <Callout tone="info" title="Keep your sign-in details to yourself">
          <p>Never type a password, a code from an email or text, or card details anywhere on this site. We will never ask for them, and neither will Coach.</p>
        </Callout>
      )}
      {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step introduction" />}
      <ToolLine tool={tool} />
      <ol className="flex flex-col gap-4">
        {guideSteps.map((entry, index) => {
          const path = coursePaths.guideStep(guide.id, entry.id);
          return (
            <li key={entry.id}>
              <EditableBlock path={path} kind="guide_step" label={entry.title}>
                <section className="rounded-card border-ink bg-surface flex flex-col gap-3 border-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{`${index + 1} of ${guideSteps.length}`}</Badge>
                    <Badge tone="info">{GUIDE_KIND_LABELS[entry.kind]}</Badge>
                  </div>
                  <EditableText path={`${path}.title`} value={entry.title} as="h2" className="text-xl font-bold" />
                  <StepMarkdown path={`${path}.body`} value={entry.body} label={entry.title} />
                  <StepAssets assetIds={entry.screenshotAssetIds ?? []} media={media} stepPath={path} />
                  <GuideTick guideStepId={entry.id} label={parentRuns ? "We've done this together" : "I've done this"} />
                </section>
              </EditableBlock>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2">
        <TickBox label={parentRuns ? `${toolName} is set up` : `My ${toolName} account is set up`} description="Tick this once every step above is done." />
        <ReportControl target={{ type: "guide", id: guide.id, courseId, stepKey: step.id, toolSlug: config.toolSlug }} label="This doesn't match what I see" />
      </div>
    </div>
  );
}

function ExternalTaskBody({ step, media, tools, stepPath }: StepBodyProps & { stepPath: string }) {
  const parsed = safeParseStepConfig(step);
  if (!parsed.success || parsed.data.type !== "external_task") {
    return <Callout tone="warning" title="This task isn't available right now">You can carry on to the next step, and use Report to tell us.</Callout>;
  }
  const config = parsed.data.config;
  const tool = tools[config.toolSlug];
  return (
    <div className="flex flex-col gap-5">
      {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step introduction" />}
      <section aria-labelledby={`${step.id}-task`} className="flex flex-col gap-3">
        <h2 id={`${step.id}-task`} className="text-xl font-bold">
          What to do in {tool?.name ?? "the tool"}
        </h2>
        <StepMarkdown path={`${stepPath}.config.task`} value={config.task} label="Task" />
        {config.clicks && config.clicks.length > 0 && (
          <ol className="flex list-decimal flex-col gap-1 pl-6">
            {config.clicks.map((click, index) => (
              <li key={index}>
                <EditableText path={`${stepPath}.config.clicks[${index}]`} value={click} />
              </li>
            ))}
          </ol>
        )}
      </section>
      <StepAssets assetIds={step.assetIds ?? []} media={media} stepPath={stepPath} />
      <ToolLine tool={tool} />
      <TickBox label="I've done this" description="Tick it when you've finished in the tool. Nobody checks up on you: it's your project." />
    </div>
  );
}

function WrittenBody({ step, stepPath }: { step: LearnerStep; stepPath: string }) {
  const parsed = safeParseStepConfig(step);
  const prompt = parsed.success && (parsed.data.type === "reflection" || parsed.data.type === "ethics_checkpoint") ? parsed.data.config.prompt : "";
  const ethics = step.type === "ethics_checkpoint";
  return (
    <div className="flex flex-col gap-5">
      {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step introduction" />}
      <ResponseBox label={<EditableText path={`${stepPath}.config.prompt`} value={prompt} />} />
      <TickBox label={ethics ? "I've thought this through" : "I'm happy with my answer"} description="There's no right answer here, and nobody marks it." />
    </div>
  );
}

function QuizBody({ step, quiz, stepPath }: { step: LearnerStep; quiz: LearnerQuiz | null; stepPath: string }) {
  if (!quiz) return <Callout tone="warning" title="This quiz isn't available right now">You can carry on to the next step, and use Report to tell us.</Callout>;
  return (
    <div className="flex flex-col gap-5">
      {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step introduction" />}
      <QuizForm quiz={quiz} passMark={step.completion.threshold ?? quiz.passMark} />
    </div>
  );
}

/**
 * One step of a course, for any of the ten launch step types (spec 3.2). The same component
 * renders for a learner and for a staff preview; every piece of course text goes through
 * `EditableText` / `EditableBlock` with an id-based path, so Studio can edit in place.
 *
 * It must be rendered inside `<PlayerProvider>`: the interactive parts read and write progress
 * through the player store.
 */
export function StepBody(props: StepBodyProps) {
  const { step, disabled, moduleId, lessonId, mode, courseId, courseSlug, stepId, brief, rubric, media, order } = props;
  const stepPath = coursePaths.step(moduleId, lessonId, step.id);
  const { label, icon: Glyph } = TYPE_LABELS[step.type];
  const selfTick = step.completion.rule === "self_tick";
  const evidenceProps = { mode, courseId, courseSlug, stepKey: step.id, stepId, title: step.title, config: step.config ?? {}, brief, rubric };

  let body: ReactNode;
  if (disabled) {
    body = (
      <Callout tone="info" title="This step is switched off for now">
        <p>We&apos;re fixing something in it. You don&apos;t need to do it: carry on with Next, and it won&apos;t count against finishing the course.</p>
      </Callout>
    );
  } else {
    switch (step.type) {
      case "video":
        body = (
          <div className="flex flex-col gap-5">
            <VideoStepBody step={step} media={media} stepPath={stepPath} />
            {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step text" />}
          </div>
        );
        break;
      case "read":
        body = (
          <div className="flex flex-col gap-5">
            {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step text" />}
            <StepAssets assetIds={step.assetIds ?? []} media={media} stepPath={stepPath} />
            {selfTick && <TickBox label="I've done this" />}
          </div>
        );
        break;
      case "checkpoint":
        body = (
          <div className="flex flex-col gap-4">
            <Sticker icon={<CircleCheckBig aria-hidden="true" className="size-4" strokeWidth={2.5} />} className="self-start">
              Saved so far
            </Sticker>
            <CheckpointProgress order={order} />
            {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step text" />}
            {selfTick && <TickBox label="I've done this" />}
          </div>
        );
        break;
      case "setup_guide":
        body = <SetupGuideBody {...props} stepPath={stepPath} />;
        break;
      case "external_task":
        body = <ExternalTaskBody {...props} stepPath={stepPath} />;
        break;
      case "quiz":
        body = <QuizBody step={step} quiz={props.quiz} stepPath={stepPath} />;
        break;
      case "ethics_checkpoint":
      case "reflection":
        body = <WrittenBody step={step} stepPath={stepPath} />;
        break;
      case "upload":
        body = (
          <div className="flex flex-col gap-5">
            {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step text" />}
            <UploadStep {...evidenceProps} />
          </div>
        );
        break;
      case "submit":
        body = (
          <div className="flex flex-col gap-5">
            {step.body && <StepMarkdown path={`${stepPath}.body`} value={step.body} label="Step text" />}
            <SubmitStep {...evidenceProps} />
          </div>
        );
        break;
    }
  }

  return (
    <EditableBlock path={stepPath} kind="step" label={step.title}>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="text-ink-muted flex flex-wrap items-center gap-2 text-sm font-bold">
            <Glyph aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
            <span>{label}</span>
            <span aria-hidden="true">·</span>
            <span>About {formatMinutes(step.estimatedMinutes)}</span>
            <DoneBadge />
          </div>
          <EditableText path={`${stepPath}.title`} value={step.title} as="h1" className="text-3xl font-bold" />
        </header>
        {body}
        {!disabled && (
          <>
            <HintLadder hints={step.hints.map((hint, index) => <EditableText key={index} path={`${stepPath}.hints[${index}]`} value={hint} />)} />
            <NotesBox />
          </>
        )}
      </article>
    </EditableBlock>
  );
}
