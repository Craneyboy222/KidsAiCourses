import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ConfirmDialog } from "@/components/ui";

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      trigger={<Button variant="danger">Take down course</Button>}
      title="Take down this course?"
      description="Learners lose access straight away."
      confirmLabel="Take it down"
      tone="danger"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
  it("opens as an alert dialog with a title and description, and Cancel closes it", async () => {
    const { onConfirm, user } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Take down course" }));
    const dialog = screen.getByRole("alertdialog", { name: "Take down this course?" });
    expect(dialog).toHaveAccessibleDescription("Learners lose access straight away.");
    // Focus starts on Cancel, so Enter never confirms by accident.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms straight away when no reason is needed", async () => {
    const { onConfirm, user } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Take down course" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("will not confirm without a reason when one is required", async () => {
    const { onConfirm, user } = renderDialog({
      requireReason: true,
      reasonLabel: "Why are you taking it down?",
    });
    await user.click(screen.getByRole("button", { name: "Take down course" }));

    await user.click(screen.getByRole("button", { name: "Take it down" }));
    expect(onConfirm).not.toHaveBeenCalled();
    const reason = screen.getByRole("textbox", { name: "Why are you taking it down?" });
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription(
      expect.stringContaining("Error: Give a reason before you continue."),
    );
    expect(reason).toHaveFocus();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // Spaces alone, or a couple of characters, are not a reason.
    await user.type(reason, "   ok ");
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(reason).toHaveAccessibleDescription(expect.stringContaining("at least 5 characters"));
  });

  it("passes the trimmed reason to onConfirm and then closes", async () => {
    const { onConfirm, user } = renderDialog({ requireReason: true });
    await user.click(screen.getByRole("button", { name: "Take down course" }));
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "  Guide no longer matches the tool  ");
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Guide no longer matches the tool");
  });

  it("stays open and says what happened when the action fails", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new Error("You don't have permission to take down courses. Ask the owner."));
    const { user } = renderDialog({ onConfirm });
    await user.click(screen.getByRole("button", { name: "Take down course" }));
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to take down courses. Ask the owner.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
