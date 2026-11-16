/**
 * The same journey with the learning slice's REAL services in place of mocks: `startCourse` (which
 * runs the real learning gate over this slice's `checkStart`), `checkLearningAllowed`,
 * `recordEvidenceOutcome` and `getEnrolmentById`. Only contracts that are still placeholders are
 * mocked here (`getControls`, `canAccessCourse`, `openSafeguardingCase`).
 */
import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { certificate, enrolment, moderationItem, step, stepProgress } from "@/server/db";
import { issueCertificateIfEligible, listCertificates } from "@/server/services/certificate";
import { REQUIRED_CONSENT_KEYS } from "@/server/services/consent";
import { startCourse } from "@/server/services/enrolment";
import { canAccessCourse } from "@/server/services/entitlements";
import { decideModeration } from "@/server/services/moderation";
import { getControls } from "@/server/services/parent-controls";
import { listProjects } from "@/server/services/portfolio";
import { openSafeguardingCase } from "@/server/services/safeguarding";
import { addLinkEvidence, submitWork } from "@/server/services/submission";
import { decideToolApproval, requestToolApproval, revokeToolApproval } from "@/server/services/tool-approval";
import { db } from "../../helpers/db";
import { createConsentDefinition, recordConsent } from "../../helpers/factories";
import { appError } from "../content/helpers";
import { NO_CONTROLS, SELF_CHECK, SNAPCHAT, courseBySlug, family, publicResolver, resetTools, seedCourses, setTool, staffCtx, tearDownStorage, type TestFamily } from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/safeguarding", () => ({ openSafeguardingCase: vi.fn() }));

beforeAll(async () => {
  await seedCourses();
  for (const key of REQUIRED_CONSENT_KEYS) await createConsentDefinition({ key, required: true });
});
afterAll(tearDownStorage);
beforeEach(async () => {
  await resetTools();
  vi.mocked(getControls).mockResolvedValue(NO_CONTROLS);
  vi.mocked(canAccessCourse).mockResolvedValue(true);
  vi.mocked(openSafeguardingCase).mockResolvedValue({ caseId: "" });
});

async function consented(): Promise<TestFamily> {
  const who = await family({ nickname: "Maya" });
  for (const consentKey of REQUIRED_CONSENT_KEYS) await recordConsent({ learnerId: who.learnerId, familyId: who.familyId, consentKey, actorUserId: who.parent.actor.userId });
  return who;
}

/** Marks every step but the final hand-in as done, as the player would have by the time the learner gets there. */
async function finishEverythingButSubmit(enrolmentId: string, learnerId: string, versionId: string): Promise<string> {
  const steps = await db.select({ id: step.id, type: step.type }).from(step).where(eq(step.courseVersionId, versionId));
  const submit = steps.find((entry) => entry.type === "submit");
  if (!submit) throw new Error("no submit step");
  await db.insert(stepProgress).values(steps.filter((entry) => entry.id !== submit.id).map((entry) => ({ enrolmentId, learnerId, stepId: entry.id, status: "completed" as const, completedAt: new Date() })));
  return submit.id;
}

const CLEAN = { resolver: publicResolver, roll: () => 0.99 };
const SAMPLED = { resolver: publicResolver, roll: () => 0.01 };

describe("with the real learning services", () => {
  it("a tool needing consent blocks Start until a parent approves, and blocks again on revocation", async () => {
    const who = await consented();
    await setTool("replit", { under18Policy: "parent_consent_required" });

    const refused = await appError(() => startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT }));
    expect(refused.code).toBe("parent_approval_required");
    expect(refused.message).toContain("Replit");
    expect(await db.select().from(enrolment).where(eq(enrolment.learnerId, who.learnerId))).toHaveLength(0);

    const target = await courseBySlug(SNAPCHAT);
    const request = await requestToolApproval(who.learner, { learnerId: who.learnerId, courseId: target.id, toolSlug: "replit" });
    await decideToolApproval(who.parent, request.id, "approve");
    const started = await startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT });
    expect(started.created).toBe(true);

    const submitStepId = await finishEverythingButSubmit(started.enrolment.id, who.learnerId, started.enrolment.courseVersionId);
    await revokeToolApproval(who.parent, request.id);
    const link = { enrolmentId: started.enrolment.id, stepId: submitStepId, url: "https://replit.com/@maya/app", declaredNoPeople: true };
    expect((await appError(() => addLinkEvidence(who.learner, link, CLEAN))).code).toBe("parent_approval_required");
  });

  it("a blocked main tool with an approved fallback still lets the learner start", async () => {
    const who = await consented();
    await setTool("replit", { status: "blocked" });
    await expect(startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT })).resolves.toMatchObject({ created: true });
  });

  it("a clean hand-in completes the course and issues the certificate in one go", async () => {
    const who = await consented();
    const started = await startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT });
    const submitStepId = await finishEverythingButSubmit(started.enrolment.id, who.learnerId, started.enrolment.courseVersionId);
    await addLinkEvidence(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, url: "https://replit.com/@maya/app", declaredNoPeople: true }, CLEAN);

    const result = await submitWork(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, selfCheck: SELF_CHECK }, CLEAN);
    expect(result.status).toBe("accepted");
    expect(result.certificateId).not.toBeNull();

    const [row] = await db.select().from(enrolment).where(eq(enrolment.id, started.enrolment.id));
    expect(row?.status).toBe("completed");
    const [progress] = await db.select().from(stepProgress).where(and(eq(stepProgress.enrolmentId, started.enrolment.id), eq(stepProgress.stepId, submitStepId)));
    expect(progress).toMatchObject({ status: "completed", data: { evidence: "accepted" } });
    expect((await listCertificates(who.parent, who.learnerId)).map((entry) => entry.displayName)).toEqual(["Maya"]);
    expect((await listProjects(who.parent, who.learnerId)).map((entry) => entry.status)).toEqual(["accepted"]);
  });

  it("a sampled hand-in completes the course but issues no certificate until a person accepts it (D4)", async () => {
    const who = await consented();
    const started = await startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT });
    const submitStepId = await finishEverythingButSubmit(started.enrolment.id, who.learnerId, started.enrolment.courseVersionId);
    await addLinkEvidence(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, url: "https://replit.com/@maya/app", declaredNoPeople: true }, CLEAN);

    const result = await submitWork(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, selfCheck: SELF_CHECK }, SAMPLED);
    expect(result).toMatchObject({ status: "awaiting_review", certificateId: null });
    // Every step is done, so the course itself is complete...
    expect((await db.select().from(enrolment).where(eq(enrolment.id, started.enrolment.id)))[0]?.status).toBe("completed");
    // ...and still nothing is issued, whoever asks, and nothing shows for the parent.
    expect(await issueCertificateIfEligible(who.learner, started.enrolment.id)).toBeNull();
    expect(await issueCertificateIfEligible(who.parent, started.enrolment.id)).toBeNull();
    expect(await db.select().from(certificate).where(eq(certificate.enrolmentId, started.enrolment.id))).toHaveLength(0);
    expect(await listProjects(who.parent, who.learnerId)).toEqual([]);

    const [queued] = await db.select().from(moderationItem).where(and(eq(moderationItem.learnerId, who.learnerId), eq(moderationItem.state, "pending")));
    await decideModeration(await staffCtx("moderator"), queued?.id ?? "", { verdict: "approve" });
    expect(await db.select().from(certificate).where(eq(certificate.enrolmentId, started.enrolment.id))).toHaveLength(1);
    expect((await listProjects(who.parent, who.learnerId)).map((entry) => entry.status)).toEqual(["accepted"]);
  });

  it("work sent back reopens the step and the course, and another family's parent cannot trigger a certificate", async () => {
    const who = await consented();
    const other = await consented();
    const started = await startCourse(who.learner, { learnerId: who.learnerId, courseSlug: SNAPCHAT });
    const submitStepId = await finishEverythingButSubmit(started.enrolment.id, who.learnerId, started.enrolment.courseVersionId);
    await addLinkEvidence(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, url: "https://replit.com/@maya/app", declaredNoPeople: true }, CLEAN);
    await submitWork(who.learner, { enrolmentId: started.enrolment.id, stepId: submitStepId, selfCheck: SELF_CHECK }, SAMPLED);
    expect(await issueCertificateIfEligible(other.parent, started.enrolment.id)).toBeNull();
    expect(await issueCertificateIfEligible(other.learner, started.enrolment.id)).toBeNull();

    const [queued] = await db.select().from(moderationItem).where(and(eq(moderationItem.learnerId, who.learnerId), eq(moderationItem.state, "pending")));
    await decideModeration(await staffCtx("moderator"), queued?.id ?? "", { verdict: "block", note: "The link opens someone else's project. Please share your own." });
    expect((await db.select().from(enrolment).where(eq(enrolment.id, started.enrolment.id)))[0]?.status).toBe("active");
    const [progress] = await db.select().from(stepProgress).where(and(eq(stepProgress.enrolmentId, started.enrolment.id), eq(stepProgress.stepId, submitStepId)));
    expect(progress?.status).not.toBe("completed");
    expect(await db.select().from(stepProgress).where(and(eq(stepProgress.enrolmentId, started.enrolment.id), ne(stepProgress.status, "completed")))).toHaveLength(1);
    expect(await issueCertificateIfEligible(who.learner, started.enrolment.id)).toBeNull();
  });
});
