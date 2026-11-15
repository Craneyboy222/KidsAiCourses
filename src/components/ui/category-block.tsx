import {
  Accessibility,
  AppWindow,
  BookOpenText,
  Bot,
  Box,
  Briefcase,
  ChartColumn,
  Clapperboard,
  Code,
  Cpu,
  FlaskConical,
  Gamepad2,
  Leaf,
  ListChecks,
  Megaphone,
  MessageSquareText,
  Music,
  Palette,
  PartyPopper,
  PenLine,
  Rocket,
  Scale,
  Shapes,
  ShieldHalf,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ElementType } from "react";
import { cx } from "./cn";

export type CategoryHue = 1 | 2 | 3 | 4 | 5 | 6;

const HUES: Record<CategoryHue, string> = {
  1: "bg-cat-1",
  2: "bg-cat-2",
  3: "bg-cat-3",
  4: "bg-cat-4",
  5: "bg-cat-5",
  6: "bg-cat-6",
};

/** The 24 launch categories (spec Section 15), each with a fixed hue and icon so a category always looks the same. */
export const CATEGORY_STYLES: Record<string, { hue: CategoryHue; icon: LucideIcon }> = {
  "apps-websites": { hue: 1, icon: AppWindow },
  games: { hue: 5, icon: Gamepad2 },
  "chatbots-agents": { hue: 2, icon: Bot },
  automations: { hue: 3, icon: Workflow },
  "data-analysis": { hue: 4, icon: ChartColumn },
  "prompt-engineering": { hue: 6, icon: MessageSquareText },
  "image-design": { hue: 6, icon: Palette },
  "video-film": { hue: 5, icon: Clapperboard },
  "music-audio": { hue: 1, icon: Music },
  "writing-storytelling": { hue: 4, icon: PenLine },
  "marketing-social": { hue: 5, icon: Megaphone },
  entrepreneurship: { hue: 3, icon: Rocket },
  "research-study": { hue: 2, icon: BookOpenText },
  "maths-science": { hue: 3, icon: FlaskConical },
  "coding-ml": { hue: 1, icon: Code },
  "robotics-iot": { hue: 2, icon: Cpu },
  "ar-vr-3d": { hue: 6, icon: Box },
  cybersecurity: { hue: 4, icon: ShieldHalf },
  "ethics-safety": { hue: 2, icon: Scale },
  careers: { hue: 4, icon: Briefcase },
  productivity: { hue: 3, icon: ListChecks },
  accessibility: { hue: 1, icon: Accessibility },
  environment: { hue: 3, icon: Leaf },
  "fun-hobbies": { hue: 5, icon: PartyPopper },
};

/** Hue and icon for a category slug. Unknown slugs (categories added later in Studio) get a stable hue and a neutral icon. */
export function categoryStyle(slug: string): { hue: CategoryHue; icon: LucideIcon } {
  const known = CATEGORY_STYLES[slug];
  if (known) return known;
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum = (sum + slug.charCodeAt(i)) % 6;
  return { hue: (sum + 1) as CategoryHue, icon: Shapes };
}

const SIZES = {
  sm: { box: "gap-1.5 rounded-full px-2.5 py-0.5 text-sm", icon: "size-4" },
  md: { box: "gap-2 rounded-control px-3 py-2 text-base", icon: "size-5" },
  lg: { box: "flex-col items-start gap-3 rounded-card p-4 text-lg", icon: "size-8" },
} as const;

export type CategoryBlockProps = {
  /** Category slug, for example "video-film". Picks the hue and icon. */
  slug: string;
  /** The category's display name. Always shown: the colour is never the only cue. */
  name: string;
  size?: keyof typeof SIZES;
  /** Override the hue or icon for a category created in Studio. */
  hue?: CategoryHue;
  icon?: LucideIcon;
  as?: ElementType;
  className?: string;
};

/** A category colour block: fixed hue, ink text, the category's icon and its name. Wrap it in a link to make it a filter. */
export function CategoryBlock({
  slug,
  name,
  size = "md",
  hue,
  icon,
  as: Tag = "span",
  className,
}: CategoryBlockProps) {
  const style = categoryStyle(slug);
  const Glyph = icon ?? style.icon;
  const s = SIZES[size];
  return (
    <Tag
      className={cx(
        "border-ink text-on-cat inline-flex items-center border-2 font-bold",
        HUES[hue ?? style.hue],
        s.box,
        className,
      )}
    >
      <Glyph aria-hidden="true" focusable="false" className={cx(s.icon, "shrink-0")} strokeWidth={2.25} />
      {name}
    </Tag>
  );
}
