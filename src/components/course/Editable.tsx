"use client";
// CONTRACT — owner: Studio content slice. Exported names and props are fixed (see src/server/services/_contract.ts).
import { createContext, use, type ElementType, type ReactNode } from "react";

/**
 * Inline editing in the real learner view (spec 6.3).
 *
 * Every piece of course text the learner page and player render goes through <EditableText>
 * (or <EditableBlock> for richer areas). With no provider — every learner, always — it renders
 * the content and nothing else. Inside a staff preview with editing on, the provider turns each
 * one into an inline editor that saves a new draft revision through the same validators.
 *
 * `path` addresses the value inside the Course JSON, e.g. "title",
 * "modules[m2].lessons[m2l1].steps[s3].title", "quizzes[q-snaplab-1].questions[q1].prompt",
 * "setupGuides[guide-replit].steps[g1].body". Ids, not array indexes.
 */
export type PreviewEditApi = {
  editing: boolean;
  /** Renders the inline editor for one text value. */
  renderText: (props: EditableTextProps) => ReactNode;
  /** Wraps a larger editable region (a step, a quiz question, a guide step, media) with edit controls. */
  renderBlock: (props: EditableBlockProps) => ReactNode;
};

export const PreviewEditContext = createContext<PreviewEditApi | null>(null);

export type EditableTextProps = {
  path: string;
  value: string;
  /** Element to render in read mode. Default: span. */
  as?: ElementType;
  className?: string;
  multiline?: boolean;
  /** The value is Markdown; `children` is the already-rendered Markdown for read mode. */
  markdown?: boolean;
  children?: ReactNode;
  label?: string;
};

export function EditableText(props: EditableTextProps) {
  const api = use(PreviewEditContext);
  if (api?.editing) return <>{api.renderText(props)}</>;
  const Tag: ElementType = props.as ?? "span";
  return <Tag className={props.className}>{props.children ?? props.value}</Tag>;
}

export type EditableBlockProps = {
  path: string;
  kind: "step" | "quiz_question" | "guide_step" | "media" | "module" | "lesson" | "rubric_criterion";
  label: string;
  children: ReactNode;
};

export function EditableBlock(props: EditableBlockProps) {
  const api = use(PreviewEditContext);
  if (api?.editing) return <>{api.renderBlock(props)}</>;
  return <>{props.children}</>;
}
