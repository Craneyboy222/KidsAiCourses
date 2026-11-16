import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolsYouNeed, type ToolsYouNeedProps } from "@/components/course/ToolsYouNeed";
import type { Course } from "@/content/schema";
import { getCtx, type Ctx } from "@/server/context";
import { courseVersion, toolChangeEvent } from "@/server/db";
import { decideToolApproval, requestToolApproval } from "@/server/services/tool-approval";
import { db, testCtx } from "../../helpers/db";
import { HOMEWORK, SNAPCHAT, courseBySlug, family, resetTools, seedCourses, setTool, staffCtx, tearDownStorage, toolBySlug, useToolMocks } from "./helpers";

vi.mock("@/server/context", async (original) => ({ ...(await original<typeof import("@/server/context")>()), getCtx: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/safeguarding", () => ({ openSafeguardingCase: vi.fn() }));
vi.mock("@/server/services/usage", () => ({ checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/enrolment", () => ({ recordEvidenceOutcome: vi.fn(), getEnrolmentById: vi.fn() }));

beforeAll(seedCourses);
afterAll(tearDownStorage);
beforeEach(async () => {
  useToolMocks();
  await resetTools();
  await db.delete(toolChangeEvent);
  await setTool("chatgpt", { cost: "Free plan is enough. A paid plan is optional.", freeTier: "Free plan with daily limits", minAge: 13, lastCheckedAt: new Date("2026-11-01T10:00:00Z") });
});

async function propsFor(slug: string, viewer: ToolsYouNeedProps["viewer"]): Promise<ToolsYouNeedProps> {
  const target = await courseBySlug(slug);
  const [version] = await db.select().from(courseVersion).where(eq(courseVersion.id, target.publishedVersionId));
  const content = version?.snapshot as Course;
  return { courseId: target.id, courseSlug: slug, toolRequirements: content.toolRequirements, setupGuides: content.setupGuides.map(({ id, toolSlug, title, lastVerifiedAt }) => ({ id, toolSlug, title, lastVerifiedAt })), viewer };
}

async function html(ctx: Ctx, props: ToolsYouNeedProps): Promise<string> {
  vi.mocked(getCtx).mockResolvedValue(ctx);
  return renderToStaticMarkup(await ToolsYouNeed(props));
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("Tools you'll need", () => {
  it("shows the public every Register fact for each tool, read at request time", async () => {
    const props = await propsFor(HOMEWORK, { kind: "public" });
    const first = text(await html(testCtx(), props));
    expect(first).toContain("ChatGPT");
    expect(first).toContain("Official site");
    expect(first).toContain("Open ChatGPT");
    expect(first).toContain("Free plan with daily limits");
    expect(first).toContain("Free plan is enough. A paid plan is optional.");
    expect(first).toContain("13 and over, under ChatGPT's own rules");
    expect(first).toContain("You can set up your own account");
    expect(first).toContain(props.setupGuides[0]?.title ?? "missing guide");
    expect(first).toContain("Guide last checked");
    expect(first).toContain("ChatGPT's rules last checked 1 November 2026");
    // No approval controls and nothing personal on the public page.
    expect(first).not.toMatch(/Ask a parent about|Approve ChatGPT|Staff only/);

    // The course did not change; the Register did, and the page follows it.
    await setTool("chatgpt", { minAge: 16, under18Policy: "parent_consent_required", freeTier: "Free plan, sign-in needed" });
    const second = text(await html(testCtx(), props));
    expect(second).toContain("16 and over");
    expect(second).toContain("A parent or carer needs to say yes before you use it.");
    expect(second).toContain("Free plan, sign-in needed");
    expect(second).not.toContain("Free plan with daily limits");
  });

  it("never links or presents as usable a tool that is not approved, and names the fallback", async () => {
    await setTool("replit", { status: "blocked" });
    const page = text(await html(testCtx(), await propsFor(SNAPCHAT, { kind: "public" })));
    expect(page).toContain("Replit isn't available at the moment");
    expect(page).toContain("You can use Base44 for this course instead");
    expect(page).not.toContain("Open Replit");
    await setTool("base44", { status: "pending_verification" });
    const both = text(await html(testCtx(), await propsFor(SNAPCHAT, { kind: "public" })));
    expect(both).toContain("the course can't be started just yet");
    expect(both).not.toContain("Open Base44");
  });

  it("shows a learner their own approval state and an 'Ask a parent' button", async () => {
    const who = await family({ nickname: "Maya" });
    const target = await courseBySlug(HOMEWORK);
    const props = await propsFor(HOMEWORK, { kind: "learner", learnerId: who.learnerId });

    expect(text(await html(who.learner, props))).toContain("Ready to use");
    await setTool("chatgpt", { under18Policy: "parent_consent_required" });
    const ask = await html(who.learner, props);
    expect(text(ask)).toContain("Ask a parent about ChatGPT");
    expect(ask).toContain('name="toolSlug" value="chatgpt"');
    // The setup guide links into the player for a learner.
    expect(ask).toMatch(new RegExp(`href="/learn/${HOMEWORK}/s2"`));

    const request = await requestToolApproval(who.learner, { learnerId: who.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(text(await html(who.learner, props))).toContain("Waiting for your parent to decide");
    await decideToolApproval(who.parent, request.id, "decline");
    const declined = text(await html(who.learner, props));
    expect(declined).toContain("Your parent said no last time");
    expect(declined).toContain("Ask a parent about ChatGPT");
    await decideToolApproval(who.parent, request.id, "approve");
    expect(text(await html(who.learner, props))).toContain("Approved by your parent");

    await setTool("chatgpt", { under18Policy: "parent_operated", minAge: 18 });
    const operated = text(await html(who.learner, props));
    expect(operated).toContain("Ask a parent to set this up.");
    expect(operated).toContain("Ask a parent to set up ChatGPT");
    expect(operated).not.toMatch(/create your own account/i);
  });

  it("tells a learner when a tool is on hold", async () => {
    const who = await family();
    await db.insert(toolChangeEvent).values({ toolId: (await toolBySlug("chatgpt")).id, pageUrl: "https://chatgpt.com/terms", impact: "age_policy", status: "open", blocksStart: true });
    expect(text(await html(who.learner, await propsFor(HOMEWORK, { kind: "learner", learnerId: who.learnerId })))).toContain("On hold while we re-check its rules");
  });

  it("gives nothing personal away when the learner named is not the viewer's to ask about", async () => {
    const mine = await family({ nickname: "Maya" });
    const other = await family({ nickname: "Zed" });
    await setTool("chatgpt", { under18Policy: "parent_consent_required" });
    const target = await courseBySlug(HOMEWORK);
    await requestToolApproval(mine.learner, { learnerId: mine.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    for (const [ctx, viewer] of [
      [other.learner, { kind: "learner", learnerId: mine.learnerId }],
      [other.parent, { kind: "parent", familyId: mine.familyId, learnerId: mine.learnerId }],
      [other.parent, { kind: "parent", familyId: other.familyId, learnerId: mine.learnerId }],
      [testCtx(), { kind: "learner", learnerId: mine.learnerId }],
    ] as const) {
      const page = text(await html(ctx, await propsFor(HOMEWORK, viewer)));
      expect(page).not.toMatch(/Waiting for your parent|has asked you|Maya|Approve ChatGPT/);
    }
  });

  it("gives a parent approve and decline for their child, the confirmation for a parent-operated tool, and a way to remove approval", async () => {
    const who = await family({ nickname: "Maya" });
    const target = await courseBySlug(HOMEWORK);
    await setTool("chatgpt", { under18Policy: "parent_consent_required" });
    const props = await propsFor(HOMEWORK, { kind: "parent", familyId: who.familyId, learnerId: who.learnerId });

    const fresh = text(await html(who.parent, props));
    expect(fresh).toContain("Approve ChatGPT for Maya");
    expect(fresh).toContain("Decline");
    expect(fresh).toContain("This tool asks for a parent or carer's permission");

    const request = await requestToolApproval(who.learner, { learnerId: who.learnerId, courseId: target.id, toolSlug: "chatgpt" });
    expect(text(await html(who.parent, props))).toContain("Maya has asked you about this");
    await decideToolApproval(who.parent, request.id, "approve");
    const approved = text(await html(who.parent, props));
    expect(approved).toContain("You approved this for Maya");
    expect(approved).toContain("Remove approval for ChatGPT");

    await setTool("chatgpt", { under18Policy: "parent_operated", minAge: 18 });
    const operated = text(await html(who.parent, props));
    expect(operated).toContain("I will set up the ChatGPT account myself and stay in charge of it");
    expect(operated).toContain("never needs your password");
    // Without a child in view there is nothing to decide yet.
    expect(text(await html(who.parent, await propsFor(HOMEWORK, { kind: "parent", familyId: who.familyId })))).toContain("You'll be asked to approve this for each child");
  });

  it("shows staff what has not been verified", async () => {
    const editor = await staffCtx("editor");
    await setTool("chatgpt", { status: "pending_verification", verifiedAt: null, lastCheckedAt: null, minAge: null });
    const page = text(await html(editor, await propsFor(HOMEWORK, { kind: "staff" })));
    expect(page).toContain("Staff only: not yet verified");
    expect(page).toContain("Register status: pending verification");
    expect(page).toContain("Minimum age not verified");
    expect(page).toContain("Never checked");
    // The same course, seen by the public, shows no staff notes.
    expect(text(await html(testCtx(), await propsFor(HOMEWORK, { kind: "public" })))).not.toMatch(/Staff only|Register status/);
  });

  it("never shows a price for our own plans", async () => {
    const who = await family();
    const page = text(await html(who.learner, await propsFor(SNAPCHAT, { kind: "learner", learnerId: who.learnerId })));
    expect(page).not.toMatch(/family plan|subscribe|upgrade|per month|checkout/i);
  });
});
