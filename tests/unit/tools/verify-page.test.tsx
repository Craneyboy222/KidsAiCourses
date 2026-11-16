import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifyCertificatePage, { metadata } from "@/app/(marketing)/verify/[code]/page";

const verifyCertificate = vi.fn();
const checkRateLimit = vi.fn();
vi.mock("@/server/context", () => ({ getCtx: async () => ({ actor: { type: "anonymous" }, now: new Date(), requestId: "test", ip: "203.0.113.9" }) }));
vi.mock("@/server/ratelimit", () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimit(...args) }));
vi.mock("@/server/services/certificate", () => ({ verifyCertificate: (...args: unknown[]) => verifyCertificate(...args) }));

const page = async (code: string) => render(await VerifyCertificatePage({ params: Promise.resolve({ code }) }));

beforeEach(() => {
  verifyCertificate.mockReset();
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfterSec: 0 });
});

describe("/verify/[code]", () => {
  it("is never indexed", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("shows the name, the course and the date, and nothing else about the learner", async () => {
    verifyCertificate.mockResolvedValue({ displayName: "Maya", courseTitle: "Build Your Own Snapchat-Style App", issuedAt: new Date("2026-11-15T12:00:00Z"), revoked: false });
    const { container } = await page("ABCD-EFGH-JKMN-PQRS");
    expect(screen.getByTestId("certificate-valid")).toBeInTheDocument();
    expect(screen.getByText("Maya")).toBeInTheDocument();
    expect(screen.getByText("Build Your Own Snapchat-Style App")).toBeInTheDocument();
    expect(screen.getByText("15 November 2026")).toBeInTheDocument();
    expect(verifyCertificate).toHaveBeenCalledWith(expect.anything(), "ABCD-EFGH-JKMN-PQRS");
    // No way from here to anything else about the learner: no links, images or forms at all.
    expect(container.querySelectorAll("a, img, form, input")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/username|surname|age \d|school|portfolio|parent/i);
  });

  it("says plainly when a certificate has been revoked, without saying why", async () => {
    verifyCertificate.mockResolvedValue({ displayName: "Maya", courseTitle: "Prompt Gym", issuedAt: new Date("2026-11-15T12:00:00Z"), revoked: true });
    const { container } = await page("ABCD-EFGH-JKMN-PQRS");
    expect(screen.getByTestId("certificate-revoked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /has been revoked/ })).toBeInTheDocument();
    expect(screen.queryByTestId("certificate-valid")).not.toBeInTheDocument();
    expect(container.textContent).toMatch(/no longer valid/);
  });

  it("gives one answer for an unknown code, and does not look up an absurd one", async () => {
    verifyCertificate.mockResolvedValue(null);
    await page("NOPE-NOPE-NOPE-NOPE");
    expect(screen.getByRole("heading", { name: /couldn't find a certificate/ })).toBeInTheDocument();
    await page("A".repeat(500));
    expect(verifyCertificate).toHaveBeenCalledTimes(1);
  });

  it("is rate limited, and a limited request is never looked up", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 300 });
    await page("ABCD-EFGH-JKMN-PQRS");
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "certificate.verify", expect.objectContaining({ limit: 30 }));
    expect(screen.getByText(/a lot of checks in a short time/)).toBeInTheDocument();
    expect(verifyCertificate).not.toHaveBeenCalled();
  });
});
