import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceForm } from "@/components/submissions/EvidenceForm";
import { EvidencePreview } from "@/components/submissions/EvidencePreview";
import { declaredTypeFor, formatBytes } from "@/components/submissions/evidence-copy";
import type { EvidenceItem, SubmissionState } from "@/server/services/submission";

const actions = { addLinkAction: vi.fn(), requestUploadAction: vi.fn(), completeUploadAction: vi.fn(), removeEvidenceAction: vi.fn(), submitWorkAction: vi.fn() };
const refresh = vi.fn();
vi.mock("@/app/(learner)/portfolio/actions", () => ({
  addLinkAction: (...args: unknown[]) => actions.addLinkAction(...args),
  requestUploadAction: (...args: unknown[]) => actions.requestUploadAction(...args),
  completeUploadAction: (...args: unknown[]) => actions.completeUploadAction(...args),
  removeEvidenceAction: (...args: unknown[]) => actions.removeEvidenceAction(...args),
  submitWorkAction: (...args: unknown[]) => actions.submitWorkAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const CRITERIA = [
  { id: "r1", name: "It works", description: "The app runs without errors.", levels: [{ label: "Not yet" as const, descriptor: "It doesn't run yet." }, { label: "Getting there" as const, descriptor: "Mostly." }, { label: "Nailed it" as const, descriptor: "All of it." }] },
];

const item = (overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({ id: "11111111-1111-4111-8111-111111111111", kind: "link", url: "https://example.org/my-project", linkTool: null, mime: null, sizeBytes: null, state: "ready", hasFile: false, message: null, addedAt: new Date("2026-11-16T10:00:00Z"), ...overrides });

const state = (overrides: Partial<SubmissionState> = {}): SubmissionState => ({
  enrolmentId: "22222222-2222-4222-8222-222222222222",
  stepId: "33333333-3333-4333-8333-333333333333",
  stepType: "submit",
  status: "draft",
  allowedKinds: ["link", "screenshot"],
  limitsMb: { screenshot: 10, file: 25, video: 200 },
  acceptTypes: { screenshot: ["image/png", "image/jpeg", "image/webp"], file: ["application/pdf"], video: ["video/mp4"] },
  projectId: null,
  title: "Build Your Own Snapchat-Style App",
  note: "",
  selfCheck: {},
  items: [],
  submitted: null,
  requireSelfCheck: true,
  ...overrides,
});

const show = (value: SubmissionState) => render(<EvidenceForm state={value} hint="Paste your private Replit link." deliverables={["Three filters"]} criteria={CRITERIA} urgentHelp="If you or someone else is in danger right now, call 999." />);

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  refresh.mockReset();
});

describe("the evidence form", () => {
  it("asks only for the kinds the step takes, with the no-real-people rule and the limits", () => {
    show(state());
    expect(screen.getByText(/Don't send photos or videos of real people/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Link to your project/)).toHaveAttribute("type", "url");
    expect(screen.getByRole("checkbox", { name: /doesn't show any real people/ })).not.toBeChecked();
    const upload = screen.getByLabelText(/Upload a screenshot/);
    expect(upload).toHaveAttribute("type", "file");
    expect(upload).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(screen.getByText(/PNG, JPG or WebP, up to 10 MB/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Upload a video/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Upload a file/)).not.toBeInTheDocument();
    // The rubric self-check, with every level and "Not yet" as an honest option.
    expect(screen.getByRole("radio", { name: /Not yet/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand in my project" })).toBeInTheDocument();
  });

  it("never asks for a password, a code or an API key", () => {
    const { container } = show(state({ allowedKinds: ["link", "screenshot", "file", "video"] }));
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/your password|one-time code|api key/i);
  });

  it("shows a link as text, never as an embed, and only links to the course's own tools", () => {
    const { container } = show(state({ items: [item(), item({ id: "44444444-4444-4444-8444-444444444444", url: "https://replit.com/@maya/app", linkTool: { slug: "replit", name: "Replit" } })] }));
    expect(screen.getByText("https://example.org/my-project").closest("a")).toBeNull();
    expect(container.querySelectorAll("iframe, embed, object, video, img")).toHaveLength(0);
    expect(container.querySelector('a[href="https://example.org/my-project"]')).toBeNull();
    // The Register tool's link opens the leaving-site notice, not the site directly.
    expect(screen.getByRole("button", { name: /replit\.com\/@maya\/app/ })).toBeInTheDocument();
  });

  it("locks the form while work is being checked", () => {
    show(state({ status: "awaiting_review", projectId: "p1", submitted: { version: 1, submittedAt: new Date(), message: null, items: [item({ state: "awaiting_review" })] } }));
    expect(screen.getByText("Sent in: awaiting review")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Link to your project/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hand in/ })).not.toBeInTheDocument();
    expect(screen.getByText("Being checked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("shows the reviewer's message and lets the learner hand in again", () => {
    show(state({ status: "needs_changes", projectId: "p1", submitted: { version: 1, submittedAt: new Date(), message: "Please retake the screenshot using the sample image.", items: [item({ state: "rejected", message: "This wasn't accepted." })] } }));
    expect(screen.getByText("Please retake the screenshot using the sample image.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand in again" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Link to your project/)).toBeInTheDocument();
  });

  it("links to the portfolio once accepted", () => {
    show(state({ status: "accepted", projectId: "p1", submitted: { version: 1, submittedAt: new Date(), message: null, items: [item({ state: "accepted" })] } }));
    expect(screen.getByRole("link", { name: "See it in your portfolio" })).toHaveAttribute("href", "/portfolio/p1");
    expect(screen.queryByRole("button", { name: /Hand in/ })).not.toBeInTheDocument();
  });

  it("explains a rejected upload kindly and lets it be cleared", async () => {
    const user = userEvent.setup();
    actions.removeEvidenceAction.mockResolvedValue({ ok: true, data: { removed: true } });
    show(state({ items: [item({ kind: "screenshot", url: null, state: "rejected", message: "This looks like it shows a real person, so we can't keep it and we've deleted it." })] }));
    expect(screen.getByText(/we've deleted it/)).toBeInTheDocument();
    expect(screen.getByText("Not accepted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Clear this/ }));
    expect(actions.removeEvidenceAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("uploads through a signed link without ever sending the file's name", async () => {
    const user = userEvent.setup();
    actions.requestUploadAction.mockResolvedValue({ ok: true, data: { artefactId: "a1", upload: { url: "/api/files/evidence/pending/x?sig=1", method: "PUT", headers: { "Content-Type": "image/png" } } } });
    actions.completeUploadAction.mockResolvedValue({ ok: true, data: item({ id: "a1", kind: "screenshot", url: null }) });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    show(state());
    const file = new File([new Uint8Array([137, 80, 78, 71])], "Maya Patel holiday.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/Upload a screenshot/), file);

    await waitFor(() => expect(actions.completeUploadAction).toHaveBeenCalledWith("a1"));
    expect(actions.requestUploadAction).toHaveBeenCalledWith({ enrolmentId: "22222222-2222-4222-8222-222222222222", stepId: "33333333-3333-4333-8333-333333333333", kind: "screenshot", contentType: "image/png", sizeBytes: 4 });
    expect(JSON.stringify(actions.requestUploadAction.mock.calls)).not.toContain("Maya Patel");
    expect(fetchMock).toHaveBeenCalledWith("/api/files/evidence/pending/x?sig=1", expect.objectContaining({ method: "PUT", body: file }));
    fetchMock.mockRestore();
  });

  it("refuses a file over the limit before sending anything, and shows why a rejected upload failed", async () => {
    const user = userEvent.setup();
    show(state({ limitsMb: { screenshot: 0.000001, file: 25, video: 200 } }));
    await user.upload(screen.getByLabelText(/Upload a screenshot/), new File([new Uint8Array(64)], "big.png", { type: "image/png" }));
    expect(await screen.findByText(/That file is too big/)).toBeInTheDocument();
    expect(actions.requestUploadAction).not.toHaveBeenCalled();
  });

  it("shows the urgent help when a note raised a safety flag", async () => {
    const user = userEvent.setup();
    actions.submitWorkAction.mockResolvedValue({ ok: true, data: { projectId: "p1", version: 1, status: "awaiting_review", certificateId: null, showCrisisScript: true } });
    show(state({ items: [item()], requireSelfCheck: false }));
    await user.click(screen.getByRole("button", { name: "Hand in my project" }));
    expect(await screen.findByText(/call 999/)).toBeInTheDocument();
    expect(screen.getByText("Your project has been sent in")).toBeInTheDocument();
  });
});

describe("the staff preview", () => {
  it("describes the step and offers nothing to send", () => {
    const { container } = render(<EvidencePreview type="submit" kinds={["link", "screenshot"]} hint="Paste your link." rubric={{ criteria: CRITERIA }} />);
    const preview = screen.getByTestId("evidence-preview");
    expect(within(preview).getByText(/Nothing can be sent from a preview/)).toBeInTheDocument();
    expect(within(preview).getByText("It works")).toBeInTheDocument();
    expect(container.querySelectorAll("form, input, button, textarea")).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("declares a type from the extension only when the browser gives none", () => {
    expect(declaredTypeFor({ type: "image/png", name: "a.md" })).toBe("image/png");
    expect(declaredTypeFor({ type: "", name: "notes.MD" })).toBe("text/markdown");
    expect(declaredTypeFor({ type: "", name: "mystery" })).toBe("application/octet-stream");
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("");
  });
});
