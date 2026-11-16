import { Search } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { fillBrand } from "@/lib/marketing/brand-fill";
import { HELP_QUERY_MAX, type HelpArticle, type HelpReader } from "@/lib/marketing/help-search";

const READERS: { value: HelpReader | null; label: string }[] = [
  { value: null, label: "Everyone" },
  { value: "teen", label: "For teenagers" },
  { value: "parent", label: "For parents and carers" },
];

/** The address of the help page for a search and a reader. */
export function helpHref(input: { query?: string; reader?: HelpReader | null }): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.reader) params.set("for", input.reader);
  const text = params.toString();
  return text ? `/help?${text}` : "/help";
}

/** A plain GET form, so search works without JavaScript and a result page can be bookmarked. */
export function HelpSearchForm({ query, reader }: { query: string; reader: HelpReader | null }) {
  return (
    <div className="flex flex-col gap-4">
      <form action="/help" method="get" role="search" className="flex flex-wrap items-end gap-3">
        <Field label="Search the help centre" className="min-w-0 flex-1 basis-64">
          <Input type="search" name="q" defaultValue={query} maxLength={HELP_QUERY_MAX} autoComplete="off" enterKeyHint="search" />
        </Field>
        {reader && <input type="hidden" name="for" value={reader} />}
        <Button type="submit" iconStart={<Search aria-hidden="true" className="size-5" strokeWidth={2.5} />}>
          Search
        </Button>
      </form>
      <nav aria-label="Show help for">
        <ul className="flex flex-wrap gap-2">
          {READERS.map((option) => {
            const current = option.value === reader;
            return (
              <li key={option.label}>
                <Link
                  href={helpHref({ query, reader: option.value })}
                  aria-current={current ? "true" : undefined}
                  className="rounded-control border-ink text-ink hover:bg-tint aria-[current=true]:bg-ink aria-[current=true]:text-paper inline-flex min-h-11 items-center border-2 px-3 font-bold no-underline"
                >
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

const AUDIENCE_LABEL: Record<HelpArticle["audience"], string | null> = { everyone: null, teen: "For teenagers", adult: "For parents and carers" };

export function AudienceBadge({ audience }: { audience: HelpArticle["audience"] }) {
  const label = AUDIENCE_LABEL[audience];
  return label ? <Badge tone={audience === "teen" ? "accent" : "info"}>{label}</Badge> : null;
}

export function HelpArticleList({ articles, headingLevel: Heading = "h3" }: { articles: readonly HelpArticle[]; headingLevel?: "h2" | "h3" }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {articles.map((article) => (
        <Card as="li" key={article.slug} className="flex flex-col gap-2">
          <Heading className="text-lg font-bold">
            <Link href={`/help/${article.slug}`} className="link">
              {fillBrand(article.title)}
            </Link>
          </Heading>
          {article.summary && <p className="text-ink-muted flex-1">{fillBrand(article.summary)}</p>}
          <AudienceBadge audience={article.audience} />
        </Card>
      ))}
    </ul>
  );
}
