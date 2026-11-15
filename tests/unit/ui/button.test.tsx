import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "@/components/ui";

describe("Button", () => {
  it("is a plain button by default and calls onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("announces the loading state, stays focusable and ignores clicks and key presses", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    // Not the `disabled` attribute: that would throw keyboard focus off the button.
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");

    await user.click(button);
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("falls back to a generic announcement and does not submit its form while loading", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Send
        </Button>
      </form>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the announcement when loading ends", () => {
    const { rerender } = render(<Button loading>Save</Button>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    rerender(<Button>Save</Button>);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("IconButton", () => {
  it("takes its accessible name from the required label", () => {
    render(<IconButton label="Close" icon={<svg aria-hidden="true" />} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
