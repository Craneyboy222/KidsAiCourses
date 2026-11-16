import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { systemCtx } from "@/server/context";
import { aiProcessor, auditLog } from "@/server/db";
import {
  approveProcessor,
  assertProcessorApproved,
  assertProcessorEnabled,
  isProcessorApproved,
  isProcessorEnabled,
  listProcessors,
  setProcessorEnabled,
} from "@/server/processors";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createParent, createStaff } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

const admin = async () => testCtx((await createStaff({ roles: ["admin"] })).actor);
const details = {
  providerKey: "acme-ai",
  name: "Acme AI",
  purpose: "Coach replies",
  region: "EU (Frankfurt)",
  dpaReference: "DPA-2026-014",
};

describe("processor register", () => {
  it("a provider cannot be enabled without approval and a DPA reference", async () => {
    const ctx = await admin();
    // Present in the register (say, seeded) but never approved.
    await db
      .insert(aiProcessor)
      .values({ providerKey: "acme-ai", name: "Acme AI", purpose: "Coach replies" });
    await expect(setProcessorEnabled(ctx, "acme-ai", true)).rejects.toMatchObject({
      code: "approval_required",
      status: 409,
    });
    expect(await isProcessorApproved(ctx, "acme-ai")).toBe(false);
    expect(await isProcessorEnabled(ctx, "acme-ai")).toBe(false);
    await expect(assertProcessorApproved(ctx, "acme-ai")).rejects.toMatchObject({
      code: "approval_required",
    });
    await expect(assertProcessorEnabled(ctx, "acme-ai")).rejects.toMatchObject({ code: "ai_unavailable" });
    expect((await db.select().from(aiProcessor))[0]?.enabled).toBe(false);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it("the database refuses it too, whatever the code does", async () => {
    await expect(
      db.insert(aiProcessor).values({ providerKey: "rogue", name: "Rogue", purpose: "x", enabled: true }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(aiProcessor)
        .values({ providerKey: "half", name: "Half", purpose: "x", enabled: true, approvedAt: new Date() }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(aiProcessor)
        .values({
          providerKey: "blank",
          name: "Blank",
          purpose: "x",
          enabled: true,
          approvedAt: new Date(),
          dpaReference: "   ",
        }),
    ).rejects.toThrow();
    await db
      .insert(aiProcessor)
      .values({
        providerKey: "fine",
        name: "Fine",
        purpose: "x",
        enabled: true,
        approvedAt: new Date(),
        dpaReference: "DPA-1",
      });
    await expect(db.update(aiProcessor).set({ dpaReference: null })).rejects.toThrow();
  });

  it("approve, then enable: two audited steps, and only then is it usable", async () => {
    const ctx = await admin();
    const approved = await approveProcessor(ctx, details);
    expect(approved).toMatchObject({
      ...details,
      approved: true,
      enabled: false,
      approvedBy: ctx.actor.userId,
    });
    expect(approved.approvedAt).toEqual(ctx.now);
    expect(await isProcessorApproved(ctx, "acme-ai")).toBe(true);
    // Approved is not the same as switched on.
    expect(await isProcessorEnabled(ctx, "acme-ai")).toBe(false);
    await expect(assertProcessorEnabled(ctx, "acme-ai")).rejects.toMatchObject({ code: "ai_unavailable" });

    const enabled = await setProcessorEnabled(ctx, "acme-ai", true);
    expect(enabled.enabled).toBe(true);
    await assertProcessorApproved(ctx, "acme-ai");
    await assertProcessorEnabled(ctx, "acme-ai");

    await setProcessorEnabled(ctx, "acme-ai", false, "Spend spike");
    expect(await isProcessorEnabled(ctx, "acme-ai")).toBe(false);

    const logs = await db.select().from(auditLog).orderBy(auditLog.createdAt);
    expect(logs.map((l) => l.action)).toEqual(["processor.approve", "processor.enable", "processor.disable"]);
    expect(logs[0]).toMatchObject({
      actorType: "staff",
      actorId: ctx.actor.userId,
      targetType: "ai_processor",
      targetId: "acme-ai",
      meta: { dpaReference: "DPA-2026-014", region: "EU (Frankfurt)" },
    });
    expect(logs[2]).toMatchObject({ reason: "Spend spike", meta: { from: true, to: false } });
  });

  it("approval needs every field, and a sensible key", async () => {
    const ctx = await admin();
    await expect(approveProcessor(ctx, { ...details, dpaReference: "  " })).rejects.toMatchObject({
      code: "invalid_input",
      fieldErrors: { dpaReference: expect.any(Array) },
    });
    await expect(approveProcessor(ctx, { ...details, region: "" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(approveProcessor(ctx, { ...details, providerKey: "Acme AI!" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(await db.select().from(aiProcessor)).toHaveLength(0);
  });

  it("only a named member of staff can approve or switch on; a job can only switch off", async () => {
    const job = systemCtx("ai.spend_guard");
    await expect(approveProcessor(job, details)).rejects.toMatchObject({ code: "forbidden" });
    const ctx = await admin();
    await approveProcessor(ctx, details);
    await expect(setProcessorEnabled(job, "acme-ai", true)).rejects.toMatchObject({ code: "forbidden" });
    await setProcessorEnabled(ctx, "acme-ai", true);
    expect((await setProcessorEnabled(job, "acme-ai", false, "Daily cap reached")).enabled).toBe(false);
    const logs = await db.select().from(auditLog);
    expect(logs.find((l) => l.action === "processor.disable")).toMatchObject({
      actorType: "system",
      actorLabel: "ai.spend_guard",
    });
  });

  it("is for admins: editors, parents and the public are refused", async () => {
    const editor = testCtx((await createStaff({ roles: ["editor"] })).actor);
    const parent = testCtx((await createParent()).actor);
    for (const ctx of [editor, parent]) {
      await expect(approveProcessor(ctx, details)).rejects.toMatchObject({ code: "forbidden" });
      await expect(setProcessorEnabled(ctx, "acme-ai", false)).rejects.toMatchObject({ code: "forbidden" });
      await expect(listProcessors(ctx)).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(listProcessors(testCtx())).rejects.toMatchObject({ code: "unauthenticated" });
    // Staff without a second factor cannot either.
    const noSecondFactor = testCtx((await createStaff({ roles: ["admin"], twoFactorVerified: false })).actor);
    await expect(approveProcessor(noSecondFactor, details)).rejects.toMatchObject({
      code: "two_factor_required",
    });
  });

  it("re-approving updates the record and keeps it switched on or off as it was", async () => {
    const ctx = await admin();
    await approveProcessor(ctx, details);
    await setProcessorEnabled(ctx, "acme-ai", true);
    const updated = await approveProcessor(ctx, {
      ...details,
      dpaReference: "DPA-2027-001",
      notes: "Renewed",
    });
    expect(updated).toMatchObject({ dpaReference: "DPA-2027-001", enabled: true, notes: "Renewed" });
    expect(await db.select().from(aiProcessor)).toHaveLength(1);
  });

  it("lists the register, and says not found for a provider that is not in it", async () => {
    const ctx = await admin();
    await approveProcessor(ctx, details);
    await approveProcessor(ctx, {
      ...details,
      providerKey: "email.resend",
      name: "Resend",
      purpose: "Transactional email",
    });
    expect((await listProcessors(ctx)).map((p) => [p.providerKey, p.approved, p.enabled])).toEqual([
      ["acme-ai", true, false],
      ["email.resend", true, false],
    ]);
    await expect(setProcessorEnabled(ctx, "nobody", true)).rejects.toMatchObject({ code: "not_found" });
    expect(await isProcessorApproved(ctx, "nobody")).toBe(false);
  });
});
