import { describe, expect, it } from "vitest";
import { EN_GB } from "@/content/copy/en-GB";
import { HELP_TOPICS, countToConfirm, fromStoredBody, isUnreviewedLegalText, parsePageFile, splitFrontMatter, stripDraftBannerLine, toStoredBody, type PageFile } from "@/lib/marketing/page-file";
import { LEGAL_DRAFT_BANNER, LEGAL_SLUGS, LEGAL_TO_CONFIRM, PUBLIC_ROUTES } from "@/lib/marketing/site";
import { readPageFiles } from "@/server/services/pages";
import { readAllPageFiles } from "../../../scripts/import-pages";

/**
 * The words on the public site are content files. These tests read the real files and hold them
 * to the rules in the brief: enough help, honest claims, no prices, and legal text that cannot be
 * mistaken for finished.
 */
const ALL: PageFile[] = readAllPageFiles();
const of = (kind: PageFile["kind"]) => ALL.filter((file) => file.kind === kind);
const text = (file: PageFile) => `${file.title}\n${file.summary ?? ""}\n${file.body}`;
const MARKETING_COPY = Object.entries(EN_GB).filter(([key]) => key.startsWith("marketing."));

describe("the page file format", () => {
  it("reads front matter and the text under it", () => {
    const parsed = splitFrontMatter('---\ntitle: "Tools: what you need"\naudience: teen\n---\n\nHello.\n');
    expect(parsed.meta).toEqual({ title: "Tools: what you need", audience: "teen" });
    expect(parsed.body).toBe("Hello.");
    expect(splitFrontMatter("No front matter").meta).toEqual({});
  });

  it("refuses files that are wrong, and says which file", () => {
    const body = "A paragraph that is long enough to count as the text of a page.";
    expect(() => parsePageFile(`---\ntitle: Ok title\n---\n${body}`, { kind: "marketing", slug: "Bad_Slug" })).toThrow(/content\/pages\/marketing\/Bad_Slug\.md/);
    expect(() => parsePageFile(`---\naudience: teen\n---\n${body}`, { kind: "marketing", slug: "x" })).toThrow(/title/);
    expect(() => parsePageFile(`---\ntitle: Ok title\naudience: staff\n---\n${body}`, { kind: "marketing", slug: "x" })).toThrow(/audience/);
    expect(() => parsePageFile(`---\ntitle: Ok title\n---\nShort.`, { kind: "marketing", slug: "x" })).toThrow(/no text/);
    expect(() => parsePageFile(`---\ntitle: Ok title\n---\n${body}<script>alert(1)</script>`, { kind: "marketing", slug: "x" })).toThrow(/Markdown only/);
    expect(() => parsePageFile(`---\ntitle: Ok title\n---\n${body}`, { kind: "help", slug: "x" })).toThrow(/topic and a summary/);
    // Finished legal text cannot be slipped in through a file: a file is always a draft.
    expect(() => parsePageFile(`---\ntitle: Privacy notice\n---\n${body}`, { kind: "legal", slug: "privacy" })).toThrow(/Draft — not yet reviewed by a lawyer/);
  });

  it("keeps the summary and topic with the stored text, and gets them back", () => {
    const file = of("help")[0]!;
    const back = fromStoredBody(toStoredBody(file));
    expect(back).toEqual({ summary: file.summary, topic: file.topic, body: file.body });
    expect(fromStoredBody("Just text.")).toEqual({ summary: null, topic: null, body: "Just text." });
    expect(fromStoredBody("---\ntopic: made-up\n---\nText.").topic).toBeNull();
  });
});

describe("the content files", () => {
  it("use each slug once, across marketing, help and legal", () => {
    expect(new Set(ALL.map((file) => file.slug)).size).toBe(ALL.length);
  });

  it("include the text of every marketing page", () => {
    expect(of("marketing").map((file) => file.slug).sort()).toEqual(["home", "how-it-works", "parents", "pricing", "radar", "safety"]);
  });

  it("only link to pages that exist", () => {
    const known = new Set<string>([
      ...PUBLIC_ROUTES.map((route) => route.path),
      ...of("help").map((file) => `/help/${file.slug}`),
      ...LEGAL_SLUGS.map((slug) => `/legal/${slug}`),
    ]);
    for (const file of ALL) {
      for (const match of file.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const path = (match[1] ?? "").split(/[?#]/)[0] ?? "";
        expect(known.has(path), `${file.kind}/${file.slug} links to ${path}`).toBe(true);
      }
      // No links out to other websites, and no images, scripts or embeds from anywhere.
      expect(file.body, `${file.kind}/${file.slug}`).not.toMatch(/\]\(https?:|!\[|<iframe|<script|<img/i);
    }
  });

  it("never state a price: prices are data, and under-18s must not meet one", () => {
    for (const file of ALL) expect(text(file), `${file.kind}/${file.slug}`).not.toMatch(/£\s?\d|\b\d+(\.\d{2})?\s?(pounds|pence|p\b)|\bGBP\b/i);
    for (const [key, value] of MARKETING_COPY) expect(value, key).not.toMatch(/£|\bGBP\b|pence/i);
  });

  it("make honest claims only", () => {
    const banned = [/trusted by/i, /testimonial/i, /\baward[- ]winning\b/i, /\b\d[\d,.]*\+?\s*(k\b|thousand|million)?\s*(families|parents|teens|teenagers|students|learners|schools|users)\b/i, /\b100% safe\b/i, /\bcompletely safe\b/i, /\bguarantee/i, /\bOfsted\b/i, /\bDfE[- ]approved\b/i, /\bkitemark/i, /\b(fully )?accredited by\b/i, /\b#1\b|\bnumber one\b|\bleading\b|\bbest[- ]in[- ]class\b/i];
    const everything = [...ALL.filter((file) => file.kind !== "legal").map((file) => [`${file.kind}/${file.slug}`, text(file)] as const), ...MARKETING_COPY];
    for (const [name, words] of everything) {
      for (const pattern of banned) expect(words, `${name} matches ${pattern}`).not.toMatch(pattern);
    }
    // The only mention of accreditation anywhere says that certificates are NOT accredited.
    for (const file of ALL) {
      for (const match of text(file).matchAll(/[^.\n]*accredit[^.\n]*/gi)) expect(match[0], `${file.kind}/${file.slug}`).toMatch(/\bnot\b/i);
    }
  });

  it("say plainly what a family should know before signing up", () => {
    const home = of("marketing").find((file) => file.slug === "home")!;
    expect(home.body).toMatch(/videos are short at launch, and most steps are written/i);
    expect(home.body).toMatch(/drafted with AI and signed off by a person/i);
    expect(home.body).toMatch(/Coach gives hints\. It does not do the work/i);
    const safety = of("marketing").find((file) => file.slug === "safety")!;
    expect(safety.body).toMatch(/cannot promise that another company's tool is safe/i);
    expect(safety.body).toMatch(/automated checks are not perfect/i);
    expect(safety.body).toMatch(/999/);
    expect(safety.body).toMatch(/0800 1111/);
    const parents = of("marketing").find((file) => file.slug === "parents")!;
    expect(parents.body).toMatch(/course videos are short and most steps are written/i);
    expect(parents.body).toMatch(/a person signs off every one/i);
  });

  it("never ask anyone for an outside tool's password, code or key", () => {
    for (const file of ALL) expect(text(file), `${file.kind}/${file.slug}`).not.toMatch(/(enter|type|give us|send us|share) your (tool |replit |canva )?(password|api key|one-time code)/i);
  });
});

describe("the help centre", () => {
  const help = of("help");

  it("has at least 15 articles, for teenagers and for parents", () => {
    expect(help.length).toBeGreaterThanOrEqual(15);
    expect(help.filter((file) => file.audience === "teen").length).toBeGreaterThanOrEqual(4);
    expect(help.filter((file) => file.audience === "adult").length).toBeGreaterThanOrEqual(4);
    for (const file of help) {
      expect(file.summary, file.slug).toBeTruthy();
      expect(file.body.length, file.slug).toBeGreaterThan(400);
    }
  });

  it("covers every subject the brief lists", () => {
    const covered = (pattern: RegExp) => help.some((file) => pattern.test(text(file)));
    const subjects: [string, RegExp][] = [
      ["accounts", /family account/i],
      ["invite codes", /invite code/i],
      ["consent", /consent centre/i],
      ["tools and approvals", /approvals inbox/i],
      ["Coach", /Coach is the AI helper/i],
      ["energy", /Coach "energy"/i],
      ["time caps", /daily limit/i],
      ["submissions and review", /awaiting review/i],
      ["certificates", /checking a certificate/i],
      ["data download and deletion", /14 days to undo/i],
      ["reporting a concern", /Report control/i],
      ["billing for parents", /Stripe/i],
    ];
    for (const [name, pattern] of subjects) expect(covered(pattern), name).toBe(true);
    expect([...new Set(help.map((file) => file.topic))].sort()).toEqual(HELP_TOPICS.map((topic) => topic.key).sort());
  });

  it("keeps billing articles for adults", () => {
    for (const file of help.filter((entry) => entry.topic === "billing")) expect(file.audience, file.slug).toBe("adult");
    // Articles written for teenagers do not talk about paying.
    for (const file of help.filter((entry) => entry.audience === "teen")) expect(text(file), file.slug).not.toMatch(/\b(price|prices|checkout|invoice|promo code|subscription|card check)\b/i);
  });
});

describe("the legal drafts", () => {
  const legal = readPageFiles("legal");

  it("are exactly the six pages of decision D16", () => {
    expect(legal.map((file) => file.slug).sort()).toEqual([...LEGAL_SLUGS].sort());
  });

  it("each open with the draft banner and mark every open decision", () => {
    for (const file of legal) {
      expect(file.body.trimStart().startsWith(`> **${LEGAL_DRAFT_BANNER}.**`), file.slug).toBe(true);
      expect(isUnreviewedLegalText(file.body), file.slug).toBe(true);
      expect(countToConfirm(file.body), file.slug).toBeGreaterThanOrEqual(2);
      const stripped = stripDraftBannerLine(file.body);
      expect(stripped.startsWith(">"), file.slug).toBe(false);
      expect(stripped.length).toBeLessThan(file.body.length);
    }
    // The decisions the spec says need a lawyer (Section 17) are marked, not asserted.
    const privacy = legal.find((file) => file.slug === "privacy")!;
    for (const topic of [/lawful basis/i, /age assurance/i, /hosting region/i, /Safeguarding records/i, /company legal name/i]) {
      const line = privacy.body.split("\n").find((candidate) => topic.test(candidate) && candidate.includes(LEGAL_TO_CONFIRM));
      expect(line, `privacy: ${topic}`).toBeTruthy();
    }
    expect(legal.find((file) => file.slug === "terms")!.body).toMatch(/TO CONFIRM: your right to cancel within 14 days/);
  });

  it("only strip a banner that is really there", () => {
    expect(stripDraftBannerLine("## Heading\n\nText.")).toBe("## Heading\n\nText.");
    expect(stripDraftBannerLine("> A quote that is not the banner.\n\nText.")).toBe("> A quote that is not the banner.\n\nText.");
    expect(isUnreviewedLegalText("Reviewed text with nothing left open.")).toBe(false);
  });

  it("write the teen privacy page in short, plain sentences", () => {
    const teen = legal.find((file) => file.slug === "privacy-teen")!;
    const prose = stripDraftBannerLine(teen.body).replace(/⚖️ TO CONFIRM:[^\n]*/g, "").replace(/[#*>\-[\]()]/g, " ");
    const sentences = prose.split(/[.!?:]\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.split(/\s+/).length > 2);
    const words = sentences.map((sentence) => sentence.split(/\s+/).length);
    const average = words.reduce((total, count) => total + count, 0) / words.length;
    expect(average).toBeLessThan(14);
    expect(Math.max(...words)).toBeLessThanOrEqual(32);
    expect(teen.audience).toBe("teen");
    expect(teen.body).not.toMatch(/\b(pursuant|herein|notwithstanding|data subject|legitimate interests|controller|processor)\b/i);
  });
});
