import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ExternalToolLink } from "@/components/ui";
import { BRAND_NAME } from "@/lib/brand";

describe("ExternalToolLink", () => {
  it("shows the leaving notice before any link to the tool exists", async () => {
    const user = userEvent.setup();
    render(<ExternalToolLink href="https://www.canva.com/" toolName="Canva" allowed />);

    // Until the notice is open there is no anchor at all, so the notice cannot be skipped.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Canva" }));

    const dialog = screen.getByRole("dialog", { name: `You're leaving ${BRAND_NAME} to go to Canva` });
    expect(dialog).toHaveTextContent("It opens in a new tab, so your place here is saved.");

    const go = screen.getByRole("link", { name: "Continue to Canva (opens in a new tab)" });
    expect(go).toHaveAttribute("href", "https://www.canva.com/");
    expect(go).toHaveAttribute("target", "_blank");
    expect(go).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Stay here closes the notice and leaves no link behind", async () => {
    const user = userEvent.setup();
    render(
      <ExternalToolLink href="https://replit.com/" toolName="Replit" allowed>
        Replit
      </ExternalToolLink>,
    );
    await user.click(screen.getByRole("button", { name: "Replit" }));
    await user.click(screen.getByRole("button", { name: "Stay here" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders plain text and no link or button when the tool is not allowed", () => {
    const { container } = render(
      <p>
        Made with <ExternalToolLink href="https://example.com/tool" toolName="Blocked Tool" allowed={false} />
        .
      </p>,
    );
    expect(container).toHaveTextContent("Made with Blocked Tool.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("example.com");
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not a url", "/relative/path"])(
    "never links to %s, even when allowed",
    (href) => {
      const { container } = render(<ExternalToolLink href={href} toolName="Sketchy" allowed />);
      expect(container.querySelector("a")).toBeNull();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(container).toHaveTextContent("Sketchy");
    },
  );
});
