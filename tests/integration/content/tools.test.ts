import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolSeed } from "@/content/tool-schema";
import { resetEnvCache } from "@/env";
import { ANONYMOUS } from "@/server/authz";
import { auditLog, tool, toolSubstitute } from "@/server/db";
import { getAssetsByKeys, listAssets, upsertAssetsFromManifest } from "@/server/services/assets";
import { publishVersion } from "@/server/services/publish";
import {
  DEV_SEED_NOTE,
  addSubstitute,
  approveTool,
  blockTool,
  createCandidateTool,
  getToolBySlug,
  getToolsBySlugs,
  listTools,
  toolViewForLearners,
  updateToolFields,
  upsertToolFromSeed,
} from "@/server/services/tools";
import { loadContent } from "../../../scripts/check-content";
import { closeDb, db, resetDb } from "../../helpers/db";
import { createLearner } from "../../helpers/factories";
import { appError, approvedCourse, auditActions, ctxFor, setUpRegister, staff, systemCtx } from "./helpers";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

const seed = (overrides: Partial<ToolSeed> = {}): ToolSeed => ({
  slug: "sketchpad",
  name: "Sketchpad",
  vendorDomain: "sketchpad.example",
  officialUrl: "https://sketchpad.example/",
  allowedUrlPrefixes: ["https://sketchpad.example/"],
  cost: { freeTier: null, paidNote: null },
  minAge: null,
  consentRule: null,
  under18Policy: null,
  notes: "To verify before publish.",
  seedStatus: "pending_verification",
  lastCheckedAt: null,
  evidence: [],
  toVerify: true,
  ...overrides,
});

const approveInput = { under18Policy: "allowed", minAge: 13, evidenceChecked: true } as const;

async function stored(slug = "sketchpad") {
  const row = await getToolBySlug({ db }, slug);
  if (!row) throw new Error(`no tool ${slug}`);
  return row;
}

describe("upsertToolFromSeed", () => {
  it("creates a pending record with no policy and no verifier, and is idempotent", async () => {
    const first = await upsertToolFromSeed(systemCtx("content.import"), seed());
    expect(first.action).toBe("created");
    expect(first.tool).toMatchObject({
      status: "pending_verification",
      under18Policy: null,
      minAge: null,
      verifiedBy: null,
      verifiedAt: null,
      lastCheckedAt: null,
    });
    expect(toolViewForLearners(first.tool)).toBeNull();

    const again = await upsertToolFromSeed(systemCtx("content.import"), seed());
    expect(again.action).toBe("unchanged");
    expect(await stored()).toEqual(first.tool);
    expect((await auditActions()).filter((action) => action.startsWith("tool.seed"))).toEqual([
      "tool.seed.create",
    ]);
  });

  it("a seed can never create an approved tool or set a policy, whatever the file says", async () => {
    const claimsApproved = seed({
      seedStatus: "approved",
      under18Policy: "allowed",
      minAge: 13,
      lastCheckedAt: "2026-11-01",
      toVerify: false,
      evidence: [{ claim: "Minimum age", quote: "You must be 13", url: "https://sketchpad.example/terms" }],
    });
    const result = await upsertToolFromSeed(systemCtx(), claimsApproved);
    expect(result.tool).toMatchObject({
      status: "pending_verification",
      under18Policy: null,
      verifiedBy: null,
      minAge: 13,
    });
    expect(result.devSeedApproved).toBe(false);

    const candidate = await upsertToolFromSeed(
      systemCtx(),
      seed({
        slug: "other-tool",
        vendorDomain: "other.example",
        officialUrl: "https://other.example/",
        allowedUrlPrefixes: ["https://other.example/"],
        seedStatus: "candidate",
      }),
    );
    expect(candidate.tool.status).toBe("candidate");
  });

  it("updates a record nothing else has touched, and stays idempotent with evidence stored as jsonb", async () => {
    await upsertToolFromSeed(systemCtx(), seed());
    const evidence = [
      { claim: "Free plan", quote: "Free forever", url: "https://sketchpad.example/pricing" },
    ];
    const changed = await upsertToolFromSeed(
      systemCtx(),
      seed({ notes: "New note", evidence, cost: { freeTier: "Three projects", paidNote: null } }),
    );
    expect(changed.action).toBe("updated");
    expect(changed.tool).toMatchObject({
      notes: "New note",
      freeTier: "Three projects",
      status: "pending_verification",
    });
    const again = await upsertToolFromSeed(
      systemCtx(),
      seed({ notes: "New note", evidence, cost: { freeTier: "Three projects", paidNote: null } }),
    );
    expect(again.action).toBe("unchanged");
  });

  it("never downgrades or overwrites a record a person approved", async () => {
    await upsertToolFromSeed(systemCtx(), seed());
    const reviewer = await staff("reviewer");
    const approved = await approveTool(ctxFor(reviewer), "sketchpad", {
      under18Policy: "parent_consent_required",
      minAge: 13,
      evidenceChecked: true,
    });

    const result = await upsertToolFromSeed(
      systemCtx(),
      seed({ notes: "Changed in the file", minAge: 16, seedStatus: "candidate" }),
    );
    expect(result.action).toBe("kept_human_record");
    expect(await stored()).toEqual(approved);
    expect(await stored()).toMatchObject({
      status: "approved",
      under18Policy: "parent_consent_required",
      minAge: 13,
      verifiedBy: reviewer.userId,
    });
  });

  it("never overwrites a record a person edited or blocked", async () => {
    await upsertToolFromSeed(systemCtx(), seed());
    const editor = await staff("editor");
    await updateToolFields(ctxFor(editor), "sketchpad", {
      minAge: 16,
      notes: "Read the terms on 15 November 2026.",
    });
    expect((await upsertToolFromSeed(systemCtx(), seed({ notes: "From the file" }))).action).toBe(
      "kept_human_record",
    );
    expect(await stored()).toMatchObject({ minAge: 16, notes: "Read the terms on 15 November 2026." });

    await blockTool(ctxFor(editor), "sketchpad", "18+ only");
    expect((await upsertToolFromSeed(systemCtx(), seed())).action).toBe("kept_human_record");
    expect(await stored()).toMatchObject({ status: "blocked", under18Policy: "blocked" });
  });

  it("is refused for learners and signed-out visitors", async () => {
    const learner = await createLearner();
    for (const actor of [ANONYMOUS, learner.actor]) {
      const error = await appError(() => upsertToolFromSeed(ctxFor(actor), seed()));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await db.select().from(tool)).toHaveLength(0);
  });

  describe("development seed approval", () => {
    const original = { APP_ENV: process.env.APP_ENV, STAFF_2FA_REQUIRED: process.env.STAFF_2FA_REQUIRED };
    afterEach(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetEnvCache();
    });

    it("approves through approveTool as a person, with labelled placeholders", async () => {
      const owner = await staff("super_admin");
      const result = await upsertToolFromSeed(ctxFor(owner), seed(), { approveAsDevSeed: true });
      expect(result.devSeedApproved).toBe(true);
      expect(result.tool).toMatchObject({
        status: "approved",
        under18Policy: "allowed",
        minAge: 13,
        verifiedBy: owner.userId,
      });
      expect(result.tool.notes).toContain(DEV_SEED_NOTE);
      expect(result.tool.notes).toMatch(/Placeholders: under-18 policy "allowed", minimum age 13/);
      const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "tool.approve"));
      expect(entry).toMatchObject({ actorType: "staff", actorId: owner.userId, reason: "Development seed" });
      expect(entry?.meta).toMatchObject({ devSeed: true });

      // Running it again changes nothing.
      const again = await upsertToolFromSeed(ctxFor(owner), seed(), { approveAsDevSeed: true });
      expect(again).toMatchObject({ action: "kept_human_record", devSeedApproved: false });
      expect(await stored()).toEqual(result.tool);
    });

    it("cannot be done by the system actor", async () => {
      const error = await appError(() =>
        upsertToolFromSeed(systemCtx("content.import"), seed(), { approveAsDevSeed: true }),
      );
      expect(error.code).toBe("forbidden");
      expect(await stored()).toMatchObject({ status: "pending_verification", under18Policy: null });
    });

    it("is refused outside local and test, before anything is written", async () => {
      const owner = await staff("super_admin");
      process.env.APP_ENV = "preview";
      process.env.STAFF_2FA_REQUIRED = "true"; // a preview deployment may not relax staff two-step sign-in
      resetEnvCache();
      const error = await appError(() =>
        upsertToolFromSeed(ctxFor(owner), seed(), { approveAsDevSeed: true }),
      );
      expect(error.code).toBe("forbidden");
      expect(await db.select().from(tool)).toHaveLength(0);
    });
  });
});

describe("approveTool", () => {
  beforeEach(async () => {
    await upsertToolFromSeed(systemCtx(), seed());
  });

  it("records the approver, the time and the last-checked date", async () => {
    const reviewer = await staff("reviewer");
    const ctx = ctxFor(reviewer);
    const approved = await approveTool(ctx, "sketchpad", approveInput);
    expect(approved).toMatchObject({
      status: "approved",
      under18Policy: "allowed",
      minAge: 13,
      verifiedBy: reviewer.userId,
      verifiedAt: ctx.now,
      lastCheckedAt: ctx.now,
    });
    expect(toolViewForLearners(approved)).toMatchObject({
      name: "Sketchpad",
      officialUrl: "https://sketchpad.example/",
      minAge: 13,
      parentMustApprove: false,
    });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "tool.approve"));
    expect(entry).toMatchObject({ actorId: reviewer.userId, targetType: "tool" });
    expect(entry?.meta).toMatchObject({
      statusFrom: "pending_verification",
      under18Policy: "allowed",
      evidenceChecked: true,
      devSeed: false,
    });
  });

  it("is human only: the system actor, an editor, a learner and a signed-out visitor are refused", async () => {
    const learner = await createLearner();
    for (const actor of [systemCtx("radar.enrich").actor, await staff("editor"), learner.actor, ANONYMOUS]) {
      const error = await appError(() => approveTool(ctxFor(actor), "sketchpad", approveInput));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect(await stored()).toMatchObject({ status: "pending_verification", under18Policy: null });
  });

  it("needs the evidence confirmation", async () => {
    const reviewer = await staff("reviewer");
    const input = { ...approveInput, evidenceChecked: false } as unknown as Parameters<typeof approveTool>[2];
    expect((await appError(() => approveTool(ctxFor(reviewer), "sketchpad", input))).code).toBe(
      "invalid_input",
    );
    expect((await stored()).status).toBe("pending_verification");
  });

  it("parent_operated needs the reviewer to record that the vendor allows it", async () => {
    const reviewer = await staff("reviewer");
    const without = await appError(() =>
      approveTool(ctxFor(reviewer), "sketchpad", {
        under18Policy: "parent_operated",
        minAge: 18,
        evidenceChecked: true,
      }),
    );
    expect(without.code).toBe("invalid_input");
    const refused = await appError(() =>
      approveTool(ctxFor(reviewer), "sketchpad", {
        under18Policy: "parent_operated",
        minAge: 18,
        evidenceChecked: true,
        parentOperatedAllowed: false,
      }),
    );
    expect(refused.code).toBe("invalid_input");
    expect((await stored()).status).toBe("pending_verification");

    const ctx = ctxFor(reviewer);
    const approved = await approveTool(ctx, "sketchpad", {
      under18Policy: "parent_operated",
      minAge: 18,
      evidenceChecked: true,
      parentOperatedAllowed: true,
    });
    expect(approved).toMatchObject({
      under18Policy: "parent_operated",
      parentOperatedAllowedRecordedBy: reviewer.userId,
      parentOperatedAllowedRecordedAt: ctx.now,
    });
    expect(toolViewForLearners(approved)).toMatchObject({ parentMustApprove: true, parentMustSetUp: true });
  });

  it("an 18+ tool can only be parent-operated, and blocked is not an approval", async () => {
    const reviewer = await staff("reviewer");
    for (const under18Policy of ["allowed", "parent_consent_required"] as const) {
      expect(
        (
          await appError(() =>
            approveTool(ctxFor(reviewer), "sketchpad", { under18Policy, minAge: 18, evidenceChecked: true }),
          )
        ).code,
      ).toBe("invalid_input");
    }
    const blocked = { under18Policy: "blocked", minAge: 18, evidenceChecked: true } as unknown as Parameters<
      typeof approveTool
    >[2];
    expect((await appError(() => approveTool(ctxFor(reviewer), "sketchpad", blocked))).code).toBe(
      "invalid_input",
    );
    expect(
      (await appError(() => approveTool(ctxFor(reviewer), "sketchpad", { ...approveInput, minAge: 12.5 })))
        .code,
    ).toBe("invalid_input");
    expect((await appError(() => approveTool(ctxFor(reviewer), "no-such-tool", approveInput))).code).toBe(
      "not_found",
    );
    expect((await stored()).status).toBe("pending_verification");
  });

  it("refuses a record with no official link", async () => {
    const reviewer = await staff("reviewer");
    await createCandidateTool(systemCtx("radar.enrich"), {
      name: "Linkless",
      vendorDomain: "linkless.example",
    });
    expect((await appError(() => approveTool(ctxFor(reviewer), "linkless", approveInput))).code).toBe(
      "validation_failed",
    );
  });
});

describe("updateToolFields and blockTool", () => {
  it("changing a term-related field resets an approved tool and clears the verification and the policy", async () => {
    await upsertToolFromSeed(systemCtx(), seed());
    const reviewer = await staff("reviewer");
    const editor = await staff("editor");
    await approveTool(ctxFor(reviewer), "sketchpad", approveInput);

    // A field that is not about the vendor's terms leaves the approval alone.
    const renamed = await updateToolFields(ctxFor(editor), "sketchpad", {
      name: "Sketchpad Studio",
      notes: "Renamed by the vendor.",
    });
    expect(renamed.verificationReset).toBe(false);
    expect(renamed.tool).toMatchObject({
      status: "approved",
      under18Policy: "allowed",
      verifiedBy: reviewer.userId,
    });

    for (const patch of [
      { minAge: 16 },
      { cost: "£8 a month" },
      { freeTier: "One project" },
      { consentRule: "Parent must agree" },
      { allowedUrlPrefixes: ["https://sketchpad.example/", "https://app.sketchpad.example/"] },
      { officialUrl: "https://sketchpad.example/start" },
    ]) {
      await approveTool(ctxFor(reviewer), "sketchpad", {
        ...approveInput,
        minAge: (await stored()).minAge ?? 13,
      });
      const result = await updateToolFields(ctxFor(editor), "sketchpad", patch);
      expect(result.verificationReset).toBe(true);
      expect(result.tool).toMatchObject({
        status: "pending_verification",
        under18Policy: null,
        verifiedBy: null,
        verifiedAt: null,
      });
      expect(toolViewForLearners(result.tool)).toBeNull();
    }
    expect(await auditActions()).toContain("tool.update");

    // Saving the same values again is not a change.
    await approveTool(ctxFor(reviewer), "sketchpad", { ...approveInput, minAge: 16 });
    const same = await updateToolFields(ctxFor(editor), "sketchpad", { minAge: 16, cost: "£8 a month" });
    expect(same.verificationReset).toBe(false);
    expect(same.tool.status).toBe("approved");
  });

  it("validates links, and is refused for a reviewer-only account and a learner", async () => {
    await upsertToolFromSeed(systemCtx(), seed());
    const editor = await staff("editor");
    for (const patch of [
      { allowedUrlPrefixes: ["https://sketchpad.example"] },
      { allowedUrlPrefixes: ["https://evil.example/"] },
      { allowedUrlPrefixes: ["http://sketchpad.example/"] },
      { officialUrl: "https://sketchpad.example.evil.example/" },
      { minAge: 40 },
    ]) {
      expect((await appError(() => updateToolFields(ctxFor(editor), "sketchpad", patch))).code).toBe(
        "invalid_input",
      );
    }
    const learner = await createLearner();
    for (const actor of [await staff("reviewer"), learner.actor, ANONYMOUS]) {
      const error = await appError(() => updateToolFields(ctxFor(actor), "sketchpad", { name: "Nope" }));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    expect((await stored()).name).toBe("Sketchpad");
  });

  it("blocking takes effect at once, names the live courses that use the tool, and only a person can undo it", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const reviewer = await staff("reviewer");
    const approved = await approvedCourse(editor, reviewer);
    await publishVersion(ctxFor(reviewer), approved.version.id);

    expect((await appError(() => blockTool(ctxFor(editor), "replit", " "))).code).toBe("invalid_input");
    const result = await blockTool(
      systemCtx("tools.watch"),
      "replit",
      "Vendor raised the minimum age to 18.",
    );
    expect(result.tool).toMatchObject({ status: "blocked", under18Policy: "blocked" });
    expect(result.verificationReset).toBe(true);
    expect(result.affectedCourseIds).toEqual([approved.course.id]);
    expect(toolViewForLearners(result.tool)).toBeNull();
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "tool.block"));
    expect(entry).toMatchObject({ actorType: "system", reason: "Vendor raised the minimum age to 18." });

    // An edit does not unblock it; only an approval by a person does.
    const edited = await updateToolFields(ctxFor(editor), "replit", { minAge: 13 });
    expect(edited.tool).toMatchObject({ status: "blocked", under18Policy: "blocked" });
    expect((await appError(() => approveTool(systemCtx(), "replit", approveInput))).code).toBe("forbidden");
    expect((await approveTool(ctxFor(reviewer), "replit", approveInput)).status).toBe("approved");
  });
});

describe("createCandidateTool, addSubstitute and reading", () => {
  it("always creates a candidate with no age and no policy, and never a duplicate", async () => {
    const created = await createCandidateTool(systemCtx("radar.enrich"), {
      name: "Shiny New AI",
      vendorDomain: "shiny.example",
      officialUrl: "https://www.shiny.example/start?ref=radar",
      evidence: [{ claim: "Stated minimum age", quote: "13+", url: "https://www.shiny.example/terms" }],
    });
    expect(created.created).toBe(true);
    expect(created.tool).toMatchObject({
      slug: "shiny-new-ai",
      status: "candidate",
      under18Policy: null,
      minAge: null,
      verifiedBy: null,
      allowedUrlPrefixes: ["https://www.shiny.example/"],
    });
    expect(toolViewForLearners(created.tool)).toBeNull();

    const sameDomain = await createCandidateTool(systemCtx("radar.enrich"), {
      name: "Shiny (again)",
      vendorDomain: "shiny.example",
    });
    expect(sameDomain).toMatchObject({ created: false });
    expect(sameDomain.tool.id).toBe(created.tool.id);
    expect(await db.select().from(tool)).toHaveLength(1);

    // An official link on another domain is not trusted.
    const odd = await createCandidateTool(systemCtx(), {
      name: "Odd",
      vendorDomain: "odd.example",
      officialUrl: "https://elsewhere.example/",
    });
    expect(odd.tool).toMatchObject({ officialUrl: null, allowedUrlPrefixes: [] });
  });

  it("records substitutes once, in order", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const first = await addSubstitute(ctxFor(editor), "replit", "base44", "Same starter project");
    const again = await addSubstitute(ctxFor(editor), "replit", "base44");
    expect(again.id).toBe(first.id);
    const second = await addSubstitute(ctxFor(editor), "replit", "canva");
    expect([first.position, second.position]).toEqual([0, 1]);
    expect(await db.select().from(toolSubstitute)).toHaveLength(2);
    expect((await appError(() => addSubstitute(ctxFor(editor), "replit", "replit"))).code).toBe(
      "invalid_input",
    );
    expect((await appError(() => addSubstitute(ctxFor(editor), "replit", "nope"))).code).toBe("not_found");
  });

  it("lists and filters the Register for staff only", async () => {
    await setUpRegister();
    const editor = await staff("editor");
    const all = await listTools(ctxFor(editor));
    expect(all.map((row) => row.slug)).toEqual(
      expect.arrayContaining(["replit", "base44", "canva", "capcut", "chatgpt"]),
    );
    expect((await listTools(ctxFor(editor), { status: "approved" })).map((row) => row.slug).sort()).toEqual([
      "base44",
      "replit",
    ]);
    expect(
      (await listTools(ctxFor(editor), { under18Policy: "unset" })).every(
        (row) => row.under18Policy === null,
      ),
    ).toBe(true);
    expect((await listTools(ctxFor(editor), { search: "REPL" })).map((row) => row.slug)).toEqual(["replit"]);

    const learner = await createLearner();
    for (const actor of [learner.actor, ANONYMOUS]) {
      const error = await appError(() => listTools(ctxFor(actor)));
      expect(["forbidden", "unauthenticated"]).toContain(error.code);
    }
    const map = await getToolsBySlugs({ db }, ["replit", "nope", "replit"]);
    expect([...map.keys()]).toEqual(["replit"]);
    expect(await getToolBySlug({ db }, "nope")).toBeNull();
  });
});

describe("assets", () => {
  it("imports a manifest once, updates what changed, and lists for staff", async () => {
    const manifest = loadContent().assets.map(({ asset }) => asset);
    const editor = await staff("editor");
    const first = await upsertAssetsFromManifest(ctxFor(editor), manifest);
    expect(first.created).toHaveLength(manifest.length);
    const again = await upsertAssetsFromManifest(systemCtx("content.import"), manifest);
    expect(again).toMatchObject({ created: [], updated: [] });
    expect(again.unchanged).toHaveLength(manifest.length);

    const changed = manifest.map((entry) =>
      entry.id === "img-snaplab-sample" ? { ...entry, altText: "A cartoon robot waving." } : entry,
    );
    expect((await upsertAssetsFromManifest(ctxFor(editor), changed)).updated).toEqual(["img-snaplab-sample"]);
    expect(
      (await getAssetsByKeys({ db }, ["img-snaplab-sample", "nope"])).get("img-snaplab-sample")?.altText,
    ).toBe("A cartoon robot waving.");
    expect((await listAssets(ctxFor(editor), { kind: "image" })).map((row) => row.key).sort()).toEqual([
      "img-snaplab-sample",
      "img-snaplab-trailer-poster",
    ]);

    const learner = await createLearner();
    expect((await appError(() => upsertAssetsFromManifest(ctxFor(learner.actor), manifest))).code).toBe(
      "forbidden",
    );
    expect((await appError(() => listAssets(ctxFor(learner.actor)))).code).toBe("forbidden");
  });
});
