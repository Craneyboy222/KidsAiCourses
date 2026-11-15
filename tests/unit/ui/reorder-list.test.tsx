import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReorderList, type ReorderItem } from "@/components/ui";

const START: ReorderItem[] = [
  { id: "a", label: "Set up your tools" },
  { id: "b", label: "Plan your advert" },
  { id: "c", label: "Film and edit" },
];

function Harness({ onMove }: { onMove?: (move: { id: string; from: number; to: number }) => void }) {
  const [items, setItems] = useState(START);
  return (
    <ReorderList
      label="Lessons in this module"
      items={items}
      onReorder={(next, move) => {
        setItems(next);
        onMove?.(move);
      }}
    />
  );
}

const order = () =>
  within(screen.getByRole("list", { name: "Lessons in this module" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent?.replace(/^\d+\./, ""));

describe("ReorderList", () => {
  it("gives every item a named Move up and Move down button: there is nothing to drag", () => {
    render(<Harness />);
    for (const { label } of START) {
      expect(screen.getByRole("button", { name: `Move ${label} up` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Move ${label} down` })).toBeInTheDocument();
    }
    expect(document.querySelector("[draggable]")).toBeNull();
  });

  it("moves an item with the keyboard, keeps focus on the same button and announces the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);

    // Tab to the first enabled control and on to "Move Set up your tools down".
    await user.tab();
    expect(screen.getByRole("button", { name: "Move Set up your tools up" })).toHaveFocus();
    await user.tab();
    const down = screen.getByRole("button", { name: "Move Set up your tools down" });
    expect(down).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(order()).toEqual(["Plan your advert", "Set up your tools", "Film and edit"]);
    expect(onMove).toHaveBeenLastCalledWith({ id: "a", from: 0, to: 1 });
    expect(screen.getByRole("button", { name: "Move Set up your tools down" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Set up your tools moved down. Now 2 of 3.");

    // Space works too, and focus survives reaching the end of the list.
    await user.keyboard(" ");
    expect(order()).toEqual(["Plan your advert", "Film and edit", "Set up your tools"]);
    const atEnd = screen.getByRole("button", { name: "Move Set up your tools down" });
    expect(atEnd).toHaveFocus();
    expect(atEnd).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Set up your tools moved down. Now 3 of 3.");

    // Pressing again at the end does nothing.
    await user.keyboard("{Enter}");
    expect(order()).toEqual(["Plan your advert", "Film and edit", "Set up your tools"]);
    expect(onMove).toHaveBeenCalledTimes(2);

    // Shift+Tab back to "Move up" and bring it back one place.
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Move Set up your tools up" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(order()).toEqual(["Plan your advert", "Set up your tools", "Film and edit"]);
    expect(screen.getByRole("button", { name: "Move Set up your tools up" })).toHaveFocus();
  });

  it("marks the first Move up and the last Move down as unavailable", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Move Set up your tools up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Move Film and edit down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Move Plan your advert up" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("does nothing while disabled", async () => {
    const onReorder = vi.fn();
    render(<ReorderList label="Locked list" items={START} onReorder={onReorder} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "Move Plan your advert up" }));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
