// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderSubject,
  renderTemplate,
  safeHref,
  templateVariables,
} from "@/server/email/render";
import { addressRefusal } from "@/server/email/send";
import { EMAIL_TEMPLATES, defaultEmailTemplate, registerEmailTemplate } from "@/server/email/templates";
import { maskEmail } from "@/server/email/transport";

const options = {
  brandName: "Makerly",
  appUrl: "https://app.example.test",
  footer: "Service message, not marketing.",
};

describe("renderTemplate", () => {
  it("fills variables in the subject, HTML and text", () => {
    const out = renderTemplate(
      { subject: "Hello {{name}}", body: "Dear {{name}},\n\nYour code is **{{code}}**." },
      { name: "Priya", code: "ABC123" },
      options,
    );
    expect(out.subject).toBe("Hello Priya");
    expect(out.html).toContain("Dear Priya,");
    expect(out.html).toContain("<strong>ABC123</strong>");
    expect(out.text).toContain("Dear Priya,\n\nYour code is ABC123.");
    expect(out.text).toContain("Service message, not marketing.");
  });

  it("escapes HTML in variables, so a value can never add markup", () => {
    const out = renderTemplate(
      { subject: "Notice", body: "Name: {{name}}" },
      { name: `<script>alert("x")</script><img src=x onerror=1>` },
      options,
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // The plain-text part carries the value as typed: there is no markup to inject into.
    expect(out.text).toContain(`<script>alert("x")</script>`);
  });

  it("escapes HTML written into the template itself", () => {
    const out = renderTemplate({ subject: "S", body: "Use <b>bold</b> & more" }, {}, options);
    expect(out.html).toContain("Use &lt;b&gt;bold&lt;/b&gt; &amp; more");
  });

  it("does not let a variable turn itself into Markdown", () => {
    const out = renderTemplate(
      { subject: "S", body: "Hello {{name}}" },
      { name: "**bold** [click](https://evil.example)" },
      options,
    );
    expect(out.html).not.toContain("<strong>");
    expect(out.html).not.toContain('href="https://evil.example"');
    expect(out.html).toContain("**bold** [click](https://evil.example)");
  });

  it("does not expand placeholders that arrive inside a value", () => {
    const out = renderTemplate({ subject: "S", body: "A: {{a}}" }, { a: "{{b}}", b: "SECRET" }, options);
    expect(out.html).not.toContain("SECRET");
    expect(out.text).not.toContain("SECRET");
  });

  it("makes a paragraph that is only a link into the button, and shows the address in the text part", () => {
    const out = renderTemplate(
      { subject: "S", body: "[Confirm my email]({{url}})" },
      { url: "https://app.example.test/verify?token=a&b=1" },
      options,
    );
    expect(out.html).toMatch(
      /<a href="https:\/\/app\.example\.test\/verify\?token=a&amp;b=1" style="[^"]*background:#1d4ed8[^"]*">Confirm my email<\/a>/,
    );
    expect(out.text).toContain("Confirm my email: https://app.example.test/verify?token=a&b=1");
  });

  it("refuses javascript: and data: links, in the template or in a variable", () => {
    const fromVariable = renderTemplate(
      { subject: "S", body: "[Open]({{url}})" },
      { url: "javascript:alert(1)" },
      options,
    );
    expect(fromVariable.html).not.toContain("href=");
    expect(fromVariable.html).toContain("Open");
    const fromTemplate = renderTemplate(
      { subject: "S", body: "See [this](data:text/html,<script>1</script>) now" },
      {},
      options,
    );
    expect(fromTemplate.html).not.toContain("href=");
  });

  it("cannot break out of the href attribute", () => {
    const out = renderTemplate(
      { subject: "S", body: "[Open]({{url}})" },
      { url: `https://x.test/"onmouseover="alert(1)` },
      options,
    );
    expect(out.html).not.toContain('"onmouseover="');
    expect(out.html).toContain("&quot;onmouseover=&quot;");
  });

  it("turns a path on our own site into a full address", () => {
    expect(safeHref("/parent/notices", "https://app.example.test/")).toBe(
      "https://app.example.test/parent/notices",
    );
    expect(safeHref("//evil.example/x", "https://app.example.test")).toBeNull();
    expect(safeHref("ftp://x.test", "https://app.example.test")).toBeNull();
    expect(safeHref("mailto:help@example.test", "https://app.example.test")).toBe("mailto:help@example.test");
  });

  it("renders lists, headings and notes", () => {
    const out = renderTemplate(
      { subject: "S", body: "## What next\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Take care" },
      {},
      options,
    );
    expect(out.html).toContain("<h2");
    expect(out.html).toMatch(/<ul[^>]*><li[^>]*>One<\/li><li[^>]*>Two<\/li><\/ul>/);
    expect(out.html).toMatch(/<ol[^>]*><li[^>]*>First<\/li>/);
    expect(out.html).toContain("Take care");
    expect(out.text).toContain("- One\n- Two");
  });

  it("keeps the subject on one line, so a value cannot add a header", () => {
    expect(renderSubject("Hi {{name}}", { name: "A\r\nBcc: someone@example.test" })).toBe(
      "Hi A Bcc: someone@example.test",
    );
  });

  it("throws when a variable the template uses is missing", () => {
    expect(() =>
      renderTemplate({ subject: "Hi {{name}}", body: "Link {{url}}" }, { name: "A" }, options),
    ).toThrow(/url/);
  });

  it("produces an accessible wrapper: language, title, one h1, readable footer, no images or tracking", () => {
    const out = renderTemplate({ subject: "Your sign-in link", body: "Hello" }, {}, options);
    expect(out.html).toMatch(/^<!doctype html>\n<html lang="en-GB"/);
    expect(out.html).toContain("<title>Your sign-in link</title>");
    expect(out.html.match(/<h1/g)).toHaveLength(1);
    expect(out.html).toContain('role="presentation"');
    expect(out.html).not.toMatch(/<img|<script|<link|<iframe/);
  });

  it("escapeHtml covers the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
  });
});

describe("built-in email templates", () => {
  const required = [
    "verify_email",
    "magic_link",
    "password_reset",
    "parent_approval_request",
    "invite_code",
    "tool_approval_request",
    "unlock_request",
    "safety_notice",
    "account_locked",
    "data_export_ready",
    "deletion_scheduled",
    "deletion_completed",
    "birthday_transition",
    "inactivity_warning",
    "course_take_down",
    "staff_invite",
    "safeguarding_alert",
    "spend_cap_alert",
    "radar_digest",
    "tool_change_alert",
  ];

  it("has every template the brief lists", () => {
    for (const key of required) expect(defaultEmailTemplate(key), key).toBeDefined();
  });

  it.each(Object.entries(EMAIL_TEMPLATES))(
    "%s is transactional, has a real audience and renders cleanly",
    (key, template) => {
      expect(template.category).toBe("transactional");
      expect(["parent", "staff", "adult_learner"]).toContain(template.audience);
      const data: Record<string, string> = {
        brandName: "Makerly",
        appUrl: options.appUrl,
        supportEmail: "help@example.test",
      };
      for (const name of templateVariables(template.subject, template.body)) {
        data[name] ??= name === "url" ? "https://app.example.test/go" : `<${name}>`;
      }
      const out = renderTemplate(template, data, options);
      expect(out.subject.length, key).toBeGreaterThan(5);
      for (const part of [out.subject, out.html, out.text]) expect(part, key).not.toMatch(/\{\{|\}\}/);
      // Every sample value contained angle brackets: none may survive unescaped in the HTML body.
      expect(out.html, key).not.toMatch(
        /<(childName|nickname|toolName|courseTitle|summary|reason|accountLabel|inviterName|change)>/,
      );
      // Parent copy stays calm: no exclamation marks, no marketing words.
      expect(`${template.subject} ${template.body}`, key).not.toMatch(
        /!|\b(offer|discount|upgrade now|buy)\b/i,
      );
    },
  );

  it("only lets transactional templates be registered", () => {
    expect(() =>
      registerEmailTemplate("spring_sale", {
        subject: "s",
        body: "b",
        audience: "parent",
        category: "marketing" as never,
        description: "d",
      }),
    ).toThrow(/transactional/);
    expect(() =>
      registerEmailTemplate("verify_email", {
        subject: "s",
        body: "b",
        audience: "parent",
        category: "transactional",
        description: "d",
      }),
    ).toThrow(/already exists/);
  });
});

describe("addresses", () => {
  it("refuses .invalid and learner placeholder addresses", () => {
    expect(addressRefusal("3f0c1d2e-0000-4000-8000-000000000000@learner.invalid")).toBe(
      "learner_placeholder",
    );
    expect(addressRefusal("Someone@Example.INVALID")).toBe("undeliverable_address");
    expect(addressRefusal("someone@sub.invalid ")).toBe("undeliverable_address");
    expect(addressRefusal("not-an-address")).toBe("invalid_address");
    expect(addressRefusal("a@b.test, c@d.test")).toBe("invalid_address");
    expect(addressRefusal("parent@example.test")).toBeNull();
  });

  it("masks addresses for logs", () => {
    expect(maskEmail("priya@example.test")).toBe("p***@example.test");
    expect(maskEmail("nonsense")).toBe("***");
  });
});
