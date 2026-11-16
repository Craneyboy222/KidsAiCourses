import type { ReactNode } from "react";
import { Callout, Markdown, PageHeader } from "@/components/ui";
import { fillBrand } from "@/lib/marketing/brand-fill";

/** The common frame of a public text page: one column, sized for reading. */
export function PublicPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto flex w-full ${wide ? "max-w-6xl" : "max-w-4xl"} flex-col gap-8 px-4 py-8 sm:py-10`}>{children}</div>;
}

export type ProsePageProps = {
  /** The page's `<h1>`. */
  title: string;
  description?: string | null;
  breadcrumbs?: ReactNode;
  eyebrow?: ReactNode;
  /** Markdown. `null` when the page has been taken down in Studio or its text could not be loaded; `""` for a page with no text of its own. */
  body: string | null;
  /** Shown between the heading and the text, for example a notice. */
  before?: ReactNode;
  /** Shown under the text, for example calls to action. */
  after?: ReactNode;
};

/**
 * A public page whose words come from the `page` table (or the file shipped with the code).
 * Headings in the Markdown start at `<h2>`, under the page's one `<h1>`.
 */
export function ProsePage({ title, description, breadcrumbs, eyebrow, body, before, after }: ProsePageProps) {
  return (
    <PublicPage>
      <PageHeader title={fillBrand(title)} description={description ? fillBrand(description) : undefined} breadcrumbs={breadcrumbs} eyebrow={eyebrow} />
      {before}
      {body !== null ? (
        body.trim() !== "" && <Markdown>{fillBrand(body)}</Markdown>
      ) : (
        <Callout tone="info" title="This page is being updated">
          <p>The text for this page is not available right now. Please come back shortly.</p>
        </Callout>
      )}
      {after}
    </PublicPage>
  );
}
