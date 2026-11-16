import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportControl, reasonsFor } from "@/components/safety/ReportControl";

const sendReportAction = vi.fn();
vi.mock("@/app/_safety/actions", () => ({ sendReportAction: (...args: unknown[]) => sendReportAction(...args) }));

beforeEach(() => {
  sendReportAction.mockReset();
  sendReportAction.mockResolvedValue({ ok: true, showCrisisScript: false });
});

describe("ReportControl", () => {
  it("always offers 'Someone is in danger', whatever is being reported", () => {
    for (const type of ["step", "course", "project", "ai_output", "guide", "other"] as const) {
      const reasons = reasonsFor(type);
      expect(reasons.filter((reason) => reason.value === "someone_in_danger" && reason.urgent)).toHaveLength(1);
      expect(new Set(reasons.map((reason) => reason.value)).size).toBe(reasons.length);
    }
    expect(reasonsFor("guide")[0]?.value).toBe("guide_mismatch");
    expect(reasonsFor("step").map((reason) => reason.value)).toContain("guide_mismatch");
  });

  it("has an accessible name even as an icon-only button", () => {
    render(<ReportControl target={{ type: "step", id: "s3", courseId: "c1", stepKey: "s3" }} compact />);
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
  });

  it("sends the chosen reason, the target and the note, then confirms calmly", async () => {
    const user = userEvent.setup();
    const target = { type: "guide", id: "guide-replit", courseId: "c1", stepKey: "s2", toolSlug: "replit" } as const;
    render(<ReportControl target={target} label="This doesn't match what I see" />);
    await user.click(screen.getByRole("button", { name: "This doesn't match what I see" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /This doesn't match what I see/ }));
    await user.type(within(dialog).getByRole("textbox"), "The Create button has moved.");
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(sendReportAction).toHaveBeenCalledWith({ reason: "guide_mismatch", target, note: "The Create button has moved." });
    expect(await within(screen.getByRole("dialog")).findByText(/Thanks for telling us/)).toBeInTheDocument();
  });

  it("shows the urgent help as soon as the danger reason is chosen, and again once it is sent", async () => {
    const user = userEvent.setup();
    sendReportAction.mockResolvedValue({ ok: true, showCrisisScript: true });
    render(<ReportControl target={{ type: "ai_output", id: "m1" }} />);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/call 999/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /Someone is in danger/ }));
    expect(within(dialog).getByText(/call 999/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Childline free on 0800 1111/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(sendReportAction).toHaveBeenCalledWith(expect.objectContaining({ reason: "someone_in_danger" }));
    const sent = screen.getByRole("dialog");
    expect(await within(sent).findByText(/Thanks for telling us/)).toBeInTheDocument();
    expect(within(sent).getByText(/call 999/)).toBeInTheDocument();
  });

  it("keeps the dialog open with the reason when the report does not send", async () => {
    const user = userEvent.setup();
    sendReportAction.mockResolvedValue({ ok: false, message: "That's a lot in a short time. Give it a minute, then try again." });
    render(<ReportControl target={{ type: "course", id: "c1" }} />);
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Something else/ }));
    await user.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByText(/Give it a minute/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Thanks for telling us/)).not.toBeInTheDocument();
  });
});
