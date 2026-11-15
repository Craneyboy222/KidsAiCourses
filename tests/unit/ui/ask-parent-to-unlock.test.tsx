import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AskParentToUnlock } from "@/components/ui";

describe("AskParentToUnlock", () => {
  it("never renders a pound sign or a price, in either state", () => {
    const { container, rerender } = render(
      <AskParentToUnlock itemName="AI music video" asked={false} onAsk={() => undefined} />,
    );
    expect(container.textContent).not.toContain("£");
    expect(container.textContent).not.toMatch(/\d+(\.\d{2})?\s?(p\b|pence|per month)/i);
    rerender(<AskParentToUnlock itemName="AI music video" asked onAsk={() => undefined} />);
    expect(container.textContent).not.toContain("£");
  });

  it.each([
    ["Unlock for £9.99", "Only £4.99 a month, cancel any time"],
    ["Premium course", "Costs 499p"],
    ["Get the Family plan", "GBP 60 per year"],
    ["Upgrade for $5", "From €5/month"],
  ])("drops price-bearing copy and falls back to the safe wording (%s / %s)", (title, description) => {
    const { container } = render(
      <AskParentToUnlock title={title} description={description} asked={false} onAsk={() => undefined} />,
    );
    expect(container.textContent).not.toMatch(/[£$€]|GBP|\d+p\b|per year|a month|\/month/i);
    expect(container.textContent).not.toContain(description);
    expect(screen.getByText(/Send them a request and we'll let them know/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a parent to unlock" })).toBeInTheDocument();
  });

  it("keeps custom copy that does not mention money", () => {
    render(
      <AskParentToUnlock
        title="Pro courses need a parent's OK"
        description="Ask them and we'll let you know."
        asked={false}
        onAsk={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Pro courses need a parent's OK" })).toBeInTheDocument();
    expect(screen.getByText("Ask them and we'll let you know.")).toBeInTheDocument();
  });

  it("calls onAsk when the learner asks, with any hidden fields", async () => {
    const onAsk = vi.fn<(formData: FormData) => void>();
    render(
      <AskParentToUnlock asked={false} onAsk={onAsk}>
        <input type="hidden" name="courseId" value="c-42" />
      </AskParentToUnlock>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask a parent to unlock" }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));
    expect(onAsk.mock.calls[0]?.[0].get("courseId")).toBe("c-42");
  });

  it("shows a status message instead of the button once asked", () => {
    render(<AskParentToUnlock asked onAsk={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Request sent.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
