import { ExternalLink } from "lucide-react";
import type { ComponentProps, ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cx } from "./cn";

export type MarkdownProps = {
  /** Markdown source. Raw HTML inside it is dropped, not rendered. */
  children: string;
  /**
   * The level a Markdown `#` becomes. Defaults to 2, because the page already
   * has its own `<h1>`. Deeper headings shift by the same amount, capped at h6.
   */
  topHeadingLevel?: 2 | 3 | 4;
  className?: string;
};

/**
 * Only web and email links survive. `javascript:`, `data:`, `vbscript:` and
 * anything else unknown are stripped by the sanitiser, and images may only
 * load over http(s) or from this site.
 */
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

const isExternal = (href: string | undefined): boolean => !!href && /^(https?:)?\/\//i.test(href);

function heading(level: number) {
  const Tag = `h${Math.min(level, 6)}` as ElementType;
  return function Heading({ node: _node, ...props }: ComponentProps<"h2"> & { node?: unknown }) {
    return <Tag {...props} />;
  };
}

function componentsFor(top: number): Components {
  return {
    h1: heading(top),
    h2: heading(top + 1),
    h3: heading(top + 2),
    h4: heading(top + 3),
    h5: heading(top + 4),
    h6: heading(top + 5),
    a({ node: _node, href, children, ...props }) {
      if (!isExternal(href)) {
        return (
          <a href={href} {...props}>
            {children}
          </a>
        );
      }
      return (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer">
          {children}
          <ExternalLink
            aria-hidden="true"
            className="ml-1 inline size-[0.9em] align-[-0.1em]"
            strokeWidth={2.5}
          />{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      );
    },
    input({ node: _node, type, checked }) {
      // GFM task lists render read-only tick boxes. Give each one a name so it is not an unlabelled control.
      if (type !== "checkbox") return null;
      return (
        <input
          type="checkbox"
          className="check mr-2 size-5 align-[-0.2em]"
          checked={!!checked}
          disabled
          readOnly
          aria-label={checked ? "Done" : "Not done yet"}
        />
      );
    },
    img({ node: _node, alt, ...props }) {
      // Content images come from the asset library; next/image cannot size unknown Markdown images.
      // eslint-disable-next-line @next/next/no-img-element
      return <img alt={alt ?? ""} loading="lazy" decoding="async" {...props} />;
    },
  };
}

/**
 * Renders Markdown from course content, legal pages and Coach replies. The
 * source is trusted-but-sanitised: raw HTML is skipped, the tree is passed
 * through rehype-sanitize, and external links open in a new tab with
 * `rel="noopener noreferrer"` and say so to screen readers.
 *
 * Works in Server Components, so the Markdown parser never reaches the browser
 * unless a Client Component imports it.
 */
export function Markdown({ children, topHeadingLevel = 2, className }: MarkdownProps) {
  return (
    <div className={cx("prose", className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={componentsFor(topHeadingLevel)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
