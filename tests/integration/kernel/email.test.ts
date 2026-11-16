import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthEmailSender, sendAuthEmail } from "@/server/auth/email";
import { newLearnerPlaceholderEmail } from "@/server/auth/learner-email";
import { emailTemplate, siteSetting, user } from "@/server/db";
import {
  EmailRefusedError,
  clearSentEmails,
  getEmailTemplate,
  getEmailTransport,
  getSentEmails,
  postmarkTransport,
  renderEmail,
  resendTransport,
  sendEmail,
  setEmailTransport,
} from "@/server/email";
import { installKernelHooks } from "@/server/kernel";
import { closeDb, db, resetDb, testCtx } from "../../helpers/db";
import { createFamily, createLearner, createParent, createStaff } from "../../helpers/factories";

beforeEach(async () => {
  await resetDb();
  clearSentEmails();
  setEmailTransport(undefined);
});
afterEach(() => {
  resetAuthEmailSender();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const ctx = () => testCtx();
const data = { url: "https://app.example.test/verify?token=abc" };

describe("sendEmail", () => {
  it("sends a transactional email to a parent through the console transport", async () => {
    const { user: parent } = await createParent({ email: "priya@example.test" });
    const result = await sendEmail(ctx(), {
      to: "priya@example.test",
      template: "verify_email",
      data,
      userId: parent.id,
    });
    expect(result).toEqual({ provider: "console", id: null });
    const [sent] = getSentEmails();
    expect(getSentEmails()).toHaveLength(1);
    expect(sent).toMatchObject({
      to: "priya@example.test",
      subject: "Confirm your email address",
      template: "verify_email",
    });
    expect(sent?.html).toContain('href="https://app.example.test/verify?token=abc"');
    expect(sent?.text).toContain("Confirm my email address: https://app.example.test/verify?token=abc");
    expect(sent?.text).toContain("not marketing");
    expect(sent?.from).toContain("hello@example.test");
  });

  it("refuses any .invalid address and every learner placeholder", async () => {
    for (const to of [
      "someone@example.invalid",
      "x@y.INVALID",
      newLearnerPlaceholderEmail(),
      " a@learner.invalid ",
    ]) {
      const error = await sendEmail(ctx(), { to, template: "verify_email", data }).catch((e: unknown) => e);
      expect(error, to).toBeInstanceOf(EmailRefusedError);
      expect(error, to).toMatchObject({ code: "forbidden" });
    }
    expect(getSentEmails()).toHaveLength(0);
  });

  it("refuses to email a learner under 18, whatever address the caller supplies", async () => {
    const { family } = await createFamily();
    for (const age of [13, 15, 16, 17]) {
      const learner = await createLearner({ age, familyId: family.id });
      await expect(
        sendEmail(ctx(), {
          to: "teen@example.test",
          template: "safety_notice",
          data: { childName: "x", summary: "x", url: "https://x.test" },
          userId: learner.user.id,
        }),
      ).rejects.toMatchObject({
        reason: "under_18_learner",
      });
    }
    expect(getSentEmails()).toHaveLength(0);
  });

  it("refuses an under-18 learner found by address even when no userId is given", async () => {
    const learner = await createLearner({ age: 15 });
    await db.update(user).set({ email: "sneaky@example.test" }).where(eq(user.id, learner.user.id));
    await expect(
      sendEmail(ctx(), { to: "Sneaky@Example.test", template: "magic_link", data }),
    ).rejects.toMatchObject({ reason: "under_18_learner" });
    expect(getSentEmails()).toHaveLength(0);
  });

  it("allows a learner who is 18", async () => {
    const adult = await createLearner({ age: 18 });
    await sendEmail(ctx(), {
      to: "adult@example.test",
      template: "data_export_ready",
      data: { url: "https://app.example.test/x", expiresOn: "30 November 2026" },
      userId: adult.user.id,
    });
    expect(getSentEmails()).toHaveLength(1);
  });

  it("is cautious when the stored band and today's age disagree", async () => {
    // Stored as adult, but the birth date says 17: treated as under 18.
    const learner = await createLearner({ age: 17 });
    const { learnerProfile } = await import("@/server/db");
    await db
      .update(learnerProfile)
      .set({ safetyBand: "adult_18" })
      .where(eq(learnerProfile.userId, learner.user.id));
    await expect(
      sendEmail(ctx(), { to: "a@example.test", template: "magic_link", data, userId: learner.user.id }),
    ).rejects.toMatchObject({ reason: "under_18_learner" });
  });

  it("refuses an unknown user id, an unknown template and an account of an unknown kind", async () => {
    await expect(
      sendEmail(ctx(), {
        to: "a@example.test",
        template: "verify_email",
        data,
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ reason: "unknown_user" });
    await expect(
      sendEmail(ctx(), { to: "a@example.test", template: "spring_sale_newsletter", data }),
    ).rejects.toMatchObject({ code: "not_found" });
    const { user: odd } = await createParent();
    await db
      .update(user)
      .set({ kind: "teacher" as never })
      .where(eq(user.id, odd.id));
    await expect(
      sendEmail(ctx(), { to: "a@example.test", template: "verify_email", data, userId: odd.id }),
    ).rejects.toMatchObject({ reason: "under_18_learner" });
    expect(getSentEmails()).toHaveLength(0);
  });

  it("sends to staff and to addresses with no account yet (a parent being asked to approve)", async () => {
    const { user: staff } = await createStaff({ email: "sam@example.test" });
    await sendEmail(ctx(), {
      to: "sam@example.test",
      template: "safeguarding_alert",
      data: {
        severity: "critical",
        caseRef: "SC-12",
        dueBy: "16:00",
        url: "https://app.example.test/studio/safeguarding",
      },
      userId: staff.id,
    });
    await sendEmail(ctx(), {
      to: "new.parent@example.test",
      template: "parent_approval_request",
      data: { nickname: "Maya", url: "https://app.example.test/approve/t", expiresOn: "23 November 2026" },
    });
    expect(getSentEmails().map((e) => e.template)).toEqual(["safeguarding_alert", "parent_approval_request"]);
    // The safeguarding alert carries no detail about the child.
    expect(getSentEmails()[0]?.text).toContain("contains no details");
  });
});

describe("templates", () => {
  it("an active email_template row overrides the default; an inactive one does not", async () => {
    await db
      .insert(emailTemplate)
      .values({
        key: "magic_link",
        channel: "email",
        version: 1,
        subject: "Old draft",
        body: "Old {{url}}",
        active: false,
      });
    expect((await renderEmail(ctx(), "magic_link", data)).subject).toBe("Your sign-in link");

    await db
      .insert(emailTemplate)
      .values({
        key: "magic_link",
        channel: "email",
        version: 2,
        subject: "Sign in to {{brandName}}",
        body: "Tap here: [Sign in now]({{url}})\n\nNeed help? {{supportEmail}}",
        active: true,
      });
    await db.insert(siteSetting).values({ key: "site.support_email", value: "help@example.test" });
    const out = await renderEmail(ctx(), "magic_link", data);
    expect(out.subject).toBe("Sign in to [Platform Name]");
    expect(out.html).toContain("Sign in now</a>");
    expect(out.text).toContain("Need help? help@example.test");
    expect(await getEmailTemplate(ctx(), "magic_link")).toMatchObject({
      source: "override",
      version: 2,
      audience: "parent",
      category: "transactional",
      variables: ["brandName", "url", "supportEmail"],
    });
  });

  it("an in-app template row with the same key is not used for email", async () => {
    await db
      .insert(emailTemplate)
      .values({
        key: "magic_link",
        channel: "in_app",
        version: 1,
        subject: "In-app",
        body: "In-app",
        active: true,
      });
    expect(await getEmailTemplate(ctx(), "magic_link")).toMatchObject({ source: "default", version: null });
  });

  it("an override cannot inject markup through a variable either", async () => {
    await db
      .insert(emailTemplate)
      .values({
        key: "safety_notice",
        channel: "email",
        version: 1,
        subject: "About {{childName}}",
        body: "{{summary}} [Open]({{url}})",
        active: true,
      });
    const out = await renderEmail(ctx(), "safety_notice", {
      childName: "<b>Maya</b>",
      summary: "<script>x</script>",
      url: "javascript:alert(1)",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("javascript:");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("uses the brand display name from settings", async () => {
    await db.insert(siteSetting).values({ key: "site.brand_display_name", value: "Makerly" });
    const out = await renderEmail(ctx(), "verify_email", data);
    expect(out.text).toContain("Thanks for setting up an account with Makerly.");
    expect(out.html).toContain(">Makerly</p>");
  });
});

describe("transports", () => {
  it("defaults to console in tests and keeps only the latest messages", async () => {
    expect(getEmailTransport().name).toBe("console");
    for (let i = 0; i < 55; i += 1)
      await sendEmail(ctx(), { to: `p${i}@example.test`, template: "magic_link", data });
    const sent = getSentEmails();
    expect(sent).toHaveLength(50);
    expect(sent.at(-1)?.to).toBe("p54@example.test");
    clearSentEmails();
    expect(getSentEmails()).toHaveLength(0);
  });

  it("Resend: posts JSON with the API key and returns the id", async () => {
    vi.stubEnv("EMAIL_API_KEY", "re_test_key");
    const { resetEnvCache } = await import("@/env");
    resetEnvCache();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await resendTransport(fake).send({
      to: "a@example.test",
      from: "Us <hello@example.test>",
      replyTo: "help@example.test",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      template: "magic_link",
    });
    expect(result).toEqual({ provider: "resend", id: "msg_123" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      to: ["a@example.test"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "help@example.test",
    });
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("Postmark: uses the server token, the transactional stream and no tracking", async () => {
    vi.stubEnv("EMAIL_API_KEY", "pm_test_token");
    const { resetEnvCache } = await import("@/env");
    resetEnvCache();
    let captured: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ MessageID: "pm-1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await postmarkTransport(fake).send({
      to: "a@example.test",
      from: "hello@example.test",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(result).toEqual({ provider: "postmark", id: "pm-1" });
    expect(captured?.url).toBe("https://api.postmarkapp.com/email");
    expect((captured?.init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe(
      "pm_test_token",
    );
    expect(JSON.parse(String(captured?.init.body))).toMatchObject({
      To: "a@example.test",
      MessageStream: "outbound",
      TrackOpens: false,
      TrackLinks: "None",
    });
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("a provider error does not leak the response body, and needs a key", async () => {
    vi.stubEnv("EMAIL_API_KEY", "k");
    const { resetEnvCache } = await import("@/env");
    resetEnvCache();
    const failing = (async () =>
      new Response(JSON.stringify({ message: "a@example.test is on the suppression list" }), {
        status: 422,
      })) as unknown as typeof fetch;
    await expect(
      resendTransport(failing).send({
        to: "a@example.test",
        from: "f@example.test",
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow("Resend refused the email (HTTP 422)");
    vi.unstubAllEnvs();
    resetEnvCache();
    await expect(
      resendTransport(failing).send({
        to: "a@example.test",
        from: "f@example.test",
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow(/EMAIL_API_KEY/);
  });
});

describe("Better Auth emails", () => {
  it("go through the email system once the kernel hooks are installed", async () => {
    const { user: parent } = await createParent({ email: "priya@example.test" });
    installKernelHooks();
    await sendAuthEmail({
      kind: "verify_email",
      to: "priya@example.test",
      url: "https://app.example.test/api/auth/verify-email?token=t1",
      userId: parent.id,
    });
    await sendAuthEmail({
      kind: "reset_password",
      to: "priya@example.test",
      url: "https://app.example.test/reset?token=t2",
      userId: parent.id,
    });
    await sendAuthEmail({
      kind: "magic_link",
      to: "priya@example.test",
      url: "https://app.example.test/api/auth/magic-link/verify?token=t3",
    });
    const sent = getSentEmails();
    expect(sent.map((e) => e.template)).toEqual(["verify_email", "password_reset", "magic_link"]);
    expect(sent[1]?.subject).toBe("Reset your password");
    expect(sent[2]?.text).toContain("https://app.example.test/api/auth/magic-link/verify?token=t3");
  });

  it("still never reach a learner", async () => {
    const learner = await createLearner({ age: 14 });
    installKernelHooks();
    // The placeholder is dropped by the auth seam before it gets here…
    await sendAuthEmail({
      kind: "reset_password",
      to: learner.user.email,
      url: "https://app.example.test/reset",
      userId: learner.user.id,
    });
    expect(getSentEmails()).toHaveLength(0);
    // …and a real-looking address tied to an under-18 account is refused by the email system.
    await expect(
      sendAuthEmail({
        kind: "reset_password",
        to: "teen@example.test",
        url: "https://app.example.test/reset",
        userId: learner.user.id,
      }),
    ).rejects.toBeInstanceOf(EmailRefusedError);
    expect(getSentEmails()).toHaveLength(0);
  });
});
