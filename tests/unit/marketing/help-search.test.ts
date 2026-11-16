import { describe, expect, it } from "vitest";
import { groupByTopic, isForReader, parseQuery, parseReader, queryTerms, scoreArticle, searchHelp, stem, tokenise, type HelpArticle } from "@/lib/marketing/help-search";
import { readPageFiles } from "@/server/services/pages";

/** The real help articles, so the search is tested against what people will actually search. */
const ARTICLES: HelpArticle[] = readPageFiles("help");
const slugs = (articles: HelpArticle[]) => articles.map((article) => article.slug);

const article = (over: Partial<HelpArticle>): HelpArticle => ({ slug: "a", title: "Title", summary: null, topic: null, audience: "everyone", position: 0, body: "", ...over });

describe("help search: words", () => {
  it("splits text into plain lower-case words", () => {
    expect(tokenise("Don't share your Pass-word, OK?")).toEqual(["dont", "share", "your", "pass", "word", "ok"]);
    expect(tokenise("  ")).toEqual([]);
  });

  it("drops filler words, folds synonyms and stems", () => {
    expect(queryTerms("How do I reset my password?")).toEqual(["reset", "password"]);
    expect(queryTerms("login")).toEqual(["sign", "in"]);
    expect(stem("certificates")).toBe(stem("certificate"));
    expect(stem("codes")).toBe(stem("code"));
    expect(stem("deletion")).toBe(stem("deleting"));
    expect(queryTerms("credits")).toEqual(["energy"]);
    expect(queryTerms("the and of")).toEqual([]);
    expect(stem("approvals")).toBe(stem("approved"));
    expect(queryTerms("a ".repeat(200) + "certificate")).toEqual([]);
  });

  it("reads the search box and the reader filter from the address, safely", () => {
    expect(parseQuery("  invite   code ")).toBe("invite code");
    expect(parseQuery(["first", "second"])).toBe("first");
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery("x".repeat(500))).toHaveLength(80);
    expect(parseReader("teen")).toBe("teen");
    expect(parseReader("parent")).toBe("parent");
    expect(parseReader("staff")).toBeNull();
    expect(parseReader(undefined)).toBeNull();
  });
});

describe("help search: ranking", () => {
  it("counts a word in the title most, then the summary, then the text", () => {
    const terms = queryTerms("invite");
    const inTitle = scoreArticle(article({ title: "Invite codes" }), terms);
    const inSummary = scoreArticle(article({ summary: "About an invite" }), terms);
    const inBody = scoreArticle(article({ body: "Use the invite." }), terms);
    expect(inTitle).toBeGreaterThan(inSummary);
    expect(inSummary).toBeGreaterThan(inBody);
    expect(inBody).toBeGreaterThan(0);
    expect(scoreArticle(article({ body: "nothing relevant" }), terms)).toBe(0);
    expect(scoreArticle(article({ title: "Invite codes" }), [])).toBe(0);
  });

  it("does not let a long article win by repeating a word", () => {
    const short = scoreArticle(article({ title: "Certificates" }), queryTerms("certificate"));
    const long = scoreArticle(article({ body: "certificate ".repeat(200) }), queryTerms("certificate"));
    expect(long).toBeGreaterThan(0);
    expect(short).toBeGreaterThan(long);
  });

  it("puts an article that answers the whole question above one that matches a single word", () => {
    const both = article({ slug: "both", title: "Reset a password" });
    const one = article({ slug: "one", title: "Password rules and password tips", body: "password password" });
    expect(slugs(searchHelp([one, both], { query: "reset password" }))).toEqual(["both", "one"]);
  });
});

describe("help search: the real articles", () => {
  it.each([
    ["invite code", "invite-codes"],
    ["forgot my password", "signing-in"],
    ["login", "signing-in"],
    ["what can my mum see", "what-my-parent-can-see"],
    ["coach energy", "coach-energy"],
    ["credits", "coach-energy"],
    ["certificate", "portfolio-and-certificates"],
    ["delete my child's data", "download-or-delete-data"],
    ["quiet hours", "time-limits"],
    ["screen time limit", "time-limits"],
    ["report bullying", "reporting-a-concern"],
    ["someone is in danger", "reporting-a-concern"],
    ["cancel subscription", "plans-and-billing"],
    ["approve a tool", "tool-approvals"],
    ["consent", "consent-centre"],
    ["hand in my work", "handing-in-your-work"],
    ["dyslexia", "accessibility-settings"],
    ["under 13", "ages-13-to-18"],
  ])("“%s” finds %s first", (query, expected) => {
    expect(slugs(searchHelp(ARTICLES, { query }))[0]).toBe(expected);
  });

  it("returns nothing for words that are not in any article", () => {
    expect(searchHelp(ARTICLES, { query: "zebra xylophone" })).toEqual([]);
  });

  it("returns every article, in its set order, when there is nothing to search for", () => {
    for (const query of ["", "   ", "the of and", undefined, null]) {
      const all = searchHelp(ARTICLES, { query });
      expect(all).toHaveLength(ARTICLES.length);
      expect(all.map((entry) => entry.position)).toEqual([...all.map((entry) => entry.position)].sort((a, b) => a - b));
    }
  });

  it("shows teenagers their articles and the shared ones, never the parents' ones, and the other way round", () => {
    const teen = searchHelp(ARTICLES, { reader: "teen" });
    const parent = searchHelp(ARTICLES, { reader: "parent" });
    expect(teen.length).toBeGreaterThan(5);
    expect(parent.length).toBeGreaterThan(5);
    expect(teen.every((entry) => entry.audience !== "adult")).toBe(true);
    expect(parent.every((entry) => entry.audience !== "teen")).toBe(true);
    expect(slugs(searchHelp(ARTICLES, { query: "billing", reader: "teen" }))).not.toContain("plans-and-billing");
    expect(slugs(searchHelp(ARTICLES, { query: "billing", reader: "parent" }))).toContain("plans-and-billing");
    expect(isForReader({ audience: "everyone" }, "teen")).toBe(true);
    expect(isForReader({ audience: "adult" }, null)).toBe(true);
  });

  it("groups articles under topic headings in a fixed order, leaving empty topics out", () => {
    const groups = groupByTopic(ARTICLES);
    expect(groups.map((group) => group.key)).toEqual(["getting-started", "accounts", "consent", "tools", "coach", "learning", "work", "safety", "billing"]);
    expect(groups.reduce((total, group) => total + group.articles.length, 0)).toBe(ARTICLES.length);
    expect(groupByTopic(ARTICLES.filter((entry) => entry.topic === "coach")).map((group) => group.key)).toEqual(["coach"]);
    expect(groupByTopic([article({ slug: "loose" })]).map((group) => group.key)).toEqual(["other"]);
  });
});
