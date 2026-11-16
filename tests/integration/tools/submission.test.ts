import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { artefact, auditLog, certificate, moderationEvent, moderationItem, project, projectVersion, step } from "@/server/db";
import { sha256 } from "@/server/crypto";
import { getCertificatePdf, issueCertificateIfEligible, issueOutstandingCertificates, listCertificates, revokeCertificate, setCertificateName, verifyCertificate } from "@/server/services/certificate";
import { decideModeration, getModerationItem, listModerationItems } from "@/server/services/moderation";
import { FIXTURE_MARKERS, manualDetector, setPeopleDetector } from "@/server/services/people-detection";
import { getArtefactDownload, getProject, listProjects } from "@/server/services/portfolio";
import { ABANDONED_UPLOAD_HOURS, PEOPLE_REJECTED_MESSAGE, addLinkEvidence, cleanUpAbandonedUploads, completeUpload, getSubmissionState, removeEvidence, requestUpload, submitWork } from "@/server/services/submission";
import { setSetting } from "@/server/settings";
import { getStorage } from "@/server/storage";
import { exeBytes, jpegWithExif, mp4WithLocation, pdfBytes, pngWithText, withMarker } from "../../unit/tools/fixtures";
import { db, testCtx } from "../../helpers/db";
import { appError } from "../content/helpers";
import {
  HOMEWORK,
  MUSIC_VIDEO,
  SELF_CHECK,
  SNAPCHAT,
  artefactRow,
  cases,
  enrol,
  family,
  outcomes,
  privateResolver,
  publicResolver,
  resetTools,
  seedCourses,
  setEnrolmentStatus,
  setLearning,
  staffCtx,
  tearDownStorage,
  upload,
  useToolMocks,
  type Enrolled,
  type TestFamily,
} from "./helpers";

vi.mock("@/server/services/entitlements", async (original) => ({ ...(await original<typeof import("@/server/services/entitlements")>()), canAccessCourse: vi.fn() }));
vi.mock("@/server/services/parent-controls", () => ({ getControls: vi.fn() }));
vi.mock("@/server/services/safeguarding", () => ({ openSafeguardingCase: vi.fn() }));
vi.mock("@/server/services/usage", () => ({ checkLearningAllowed: vi.fn() }));
vi.mock("@/server/services/enrolment", () => ({ recordEvidenceOutcome: vi.fn(), getEnrolmentById: vi.fn() }));

const owner = () => staffCtx("super_admin");
const setting = async (key: Parameters<typeof setSetting>[1], value: unknown) => setSetting(await owner(), key, value as never, "test");

beforeAll(seedCourses);
afterAll(tearDownStorage);
beforeEach(async () => {
  useToolMocks();
  await resetTools();
  await setting("moderation.auto_accept_clean_submissions", true);
  await setting("moderation.sample_rate", 0.1);
  await setting("uploads.max_mb", { screenshot: 10, file: 25, video: 200 });
});

/** Never sampled, and a DNS answer that is public. */
const CLEAN = { resolver: publicResolver, roll: () => 0.99 };
const SAMPLED = { resolver: publicResolver, roll: () => 0.01 };
const REPLIT_LINK = "https://replit.com/@maya/snap-app";

async function linkOnly(who: TestFamily, where: Enrolled, url = REPLIT_LINK) {
  return addLinkEvidence(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, url, declaredNoPeople: true }, CLEAN);
}
const submit = (who: TestFamily, where: Enrolled, deps = CLEAN, extra: { title?: string; note?: string } = {}) =>
  submitWork(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, selfCheck: SELF_CHECK, ...extra }, deps);
const pendingItems = async (subjectId: string) => db.select().from(moderationItem).where(and(eq(moderationItem.subjectId, subjectId), eq(moderationItem.state, "pending")));
const currentVersion = async (projectId: string) => {
  const [mine] = await db.select().from(project).where(eq(project.id, projectId));
  const [version] = await db.select().from(projectVersion).where(eq(projectVersion.id, mine?.currentVersionId ?? ""));
  if (!mine || !version) throw new Error("no current version");
  return { project: mine, version };
};

describe("a clean link", () => {
  it("is accepted without a person, appears in the portfolio, and the certificate follows course completion", async () => {
    const who = await family({ nickname: "Maya" });
    const where = await enrol(who.learnerId, SNAPCHAT);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const item = await linkOnly(who, where);
    expect(item).toMatchObject({ kind: "link", url: REPLIT_LINK, state: "ready", hasFile: false, linkTool: { slug: "replit" } });
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId })).status).toBe("draft");

    const result = await submit(who, where, CLEAN, { note: "I used Replit's AI helper for the chat replies." });
    expect(result).toMatchObject({ status: "accepted", version: 1, certificateId: null, showCrisisScript: false });
    // We never open the link: not to check it, not to preview it.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const { project: mine, version } = await currentVersion(result.projectId);
    expect(mine).toMatchObject({ status: "accepted", visibility: "private" });
    expect(version).toMatchObject({ moderationState: "approved", sampled: false, decidedBy: null, selfCheck: SELF_CHECK, note: "I used Replit's AI helper for the chat replies." });
    expect(version.autoChecks).toMatchObject({ outcome: "accept", reasons: [] });
    expect(await pendingItems(version.id)).toHaveLength(0);
    expect(outcomes.map((call) => call.outcome)).toEqual(["submitted", "accepted"]);

    const state = await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId });
    expect(state).toMatchObject({ status: "accepted", items: [], selfCheck: SELF_CHECK });
    expect(state.submitted?.items.map((entry) => entry.state)).toEqual(["accepted"]);

    // In the portfolio for the learner and for their parent.
    expect((await listProjects(who.learner, who.learnerId)).map((entry) => [entry.status, entry.artefactCount])).toEqual([["accepted", 1]]);
    expect((await listProjects(who.parent, who.learnerId)).map((entry) => entry.id)).toEqual([result.projectId]);
    const detail = await getProject(who.parent, result.projectId);
    expect(detail).toMatchObject({ status: "accepted", mine: false, note: null, versions: [] });
    expect(detail?.brief?.deliverables.length).toBeGreaterThan(0);
    expect(detail?.rubric.map((entry) => entry.answer)).toEqual(["Nailed it", "Getting there", "Not yet", "Nailed it"]);
    expect((await getProject(who.learner, result.projectId))?.note).toBe("I used Replit's AI helper for the chat replies.");

    // Accepted, but the course is not finished: no certificate yet.
    expect(await issueCertificateIfEligible(who.learner, where.enrolmentId)).toBeNull();
    expect(await issueOutstandingCertificates(who.learner, who.learnerId)).toEqual([]);
    await setEnrolmentStatus(where.enrolmentId, "completed");
    // The catch-up issues it the next time the learner (or their parent) looks, and only once.
    const stranger = await family();
    expect((await appError(() => issueOutstandingCertificates(stranger.learner, who.learnerId))).code).toBe("forbidden");
    const [caughtUp] = await issueOutstandingCertificates(who.learner, who.learnerId);
    expect(caughtUp).toMatchObject({ learnerId: who.learnerId, displayName: "Maya" });
    expect(await issueOutstandingCertificates(who.parent, who.learnerId)).toEqual([]);
    const issued = await issueCertificateIfEligible(who.learner, where.enrolmentId);
    expect(issued?.id).toBe(caughtUp?.id);
    expect(issued).toMatchObject({ learnerId: who.learnerId, displayName: "Maya", revokedAt: null });
    expect(issued?.verifyCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    // Idempotent: asking again returns the same certificate.
    expect((await issueCertificateIfEligible(who.learner, where.enrolmentId))?.id).toBe(issued?.id);
    expect(await db.select().from(certificate).where(eq(certificate.enrolmentId, where.enrolmentId))).toHaveLength(1);
  });

  it("issues the certificate at once when the course was already complete", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    await linkOnly(who, where);
    const result = await submit(who, where);
    expect(result.status).toBe("accepted");
    expect(result.certificateId).not.toBeNull();
    expect((await getProject(who.learner, result.projectId))?.certificateId).toBe(result.certificateId);
  });

  it("cannot be changed or sent again once accepted", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    await submit(who, where);
    expect((await appError(() => linkOnly(who, where, "https://replit.com/@maya/other"))).code).toBe("conflict");
    expect((await appError(() => submit(who, where))).code).toBe("conflict");
  });
});

describe("link rules", () => {
  it("refuses unsafe links and a missing declaration, and stores nothing", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const add = (url: string, declaredNoPeople = true, resolver = publicResolver) => addLinkEvidence(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, url, declaredNoPeople }, { resolver });

    expect((await appError(() => add("http://replit.com/@maya/app"))).code).toBe("unsafe_url");
    expect((await appError(() => add("https://127.0.0.1/app"))).code).toBe("unsafe_url");
    expect((await appError(() => add("https://replit.com/app?token=abc"))).code).toBe("unsafe_url");
    // A public-looking name that resolves to a private address.
    expect((await appError(() => add("https://sneaky.example.com/app", true, privateResolver))).code).toBe("unsafe_url");
    const undeclared = await appError(() => add(REPLIT_LINK, false));
    expect(undeclared.code).toBe("invalid_input");
    expect(undeclared.fieldErrors).toHaveProperty("declaredNoPeople");
    expect(await db.select().from(artefact).where(eq(artefact.enrolmentId, where.enrolmentId))).toHaveLength(0);
  });

  it("records the learner's declaration and the same link is not added twice", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const first = await linkOnly(who, where);
    const second = await linkOnly(who, where);
    expect(second.id).toBe(first.id);
    expect(await artefactRow(first.id)).toMatchObject({ kind: "link", peopleCheck: "declared_no_people", peopleCheckProvider: "declaration", storageKey: null, url: REPLIT_LINK });
  });

  it("holds a link that is not to one of the course's Register tools for a person to check", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const item = await linkOnly(who, where, "https://example.org/my-project");
    expect(item.linkTool).toBeNull();
    const result = await submit(who, where);
    expect(result.status).toBe("awaiting_review");
    const { version } = await currentVersion(result.projectId);
    expect(version.autoChecks).toMatchObject({ outcome: "hold", reasons: ["link_off_register"] });
    expect((await pendingItems(version.id))[0]).toMatchObject({ source: "auto", severity: "normal" });
  });

  it("requires the step's own tool where the step names one", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await db.update(step).set({ toolSlug: "replit" }).where(eq(step.id, where.submitStepId));
    try {
      const wrong = await appError(() => linkOnly(who, where, "https://www.canva.com/design/abc"));
      expect(wrong.code).toBe("unsafe_url");
      expect(wrong.message).toContain("Replit");
      await expect(linkOnly(who, where, "https://base44.com/apps/maya")).resolves.toMatchObject({ linkTool: { slug: "base44" } });
      await expect(linkOnly(who, where)).resolves.toMatchObject({ linkTool: { slug: "replit" } });
    } finally {
      await db.update(step).set({ toolSlug: null }).where(eq(step.id, where.submitStepId));
    }
  });

  it("does not take a kind of evidence the step does not ask for", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, "prompt-gym-from-vague-to-laser-sharp"); // file and screenshot only
    expect((await appError(() => addLinkEvidence(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, url: "https://chatgpt.com/share/abc", declaredNoPeople: true }, CLEAN))).code).toBe("invalid_input");
    const other = await family();
    const mine = await enrol(other.learnerId, SNAPCHAT); // link and screenshot only
    expect((await appError(() => requestUpload(other.learner, { enrolmentId: mine.enrolmentId, stepId: mine.submitStepId, kind: "video", contentType: "video/mp4", sizeBytes: 1000 }))).code).toBe("invalid_input");
    expect((await appError(() => requestUpload(other.learner, { enrolmentId: mine.enrolmentId, stepId: mine.submitStepId, kind: "link", contentType: "text/plain", sizeBytes: 10 }))).code).toBe("invalid_input");
  });
});

describe("uploads", () => {
  it("an image waits for a human under the manual detector, stored private with its metadata removed (D3)", async () => {
    setPeopleDetector(manualDetector);
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    const original = pngWithText("GPS 51.5007,-0.1246");
    const id = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: original });

    const item = await completeUpload(who.learner, { artefactId: id });
    expect(item).toMatchObject({ kind: "screenshot", state: "ready", hasFile: true, mime: "image/png" });
    const row = await artefactRow(id);
    expect(row).toMatchObject({ peopleCheck: "needs_human", peopleCheckProvider: "manual", moderationState: "pending", sha256: sha256(original), quarantined: false });
    // Our own key, never the file's name; the pending object is gone.
    expect(row?.storageKey).toBe(`evidence/${who.learnerId}/${id}.png`);
    expect(await getStorage("private").exists(`evidence/pending/${who.learnerId}/${id}`)).toBe(false);
    const stored = await getStorage("private").get(row?.storageKey ?? "");
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.body.includes("GPS 51.5007")).toBe(false);
    expect(stored?.body.length).toBe(row?.sizeBytes);

    await linkOnly(who, where);
    const result = await submit(who, where);
    expect(result).toMatchObject({ status: "awaiting_review", certificateId: null });
    const { version } = await currentVersion(result.projectId);
    expect(version).toMatchObject({ moderationState: "pending", sampled: false });
    expect(version.autoChecks).toMatchObject({ outcome: "hold", reasons: ["people_check_needed"] });

    const [queued] = await pendingItems(version.id);
    expect(queued).toMatchObject({ source: "auto", severity: "normal", subjectType: "project_version", learnerId: who.learnerId });
    expect(queued?.dueAt?.getTime()).toBeGreaterThan(Date.now());
    expect(outcomes.map((call) => call.outcome)).toEqual(["submitted"]);

    // The learner sees "awaiting review". Nobody else sees anything, and no certificate is issued.
    expect((await listProjects(who.learner, who.learnerId)).map((entry) => entry.status)).toEqual(["awaiting_review"]);
    expect(await listProjects(who.parent, who.learnerId)).toEqual([]);
    expect(await getProject(who.parent, result.projectId)).toBeNull();
    expect((await appError(() => getArtefactDownload(who.parent, id))).code).toBe("not_found");
    expect(await issueCertificateIfEligible(who.learner, where.enrolmentId)).toBeNull();
    expect(await listCertificates(who.parent, who.learnerId)).toEqual([]);
    await expect(getArtefactDownload(who.learner, id)).resolves.toMatchObject({ expiresInSec: 120 });

    // A moderator looks at the file (logged), then accepts.
    const moderator = await staffCtx("moderator");
    await getArtefactDownload(moderator, id);
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, "artefact.download"), eq(auditLog.targetId, id)))).length).toBe(1);
    const decided = await decideModeration(moderator, queued?.id ?? "", { verdict: "approve" });
    expect(decided).toMatchObject({ state: "approved", subjectType: "submission" });

    expect((await listProjects(who.parent, who.learnerId)).map((entry) => [entry.status, entry.artefactCount])).toEqual([["accepted", 2]]);
    await expect(getArtefactDownload(who.parent, id)).resolves.toHaveProperty("url");
    const [issued] = await listCertificates(who.parent, who.learnerId);
    expect(issued).toBeDefined();
    expect(outcomes.map((call) => call.outcome)).toEqual(["submitted", "accepted"]);
  });

  it("a video is treated the same way, with its location metadata blanked", async () => {
    setPeopleDetector(manualDetector);
    const who = await family();
    const where = await enrol(who.learnerId, MUSIC_VIDEO);
    const id = await upload(who.learner, where, { kind: "video", contentType: "video/mp4", bytes: mp4WithLocation("+51.5007-000.1246/") });
    await completeUpload(who.learner, { artefactId: id });
    const row = await artefactRow(id);
    expect(row).toMatchObject({ peopleCheck: "needs_human", mime: "video/mp4" });
    const stored = await getStorage("private").get(row?.storageKey ?? "");
    expect(stored?.body.toString("latin1")).not.toContain("udta");
    expect((await submit(who, where)).status).toBe("awaiting_review");
  });

  it("the fixture detector rejects an image showing a person and deletes it at once, keeping the hash and metadata", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const bytes = withMarker(pngWithText(), FIXTURE_MARKERS.people);
    const id = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes });

    const item = await completeUpload(who.learner, { artefactId: id });
    expect(item).toMatchObject({ state: "rejected", hasFile: false, message: PEOPLE_REJECTED_MESSAGE });
    expect(item.message).toMatch(/sample image, a cartoon or an object/);

    const row = await artefactRow(id);
    expect(row).toMatchObject({ storageKey: null, moderationState: "blocked", peopleCheck: "people_suspected", peopleCheckProvider: "fixture", sha256: sha256(bytes), sizeBytes: bytes.length, mime: "image/png", quarantined: false });
    expect(row?.deletedFromStorageAt).not.toBeNull();
    const storage = getStorage("private");
    expect(await storage.exists(`evidence/pending/${who.learnerId}/${id}`)).toBe(false);
    expect(await storage.exists(`evidence/${who.learnerId}/${id}.png`)).toBe(false);
    expect((await appError(() => getArtefactDownload(who.learner, id))).code).toBe("not_found");
    expect(await db.select().from(moderationEvent).where(and(eq(moderationEvent.subjectId, id), eq(moderationEvent.verdict, "blocked")))).toHaveLength(1);
    expect(cases).toHaveLength(0);

    // It is not evidence: there is nothing to hand in.
    expect((await appError(() => submit(who, where))).code).toBe("invalid_input");

    // The same file again is recognised by its hash, whatever detector is running.
    setPeopleDetector(manualDetector);
    const again = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes });
    expect(await completeUpload(who.learner, { artefactId: again })).toMatchObject({ state: "rejected" });
    expect(await artefactRow(again)).toMatchObject({ peopleCheckProvider: "hash-match", storageKey: null });

    // The learner clears the rejected items from view; the records stay.
    await removeEvidence(who.learner, { artefactId: id });
    await removeEvidence(who.learner, { artefactId: again });
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId })).items).toEqual([]);
    expect(await artefactRow(id)).toMatchObject({ sha256: sha256(bytes), stepId: null });
  });

  it("an image the fixture detector clears can be accepted without a person", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const id = await upload(who.learner, where, { kind: "screenshot", contentType: "image/jpeg", bytes: jpegWithExif() });
    expect(await completeUpload(who.learner, { artefactId: id })).toMatchObject({ state: "ready", mime: "image/jpeg" });
    expect(await artefactRow(id)).toMatchObject({ peopleCheck: "clear" });
    expect((await submit(who, where)).status).toBe("accepted");
  });

  it("quarantines possibly illegal media, does not delete it, and opens a critical safeguarding case", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const bytes = withMarker(pngWithText(), FIXTURE_MARKERS.illegal);
    const id = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes });

    const refused = await appError(() => completeUpload(who.learner, { artefactId: id }));
    expect(refused.code).toBe("upload_rejected");
    expect(refused.message).not.toMatch(/illegal|police|crime/i);

    const row = await artefactRow(id);
    expect(row).toMatchObject({ quarantined: true, moderationState: "escalated", storageKey: `quarantine/${id}`, sha256: sha256(bytes) });
    expect(row?.deletedFromStorageAt).toBeNull();
    // Kept exactly as it arrived.
    expect((await getStorage("private").get(`quarantine/${id}`))?.body.equals(bytes)).toBe(true);
    expect(cases).toEqual([expect.objectContaining({ severity: "critical", trigger: "illegal_content", learnerId: who.learnerId, sourceType: "artefact", sourceId: id })]);
    expect(cases[0]?.summary).not.toContain(who.learnerId);

    // Out of everyone's reach through the app, staff included.
    for (const ctx of [who.learner, who.parent, await staffCtx("moderator"), await staffCtx("dsl"), await owner()]) {
      expect((await appError(() => getArtefactDownload(ctx, id))).code).toBe("not_found");
    }
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId })).items).toEqual([]);
    expect((await appError(() => removeEvidence(who.learner, { artefactId: id }))).code).toBe("not_found");
  });

  it("checks the real type against the declared type, and the size limit from settings", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, HOMEWORK);
    const storage = getStorage("private");

    // A JPEG declared as a PNG.
    const mismatch = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: jpegWithExif() });
    expect((await appError(() => completeUpload(who.learner, { artefactId: mismatch }))).code).toBe("upload_rejected");
    expect(await artefactRow(mismatch)).toBeNull();
    expect(await storage.exists(`evidence/pending/${who.learnerId}/${mismatch}`)).toBe(false);

    // A program declared as a PDF.
    const program = await upload(who.learner, where, { kind: "file", contentType: "application/pdf", bytes: exeBytes() });
    expect((await appError(() => completeUpload(who.learner, { artefactId: program }))).code).toBe("upload_rejected");
    expect(await artefactRow(program)).toBeNull();

    // The declared type and size are checked before a link is handed out at all.
    const ask = (kind: string, contentType: string, sizeBytes: number) => requestUpload(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, kind, contentType, sizeBytes });
    expect((await appError(() => ask("screenshot", "image/svg+xml", 1000))).code).toBe("upload_rejected");
    expect((await appError(() => ask("file", "application/zip", 1000))).code).toBe("upload_rejected");
    expect((await appError(() => ask("screenshot", "image/png", 11 * 1024 * 1024))).code).toBe("upload_rejected");
    await setting("uploads.max_mb", { screenshot: 1, file: 25, video: 200 });
    expect((await appError(() => ask("screenshot", "image/png", 2 * 1024 * 1024))).code).toBe("upload_rejected");

    // More bytes than were declared and allowed: caught when the upload completes.
    await setting("uploads.max_mb", { screenshot: 0.0001, file: 25, video: 200 });
    const tiny = await requestUpload(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, kind: "screenshot", contentType: "image/png", sizeBytes: 50 });
    await storage.put(`evidence/pending/${who.learnerId}/${tiny.artefactId}`, pngWithText(), { contentType: "image/png" });
    expect((await appError(() => completeUpload(who.learner, { artefactId: tiny.artefactId }))).code).toBe("upload_rejected");
    expect(await storage.exists(`evidence/pending/${who.learnerId}/${tiny.artefactId}`)).toBe(false);
  });

  it("a document can be accepted without a person, and is downloaded under our name by short-lived link", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, HOMEWORK);
    const id = await upload(who.learner, where, { kind: "file", contentType: "application/pdf", bytes: pdfBytes() });
    expect(await completeUpload(who.learner, { artefactId: id })).toMatchObject({ state: "ready", mime: "application/pdf" });
    expect(await artefactRow(id)).toMatchObject({ peopleCheck: "not_applicable" });
    expect((await submit(who, where)).status).toBe("accepted");

    const link = await getArtefactDownload(who.parent, id);
    const url = new URL(link.url);
    expect(link.expiresInSec).toBeLessThanOrEqual(300);
    expect(url.searchParams.get("name")).toBe(`evidence-${id.slice(0, 8)}.pdf`);
    expect(Number(url.searchParams.get("exp")) * 1000 - Date.now()).toBeLessThanOrEqual(121_000);
  });

  it("cannot complete somebody else's upload, or the same upload twice", async () => {
    const who = await family();
    const other = await family();
    const where = await enrol(who.learnerId, HOMEWORK);
    const id = await upload(who.learner, where, { kind: "file", contentType: "application/pdf", bytes: pdfBytes() });
    expect((await appError(() => completeUpload(other.learner, { artefactId: id }))).code).toBe("not_found");
    expect((await appError(() => completeUpload(who.parent, { artefactId: id }))).code).toBe("not_found");
    await completeUpload(who.learner, { artefactId: id });
    expect((await appError(() => completeUpload(who.learner, { artefactId: id }))).code).toBe("conflict");
  });

  it("tidies away upload links that were never used", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, HOMEWORK);
    const abandoned = await upload(who.learner, where, { kind: "file", contentType: "application/pdf", bytes: pdfBytes() });
    const finished = await upload(who.learner, where, { kind: "file", contentType: "application/pdf", bytes: pdfBytes() });
    await completeUpload(who.learner, { artefactId: finished });

    expect(await cleanUpAbandonedUploads({ db, now: new Date() })).toEqual({ removed: 0 });
    const later = new Date(Date.now() + (ABANDONED_UPLOAD_HOURS + 1) * 60 * 60 * 1000);
    expect(await cleanUpAbandonedUploads({ db, now: later })).toEqual({ removed: 1 });
    expect(await artefactRow(abandoned)).toBeNull();
    expect(await getStorage("private").exists(`evidence/pending/${who.learnerId}/${abandoned}`)).toBe(false);
    expect(await artefactRow(finished)).not.toBeNull();
  });
});

describe("the review sample (D4)", () => {
  it("holds a sampled submission: not accepted, not in the portfolio, no certificate, until a person reviews it", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    await linkOnly(who, where);
    const result = await submit(who, where, SAMPLED);
    expect(result).toMatchObject({ status: "awaiting_review", certificateId: null });

    const { project: mine, version } = await currentVersion(result.projectId);
    expect(mine.status).toBe("awaiting_review");
    expect(version).toMatchObject({ sampled: true, moderationState: "pending" });
    const [queued] = await pendingItems(version.id);
    expect(queued).toMatchObject({ source: "sample", severity: "normal" });

    expect(await listProjects(who.parent, who.learnerId)).toEqual([]);
    expect(await getProject(who.parent, result.projectId)).toBeNull();
    expect((await listProjects(who.learner, who.learnerId)).map((entry) => entry.status)).toEqual(["awaiting_review"]);
    // The course is complete, but the work has not been accepted.
    expect(await issueCertificateIfEligible(who.learner, where.enrolmentId)).toBeNull();
    expect(await issueCertificateIfEligible(testCtx({ type: "system", job: "test" }), where.enrolmentId)).toBeNull();
    expect(await db.select().from(certificate).where(eq(certificate.enrolmentId, where.enrolmentId))).toHaveLength(0);
    expect(outcomes.map((call) => call.outcome)).toEqual(["submitted"]);
    // It cannot be sent again or changed while it waits.
    expect((await appError(() => submit(who, where))).code).toBe("conflict");

    await decideModeration(await staffCtx("moderator"), queued?.id ?? "", { verdict: "approve" });
    expect((await listProjects(who.parent, who.learnerId)).map((entry) => entry.status)).toEqual(["accepted"]);
    expect(await db.select().from(certificate).where(eq(certificate.enrolmentId, where.enrolmentId))).toHaveLength(1);
    expect((await currentVersion(result.projectId)).version.decidedBy).not.toBeNull();
  });

  it("samples nothing at a rate of 0 and everything at a rate of 1", async () => {
    const one = await family();
    const first = await enrol(one.learnerId, SNAPCHAT);
    await setting("moderation.sample_rate", 0);
    await linkOnly(one, first);
    expect((await submit(one, first, SAMPLED)).status).toBe("accepted");

    const two = await family();
    const second = await enrol(two.learnerId, SNAPCHAT);
    await setting("moderation.sample_rate", 1);
    await linkOnly(two, second);
    expect((await submit(two, second, CLEAN)).status).toBe("awaiting_review");
  });

  it("holds every submission when auto-accept is switched off", async () => {
    await setting("moderation.auto_accept_clean_submissions", false);
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    const result = await submit(who, where);
    expect(result.status).toBe("awaiting_review");
    expect((await pendingItems((await currentVersion(result.projectId)).version.id))[0]).toMatchObject({ source: "submission" });
  });
});

describe("needs changes and resubmission", () => {
  it("sends work back with the reviewer's message, deletes the files, and keeps every version", async () => {
    setPeopleDetector(manualDetector);
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    const fileId = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: pngWithText() });
    await completeUpload(who.learner, { artefactId: fileId });
    await linkOnly(who, where);
    const first = await submit(who, where);
    const [queued] = await pendingItems((await currentVersion(first.projectId)).version.id);
    const moderator = await staffCtx("moderator");

    // A block needs a message for the learner.
    expect((await appError(() => decideModeration(moderator, queued?.id ?? "", { verdict: "block" }))).code).toBe("invalid_input");
    expect((await getModerationItem(moderator, queued?.id ?? ""))?.state).toBe("pending");

    const message = "Great start. Your screenshot shows a photo of a friend, so please retake it using the sample image.";
    await decideModeration(moderator, queued?.id ?? "", { verdict: "block", note: message });
    expect((await appError(() => decideModeration(moderator, queued?.id ?? "", { verdict: "approve" }))).code).toBe("conflict");

    const state = await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId });
    expect(state.status).toBe("needs_changes");
    expect(state.submitted?.message).toBe(message);
    expect((await getProject(who.learner, first.projectId))?.message).toBe(message);
    expect((await listProjects(who.learner, who.learnerId)).map((entry) => entry.status)).toEqual(["needs_changes"]);
    expect(await listProjects(who.parent, who.learnerId)).toEqual([]);
    expect(outcomes.map((call) => call.outcome)).toEqual(["submitted", "rejected"]);
    expect(await issueCertificateIfEligible(who.learner, where.enrolmentId)).toBeNull();

    // The rejected file is gone from storage; its record stays.
    const rejected = await artefactRow(fileId);
    expect(rejected).toMatchObject({ storageKey: null, moderationState: "blocked" });
    expect(rejected?.deletedFromStorageAt).not.toBeNull();
    expect(rejected?.sha256).not.toBeNull();
    expect(await getStorage("private").exists(`evidence/${who.learnerId}/${fileId}.png`)).toBe(false);

    // Second go: a new version; the first is kept.
    await linkOnly(who, where, "https://replit.com/@maya/snap-app-v2");
    const second = await submit(who, where);
    expect(second).toMatchObject({ projectId: first.projectId, version: 2, status: "accepted" });
    expect(second.certificateId).not.toBeNull();
    const versions = await db.select().from(projectVersion).where(eq(projectVersion.projectId, first.projectId));
    expect(versions.map((row) => [row.version, row.moderationState]).sort()).toEqual([[1, "blocked"], [2, "approved"]]);
    expect((await getProject(who.learner, first.projectId))?.versions.map((entry) => [entry.version, entry.state])).toEqual([[2, "accepted"], [1, "needs_changes"]]);
    expect((await getProject(who.parent, first.projectId))?.evidence.map((entry) => entry.url)).toEqual(["https://replit.com/@maya/snap-app-v2"]);
  });

  it("is decided by a named member of staff only, and every decision is audited", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    const result = await submit(who, where, SAMPLED);
    const [queued] = await pendingItems((await currentVersion(result.projectId)).version.id);
    const itemId = queued?.id ?? "";

    for (const ctx of [who.learner, who.parent, await staffCtx("editor"), await staffCtx("support"), testCtx({ type: "system", job: "auto" })]) {
      expect((await appError(() => decideModeration(ctx, itemId, { verdict: "approve" }))).code).toBe("forbidden");
      if (ctx.actor.type !== "system") expect((await appError(() => listModerationItems(ctx))).code).toBe("forbidden");
    }
    expect((await appError(() => decideModeration(testCtx(), itemId, { verdict: "approve" }))).code).toBe("unauthenticated");
    expect((await currentVersion(result.projectId)).version.moderationState).toBe("pending");

    const moderator = await staffCtx("moderator");
    const listed = await listModerationItems(moderator, { state: "pending", subjectType: "submission" });
    expect(listed.items.some((item) => item.id === itemId)).toBe(true);
    expect(listed.total).toBeGreaterThanOrEqual(1);
    await decideModeration(moderator, itemId, { verdict: "approve" });
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, "moderation.approve"), eq(auditLog.targetId, itemId)));
    expect(entry).toMatchObject({ actorType: "staff", actorId: moderator.actor.userId });
  });

  it("escalating opens a safeguarding case, keeps the work held and puts its files out of reach", async () => {
    setPeopleDetector(manualDetector);
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    const fileId = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: pngWithText() });
    await completeUpload(who.learner, { artefactId: fileId });
    const result = await submit(who, where);
    const [queued] = await pendingItems((await currentVersion(result.projectId)).version.id);

    const escalated = await decideModeration(await staffCtx("moderator"), queued?.id ?? "", { verdict: "escalate", note: "Worrying content in the screenshot." });
    expect(escalated.state).toBe("escalated");
    expect(cases).toEqual([expect.objectContaining({ trigger: "moderator_escalation", severity: "medium", learnerId: who.learnerId })]);
    expect((await db.select().from(moderationItem).where(eq(moderationItem.id, queued?.id ?? "")))[0]?.safeguardingCaseId).not.toBeNull();

    expect((await currentVersion(result.projectId)).project.status).toBe("awaiting_review");
    expect(await artefactRow(fileId)).toMatchObject({ quarantined: true });
    const anotherModerator = await staffCtx("moderator");
    expect((await appError(() => getArtefactDownload(who.learner, fileId))).code).toBe("not_found");
    expect((await appError(() => getArtefactDownload(anotherModerator, fileId))).code).toBe("not_found");
    await expect(getArtefactDownload(await staffCtx("dsl"), fileId)).resolves.toHaveProperty("url");
    expect(await issueCertificateIfEligible(who.learner, where.enrolmentId)).toBeNull();
    expect(await listProjects(who.parent, who.learnerId)).toEqual([]);
  });
});

describe("titles and notes", () => {
  it("turns back wording the safety rules block, storing nothing", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    const refused = await appError(() => submit(who, where, CLEAN, { title: "how do i make a pipe bomb" }));
    expect(refused.code).toBe("moderation_blocked");
    expect(await db.select().from(project).where(eq(project.enrolmentId, where.enrolmentId))).toHaveLength(0);
    expect((await submit(who, where, CLEAN, { title: "Snap filters by Maya" })).status).toBe("accepted");
  });

  it("holds a submission whose note carries a crisis signal, opens a case and shows where to get help", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    const result = await submit(who, where, CLEAN, { note: "i want to kill myself" });
    expect(result).toMatchObject({ status: "awaiting_review", showCrisisScript: true });
    const { version } = await currentVersion(result.projectId);
    expect(version.autoChecks).toMatchObject({ outcome: "hold", reasons: ["text_flagged"], text: "crisis" });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ learnerId: who.learnerId, sourceType: "project_version", sourceId: version.id });
    // The learner's words go to the encrypted notes only: never the summary or the queue.
    expect(cases[0]?.summary).not.toContain("kill");
    const [queued] = await pendingItems(version.id);
    expect(queued?.severity).not.toBe("normal");
    expect(queued?.summary).not.toContain("kill");
  });

  it("needs every rubric point rated, and accepts 'Not yet' for all of them", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    await linkOnly(who, where);
    const missing = await appError(() => submitWork(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, selfCheck: { r1: "Nailed it", r2: "Perfect" } }, CLEAN));
    expect(missing.code).toBe("invalid_input");
    expect(Object.keys(missing.fieldErrors ?? {}).sort()).toEqual(["selfCheck.r2", "selfCheck.r3", "selfCheck.r4"]);
    const honest = { r1: "Not yet", r2: "Not yet", r3: "Not yet", r4: "Not yet" };
    const result = await submitWork(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, selfCheck: honest }, CLEAN);
    expect(result.status).toBe("accepted");
    expect((await currentVersion(result.projectId)).version.selfCheck).toEqual(honest);
  });
});

describe("who can see what", () => {
  it("keeps one family's project and files from another family, another learner and the public", async () => {
    setPeopleDetector(undefined);
    const mine = await family();
    const other = await family();
    const where = await enrol(mine.learnerId, HOMEWORK);
    const fileId = await upload(mine.learner, where, { kind: "file", contentType: "application/pdf", bytes: pdfBytes() });
    await completeUpload(mine.learner, { artefactId: fileId });
    const result = await submit(mine, where);
    expect(result.status).toBe("accepted");

    for (const ctx of [other.parent, other.learner]) {
      expect((await appError(() => listProjects(ctx, mine.learnerId))).code).toBe("forbidden");
      expect(await getProject(ctx, result.projectId)).toBeNull();
      expect((await appError(() => getArtefactDownload(ctx, fileId))).code).toBe("not_found");
      expect((await appError(() => getSubmissionState(ctx, { enrolmentId: where.enrolmentId, stepId: where.submitStepId }))).code).toBe("not_found");
      expect((await appError(() => addLinkEvidence(ctx, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, url: "https://chatgpt.com/share/x", declaredNoPeople: true }, CLEAN))).code).toBe("not_found");
      expect((await appError(() => submitWork(ctx, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, selfCheck: SELF_CHECK }, CLEAN))).code).toBe("not_found");
      expect((await appError(() => removeEvidence(ctx, { artefactId: fileId }))).code).toBe("not_found");
      expect((await appError(() => listCertificates(ctx, mine.learnerId))).code).toBe("forbidden");
    }
    expect((await appError(() => listProjects(testCtx(), mine.learnerId))).code).toBe("unauthenticated");
    expect(await getProject(testCtx(), result.projectId)).toBeNull();
    expect((await appError(() => getArtefactDownload(testCtx(), fileId))).code).toBe("unauthenticated");
    // An editor is staff, but not someone who may open learners' work.
    const editor = await staffCtx("editor");
    expect((await appError(() => listProjects(editor, mine.learnerId))).code).toBe("forbidden");
    expect((await appError(() => getArtefactDownload(editor, fileId))).code).toBe("not_found");
    // A parent cannot hand in or change their child's work either.
    expect((await appError(() => submitWork(mine.parent, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, selfCheck: SELF_CHECK }, CLEAN))).code).toBe("not_found");
  });

  it("never offers a link as a download", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    const link = await linkOnly(who, where);
    await submit(who, where);
    expect((await appError(() => getArtefactDownload(who.learner, link.id))).code).toBe("not_found");
  });

  it("stops new evidence while learning is paused, capped or in quiet hours", async () => {
    const who = await family();
    const where = await enrol(who.learnerId, SNAPCHAT);
    setLearning({ allowed: false, reason: "quiet_hours", message: "It's quiet hours until 07:00." });
    expect((await appError(() => linkOnly(who, where))).code).toBe("quiet_hours");
    expect((await appError(() => requestUpload(who.learner, { enrolmentId: where.enrolmentId, stepId: where.submitStepId, kind: "screenshot", contentType: "image/png", sizeBytes: 100 }))).code).toBe("quiet_hours");
    setLearning({ allowed: false, reason: "paused", message: "Paused." });
    expect((await appError(() => submit(who, where))).code).toBe("paused");
  });
});

describe("a mid-course upload step", () => {
  async function withUploadStep(who: TestFamily) {
    const where = await enrol(who.learnerId, SNAPCHAT);
    const [submitStep] = await db.select().from(step).where(eq(step.id, where.submitStepId));
    if (!submitStep) throw new Error("no submit step");
    const key = `upload-${who.learnerId.slice(0, 8)}`;
    const [row] = await db.insert(step).values({ courseVersionId: where.versionId, lessonId: submitStep.lessonId, key, type: "upload", title: "Show your filters", position: 99, estimatedMinutes: 5, config: { evidence: ["screenshot", "link"], hint: "A screenshot of your three filters using the sample image." }, completionRule: "upload_approved" }).returning();
    if (!row) throw new Error("no upload step");
    return { where, stepId: row.id };
  }

  it("checks each piece of evidence as it arrives: a Register link is accepted, an image waits for a person", async () => {
    setPeopleDetector(manualDetector);
    const who = await family();
    const { where, stepId } = await withUploadStep(who);

    // The same bytes as a file a moderator escalated in an earlier test: that alone must not mark it as known-bad.
    const fileId = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: pngWithText(), stepId });
    expect(await completeUpload(who.learner, { artefactId: fileId }, CLEAN)).toMatchObject({ state: "awaiting_review" });
    expect(outcomes.map((call) => [call.stepId, call.outcome])).toEqual([[stepId, "submitted"]]);
    const [queued] = await pendingItems(fileId);
    expect(queued).toMatchObject({ subjectType: "artefact", source: "auto" });
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId })).status).toBe("awaiting_review");
    // Sent in means it cannot be withdrawn while it is with a reviewer.
    expect((await appError(() => removeEvidence(who.learner, { artefactId: fileId }))).code).toBe("conflict");

    await decideModeration(await staffCtx("moderator"), queued?.id ?? "", { verdict: "approve" });
    expect(outcomes.at(-1)).toMatchObject({ stepId, outcome: "accepted" });
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId })).status).toBe("accepted");
    // Not a project: nothing appears in the portfolio from an upload step.
    expect(await listProjects(who.learner, who.learnerId)).toEqual([]);
  });

  it("accepts a clean link straight away, and tells the learner kindly when a picture shows a person", async () => {
    const who = await family();
    const { where, stepId } = await withUploadStep(who);
    const rejectedId = await upload(who.learner, where, { kind: "screenshot", contentType: "image/png", bytes: withMarker(pngWithText("other"), FIXTURE_MARKERS.people), stepId });
    expect(await completeUpload(who.learner, { artefactId: rejectedId }, CLEAN)).toMatchObject({ state: "rejected", message: PEOPLE_REJECTED_MESSAGE });
    expect(outcomes.at(-1)).toMatchObject({ outcome: "rejected" });
    expect((await getSubmissionState(who.learner, { enrolmentId: where.enrolmentId, stepId })).status).toBe("needs_changes");

    const link = await addLinkEvidence(who.learner, { enrolmentId: where.enrolmentId, stepId, url: REPLIT_LINK, declaredNoPeople: true }, CLEAN);
    expect(link.state).toBe("accepted");
    expect(outcomes.at(-1)).toMatchObject({ outcome: "accepted" });
    expect((await appError(() => submitWork(who.learner, { enrolmentId: where.enrolmentId, stepId }, CLEAN))).code).toBe("invalid_input");
  });
});

describe("certificates", () => {
  async function certified(nickname = "Maya") {
    const who = await family({ nickname });
    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    await linkOnly(who, where);
    const result = await submit(who, where);
    const [issued] = await listCertificates(who.learner, who.learnerId);
    if (!issued || !result.certificateId) throw new Error("no certificate");
    return { who, where, issued };
  }

  it("the public check shows the name, course, date and revoked state, and nothing else", async () => {
    const { issued } = await certified("Maya");
    const found = await verifyCertificate(testCtx(), issued.verifyCode);
    expect(found).toEqual({ displayName: "Maya", courseTitle: issued.courseTitle, issuedAt: issued.issuedAt, revoked: false });
    expect(Object.keys(found ?? {}).sort()).toEqual(["courseTitle", "displayName", "issuedAt", "revoked"]);
    // Typed loosely: lower case, spaces, no dashes.
    expect(await verifyCertificate(testCtx(), ` ${issued.verifyCode.toLowerCase().replace(/-/g, " ")} `)).toMatchObject({ displayName: "Maya" });
  });

  it("gives the same nothing for an unknown, malformed or hostile code", async () => {
    await certified();
    for (const code of ["AAAA-BBBB-CCCC-DDDD", "", "x", "' OR 1=1 --", "%", "ABCD-EFGH-JKMN-PQR", "../../etc/passwd", "A".repeat(500)]) {
      expect(await verifyCertificate(testCtx(), code)).toBeNull();
    }
  });

  it("uses a first name only when the learner chooses it, on certificates issued afterwards", async () => {
    const who = await family({ nickname: "MJ" });
    expect((await appError(() => setCertificateName(who.learner, who.learnerId, { choice: "first_name", firstName: "Maya Patel" }))).code).toBe("invalid_input");
    expect((await appError(() => setCertificateName(who.learner, who.learnerId, { choice: "first_name", firstName: "maya@example.com" }))).code).toBe("invalid_input");
    expect((await appError(() => setCertificateName(who.parent, who.learnerId, { choice: "first_name", firstName: "Maya" }))).code).toBe("forbidden");
    await setCertificateName(who.learner, who.learnerId, { choice: "first_name", firstName: "Maya" });

    const where = await enrol(who.learnerId, SNAPCHAT, "completed");
    await linkOnly(who, where);
    await submit(who, where);
    const [issued] = await listCertificates(who.learner, who.learnerId);
    expect(issued?.displayName).toBe("Maya");
    // Changing the choice later does not rewrite a certificate already issued.
    await setCertificateName(who.learner, who.learnerId, { choice: "nickname" });
    expect((await listCertificates(who.learner, who.learnerId))[0]?.displayName).toBe("Maya");
  });

  it("makes a PDF for the learner and their parent, and for nobody outside the family", async () => {
    const { who, issued } = await certified();
    const other = await family();
    const pdf = await getCertificatePdf(who.learner, issued.id);
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(1000);
    expect(pdf.fileName).toBe("certificate.pdf");
    await expect(getCertificatePdf(who.parent, issued.id)).resolves.toHaveProperty("bytes");
    expect((await appError(() => getCertificatePdf(other.parent, issued.id))).code).toBe("not_found");
    expect((await appError(() => getCertificatePdf(other.learner, issued.id))).code).toBe("not_found");
    expect((await appError(() => getCertificatePdf(testCtx(), issued.id))).code).toBe("unauthenticated");
    expect((await appError(() => getCertificatePdf(who.learner, "not-an-id"))).code).toBe("not_found");
  });

  it("can be revoked by authorised staff with a reason; the public check then says so and the PDF is refused", async () => {
    const { who, issued } = await certified();
    const moderator = await staffCtx("moderator");
    for (const ctx of [who.learner, who.parent, await staffCtx("editor"), testCtx({ type: "system", job: "auto" })]) {
      expect((await appError(() => revokeCertificate(ctx, issued.id, "Not their own work"))).code).toBe("forbidden");
    }
    expect((await appError(() => revokeCertificate(moderator, issued.id, "  "))).code).toBe("invalid_input");
    expect((await verifyCertificate(testCtx(), issued.verifyCode))?.revoked).toBe(false);

    const revoked = await revokeCertificate(moderator, issued.id, "The submitted project was not the learner's own work.");
    expect(revoked.revokedAt).not.toBeNull();
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, "certificate.revoke"), eq(auditLog.targetId, issued.id)));
    expect(entry).toMatchObject({ actorId: moderator.actor.userId, reason: "The submitted project was not the learner's own work." });

    const found = await verifyCertificate(testCtx(), issued.verifyCode);
    expect(found).toEqual({ displayName: issued.displayName, courseTitle: issued.courseTitle, issuedAt: issued.issuedAt, revoked: true });
    expect(JSON.stringify(found)).not.toContain("own work");
    expect((await appError(() => getCertificatePdf(who.learner, issued.id))).code).toBe("conflict");
    expect((await listCertificates(who.learner, who.learnerId))[0]?.revokedAt).not.toBeNull();
    // Revoking again changes nothing, and a revoked certificate is never quietly replaced.
    await revokeCertificate(moderator, issued.id, "Second attempt at the same thing.");
    expect((await issueCertificateIfEligible(who.learner, (await certifiedEnrolment(who.learnerId)) ?? ""))?.revokedAt).not.toBeNull();
    expect(await db.select().from(certificate).where(eq(certificate.learnerId, who.learnerId))).toHaveLength(1);
  });

  const certifiedEnrolment = async (learnerId: string) => (await db.select({ enrolmentId: certificate.enrolmentId }).from(certificate).where(eq(certificate.learnerId, learnerId)))[0]?.enrolmentId;
});
