import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ui";

describe("Markdown", () => {
  it("strips script tags and other raw HTML completely", () => {
    const { container } = render(
      <Markdown>{`Hello <script>alert("xss")</script> world

<script>
document.cookie = "stolen";
</script>

<img src="x" onerror="alert(1)">

<iframe src="https://evil.example"></iframe>

<div onclick="alert(1)" style="position:fixed">overlay</div>

<a href="https://evil.example" onclick="steal()">raw link</a>`}</Markdown>,
    );
    expect(container.querySelector("script, iframe, style, [onclick], [onerror]")).toBeNull();
    expect(container.innerHTML).not.toMatch(/<script|onerror|onclick|iframe|javascript:/i);
    expect(container.innerHTML).not.toContain("evil.example");
    expect(container).toHaveTextContent("Hello");
    expect(container).toHaveTextContent("world");
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
  ])("removes the unsafe link target %s", (url) => {
    const { container } = render(<Markdown>{`[click me](${url}) and <${url}>`}</Markdown>);
    for (const a of container.querySelectorAll("a")) expect(a).not.toHaveAttribute("href");
    expect(container.innerHTML.toLowerCase()).not.toContain(`href="${url.toLowerCase()}`);
    expect(container).toHaveTextContent("click me");
  });

  it("removes unsafe image sources", () => {
    const { container } = render(
      <Markdown>{`![a](javascript:alert(1)) ![b](data:image/svg+xml;base64,PHN2Zy8+) ![ok](https://cdn.example/pic.png)`}</Markdown>,
    );
    const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual([null, null, "https://cdn.example/pic.png"]);
    expect(screen.getByRole("img", { name: "ok" })).toHaveAttribute("loading", "lazy");
  });

  it("opens external links in a new tab, safely, and says so to screen readers", () => {
    render(
      <Markdown>{`Read the [Canva guide](https://www.canva.com/help) or go [back to the course](/explore/advert) or [email us](mailto:help@example.test).`}</Markdown>,
    );

    const external = screen.getByRole("link", { name: "Canva guide (opens in a new tab)" });
    expect(external).toHaveAttribute("href", "https://www.canva.com/help");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");

    const internal = screen.getByRole("link", { name: "back to the course" });
    expect(internal).toHaveAttribute("href", "/explore/advert");
    expect(internal).not.toHaveAttribute("target");

    expect(screen.getByRole("link", { name: "email us" })).toHaveAttribute(
      "href",
      "mailto:help@example.test",
    );
  });

  it("treats protocol-relative links as external", () => {
    render(<Markdown>{`[elsewhere](//other.example/page)`}</Markdown>);
    const link = screen.getByRole("link", { name: "elsewhere (opens in a new tab)" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shifts headings down so the page keeps a single h1", () => {
    render(<Markdown>{`# Title\n\n## Section\n\n###### Deep`}</Markdown>);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 6, name: "Deep" })).toBeInTheDocument();
  });

  it("renders GitHub-flavoured Markdown: tables, strikethrough and labelled task lists", () => {
    render(
      <Markdown
        topHeadingLevel={3}
      >{`| Shot | Seconds |\n| --- | --- |\n| Hook | 3 |\n\n~~old~~\n\n- [x] Pick a product\n- [ ] Write the hook`}</Markdown>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Seconds" })).toBeInTheDocument();
    expect(screen.getByText("old").tagName).toBe("DEL");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).toHaveAccessibleName("Done");
    expect(boxes[1]).toHaveAccessibleName("Not done yet");
    for (const box of boxes) expect(box).toBeDisabled();
  });
});
