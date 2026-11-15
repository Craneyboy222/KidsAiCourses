import { cx } from "./cn";

const SIZES = { sm: "size-8", md: "size-10", lg: "size-14", xl: "size-20" } as const;

/** Fixed sticker colours (the six category hues plus accent). They do not change with the theme. */
const FILLS = ["#cfc6ff", "#a8dcff", "#a6efc9", "#ffd95a", "#ffb3a1", "#ffb8e0", "#c6f432"] as const;
const INK = "#14141f";

/** FNV-1a: small, fast and stable, so the same seed always gives the same avatar. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type GeneratedAvatarProps = {
  /** Any stable string: a user id or nickname. The same seed always draws the same avatar. */
  seed: string;
  size?: keyof typeof SIZES;
  /** Leave out when the nickname is written next to the avatar (the usual case): the avatar is then decorative. */
  label?: string;
  className?: string;
};

/**
 * A deterministic, abstract avatar: one background colour, one large shape and
 * one small accent shape. It is never a photo and never a face: there are no
 * paired dots or curves that could read as eyes or a mouth.
 */
export function GeneratedAvatar({ seed, size = "md", label, className }: GeneratedAvatarProps) {
  const h = hash(seed);
  const background = FILLS[h % FILLS.length];
  const foreground = FILLS[((h % FILLS.length) + 1 + ((h >>> 3) % (FILLS.length - 1))) % FILLS.length];
  const shape = (h >>> 6) % 5;
  const rotation = ((h >>> 9) % 8) * 45;
  const accentCorner = (h >>> 12) % 4;
  const accentShape = (h >>> 14) % 3;
  const [ax, ay] = [
    [12, 12],
    [36, 12],
    [36, 36],
    [12, 36],
  ][accentCorner] ?? [12, 12];

  return (
    <svg
      viewBox="0 0 48 48"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cx(SIZES[size], "border-ink shrink-0 rounded-full border-2", className)}
    >
      <rect width="48" height="48" fill={background} />
      <g
        transform={`rotate(${rotation} 24 24)`}
        fill={foreground}
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      >
        {shape === 0 && <rect x="10" y="20" width="44" height="44" rx="6" />}
        {shape === 1 && <circle cx="30" cy="34" r="18" />}
        {shape === 2 && <path d="M-4 52 L24 10 L52 52 Z" />}
        {shape === 3 && <path d="M-6 30 H54 V60 H-6 Z" />}
        {shape === 4 && <path d="M24 6 A18 18 0 0 1 24 42 Z" />}
      </g>
      <g fill={INK}>
        {accentShape === 0 && <circle cx={ax} cy={ay} r="4.5" />}
        {accentShape === 1 && <rect x={ax - 4} y={ay - 4} width="8" height="8" rx="1.5" />}
        {accentShape === 2 && <path d={`M${ax} ${ay - 5} L${ax + 5} ${ay + 4} L${ax - 5} ${ay + 4} Z`} />}
      </g>
    </svg>
  );
}
