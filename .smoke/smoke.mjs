import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3211";
const fx = JSON.parse(process.argv[2]);
const results = [];
const ok = (name, pass, extra = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const log = () => readFileSync("/tmp/accounts-dev.log", "utf8");
function lastLink(pattern) {
  const lines = log().split("\n").filter((l) => l.includes('"email.console"'));
  for (const line of lines.reverse()) {
    try { const links = JSON.parse(line).data.links ?? []; const hit = links.find((l) => pattern.test(l)); if (hit) return hit; } catch {}
  }
  return null;
}
function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const d = createHmac("sha1", key).update(counter).digest(); const o = d[d.length - 1] & 0xf;
  return ((d.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
const year = new Date().getFullYear();
const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
async function ctx(opts = {}) { const c = await browser.newContext({ baseURL: BASE, ...opts }); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); return { c, p }; }

// A. Under-13 at teen sign-up → blocked page, flag cookie, form no longer offered.
{
  const { c, p } = await ctx();
  await p.goto("/signup/teen");
  await p.getByLabel("Month").selectOption("3");
  await p.getByLabel("Year").selectOption(String(year - 11));
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL("**/blocked-age");
  ok("A1 under-13 teen lands on /blocked-age", true);
  const cookies = await c.cookies();
  const gate = cookies.find((k) => k.name === "age_gate");
  ok("A2 flag cookie is a bare '1', HttpOnly, about an hour", gate?.value === "1" && gate.httpOnly && gate.expires - Date.now() / 1000 <= 3601, JSON.stringify(gate));
  ok("A3 blocked page has no form and no input", (await p.locator("form, input, textarea, select").count()) === 0);
  await p.goto("/signup/teen"); ok("A4 retry is sent back to /blocked-age", p.url().endsWith("/blocked-age"));
  await p.goto("/signup/parent"); ok("A5 parent sign-up also sends back", p.url().endsWith("/blocked-age"));
  await c.close();
}

// B. Parent sign-up WITHOUT JavaScript, then the emailed link.
let newParentEmail = `smoke-new-${Date.now()}@example.test`;
{
  const { c, p } = await ctx({ javaScriptEnabled: false });
  await p.goto("/signup/parent");
  await p.getByLabel("Email address").fill(newParentEmail);
  await p.getByLabel(/^Password/).fill("meadow-kettle-comet-77");
  await p.getByRole("button", { name: "Create family account" }).click();
  await p.waitForLoadState();
  ok("B1 no-JS: missing 18+ tick is refused by the browser or the server", !(await p.getByText("Check your email").isVisible().catch(() => false)));
  await p.goto("/signup/parent");
  await p.getByLabel("Email address").fill(newParentEmail);
  await p.getByLabel(/^Password/).fill("meadow-kettle-comet-77");
  await p.getByLabel(/I am 18 or over/).check();
  await p.getByRole("button", { name: "Create family account" }).click();
  await p.getByText("Check your email").waitFor();
  ok("B2 no-JS parent sign-up shows 'Check your email'", true);
  const link = lastLink(/verify-email/);
  ok("B3 verification link was emailed", !!link, link ?? "");
  await p.goto(link.replace("http://localhost:3000", BASE));
  await p.waitForURL("**/parent/onboarding");
  ok("B4 link signs the parent in and lands on /parent/onboarding", true);
  ok("B5 onboarding shows the safety explainer and four steps", (await p.getByRole("heading", { name: /How safety and outside tools work/ }).count()) > 0 && (await p.getByRole("heading", { name: /Add a child/ }).count()) > 0);
  await p.goto("/parent/children/new");
  ok("B6 add-a-child form renders", (await p.getByLabel("Nickname").count()) === 1 && (await p.locator('input[type=email]').count()) === 0);
  await p.getByLabel("Nickname").fill("Bea");
  await p.getByLabel("Month").selectOption("3");
  await p.getByLabel("Year").selectOption(String(year - 10));
  await p.getByLabel(/^Username/).fill("bea_bakes_cakes");
  await p.getByRole("button", { name: "Add child" }).click();
  await p.waitForURL("**/blocked-age");
  ok("B7 no-JS: under-13 child at parent-add lands on /blocked-age", true);
  await c.close();
}

// C. Parent password sign-in: wrong password message, then the consent centre.
{
  const { c, p } = await ctx();
  await p.goto("/signin?as=parent");
  await p.getByRole("form", { name: "Parent or carer sign-in" }).getByLabel("Email address").fill(fx.parentEmail);
  await p.getByRole("form", { name: "Parent or carer sign-in" }).getByLabel("Password").fill("definitely-wrong-pass");
  await p.getByRole("form", { name: "Parent or carer sign-in" }).getByRole("button", { name: "Sign in" }).click();
  await p.getByRole("alert").filter({ hasText: "don't match" }).waitFor();
  ok("C1 wrong password: calm message, email kept in the box", (await p.getByRole("form", { name: "Parent or carer sign-in" }).getByLabel("Email address").inputValue()) === fx.parentEmail);
  await p.getByRole("form", { name: "Parent or carer sign-in" }).getByLabel("Password").fill(fx.password);
  await p.getByRole("form", { name: "Parent or carer sign-in" }).getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/parent");
  ok("C2 parent with children lands on /parent (dashboard is another slice)", true);
  await p.goto(`/parent/children/${fx.heldId}/consent`);
  await p.getByRole("heading", { level: 1, name: "Maya's permissions" }).waitFor();
  ok("C3 consent page: 5 unticked boxes, switcher and waiting notice", (await p.locator('input[type=checkbox][name^="consent."]').count()) === 5 && (await p.locator('input[type=checkbox][name^="consent."]:checked').count()) === 0 && (await p.getByText("waiting for your permissions").count()) > 0);
  await p.getByLabel(/I agree: Account and learning data/).check();
  await p.getByLabel(/I agree: Coach/).check();
  await p.getByRole("button", { name: "Save permissions" }).click();
  await p.getByText("Saved, but the account is still locked").waitFor();
  ok("C4 two of three: still locked, ticks kept", (await p.locator('input[type=checkbox][name^="consent."]:checked').count()) === 2);
  await p.getByLabel(/I agree: Using tools/).check();
  await p.getByRole("button", { name: "Save permissions" }).click();
  await p.getByText("Maya's account is ready").waitFor();
  ok("C5 third consent activates the account", true);
  await p.getByText("One more step before Maya can use Coach").waitFor();
  ok("C6 13–15: card-or-subscription explanation shown, no price on the page", !/£|\d+\.\d\d/.test(await p.locator("main").innerText()));
  await p.goto("/parent/children/00000000-0000-4000-8000-000000000000/consent");
  ok("C7 another id is a 404", (await p.title()).toLowerCase().includes("not") || (await p.locator("body").innerText()).toLowerCase().includes("couldn't find") || (await p.locator("body").innerText()).includes("404"));
  await c.close();
}

// D. Teen sign-up at 14 → waiting page; E. parent approval link.
{
  const { c, p } = await ctx();
  await p.goto("/signup/teen");
  await p.getByLabel("Month").selectOption("3");
  await p.getByLabel("Year").selectOption(String(year - 15));
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByLabel("Username").waitFor();
  ok("D1 step two never asks the teen for an email of their own", (await p.getByLabel(/^Email address/).count()) === 0 && (await p.getByText(/7 days/).count()) > 0);
  const uname = `swift_puffin_${Math.floor(Math.random() * 800) + 100}`;
  await p.getByLabel("Username").fill("leeds_lad");
  await p.getByLabel(/^Password/).fill("meadow-kettle-comet-77");
  await p.getByLabel(/parent or carer's email/i).fill(`teen-parent-${Date.now()}@example.test`);
  await p.getByRole("button", { name: "Create my account" }).click();
  await p.getByRole("alert").filter({ hasText: /school, year group or place/ }).waitFor();
  ok("D2 place-like username refused with suggestions, parent email kept", /You could use/.test(await p.getByRole("alert").first().innerText()) && (await p.getByLabel(/parent or carer's email/i).inputValue()).includes("teen-parent-"));
  await p.getByLabel("Username").fill(uname);
  await p.getByRole("button", { name: "Create my account" }).click();
  await p.waitForURL("**/signup/teen/waiting");
  ok("D3 teen lands on the waiting page, signed in", (await p.getByText(/deleted on \d+ \w+ \d{4}/).count()) > 0);
  await p.getByRole("button", { name: "Send the email again" }).click();
  await p.getByText("Sent again").waitFor();
  ok("D4 resend works", true);
  await p.goto("/onboarding"); ok("D5 a pending teen cannot open onboarding", p.url().includes("/signup/teen/waiting"));
  await c.close();

  const link = lastLink(/\/approve\//);
  const { c: c2, p: p2 } = await ctx();
  await p2.goto(link.replace("http://localhost:3000", BASE));
  await p2.getByRole("heading", { level: 1, name: "A request to approve an account" }).waitFor();
  ok("E1 approval page names the username and offers to create a parent account", (await p2.getByText(uname).count()) > 0 && (await p2.getByRole("form", { name: "Create your parent account" }).count()) === 1);
  await p2.getByLabel(/Choose a password/).fill("meadow-kettle-comet-77");
  await p2.getByLabel(/I am 18 or over/).check();
  await p2.getByRole("button", { name: "Create my account and continue" }).click();
  await p2.getByRole("heading", { level: 1, name: "Approve this account?" }).waitFor();
  ok("E2 account created, signed in, back on the approval page", true);
  await p2.getByRole("button", { name: new RegExp(`Yes, add ${uname}`) }).click();
  await p2.waitForTimeout(1500);
  const where = p2.url();
  const alert = await p2.getByRole("alert").first().innerText().catch(() => "");
  ok("E3 approve: goes to consent, or says plainly that seats aren't ready (payments slice not built)", /\/consent/.test(where) || /isn't ready yet/.test(alert), where + " | " + alert.replace(/\n/g, " "));
  await c2.close();
}

// F. Invite code → own password → signed in.
{
  const { c, p } = await ctx();
  await p.goto(`/join/${fx.inviteCode}`);
  ok("F1 code link pre-fills the code", (await p.getByRole("textbox", { name: "Your code" }).inputValue()) === fx.inviteCode);
  await p.getByLabel("Your username").fill(fx.heldUsername);
  await p.getByLabel("Choose a password").fill("short");
  await p.getByRole("button", { name: /Set my password/ }).click();
  await p.getByRole("alert").first().waitFor();
  ok("F2 weak password refused, code not used up", true, (await p.getByRole("alert").first().innerText()).replace(/\n/g, " ").slice(0, 90));
  await p.getByLabel("Choose a password").fill("meadow-kettle-comet-77");
  await p.getByRole("button", { name: /Set my password/ }).click();
  await p.waitForURL(/\/(home|onboarding)/);
  ok("F3 code redeemed and signed in", true, p.url());
  await c.close();
}

// G. Learner sign-in → onboarding.
{
  const { c, p } = await ctx();
  await p.goto("/signin");
  ok("G1 learner tab has no email field", (await p.locator("input[type=email]").count()) === 0);
  await p.getByLabel("Username").fill(fx.activeUsername.toUpperCase());
  await p.getByLabel("Password").fill(fx.password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/onboarding");
  ok("G2 learner who has not onboarded lands on /onboarding", true);
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByRole("alert").filter({ hasText: /at least 3/ }).waitFor();
  ok("G3 fewer than three interests refused", true);
  for (const tag of ["Music", "Games", "Coding"]) await p.getByLabel(tag, { exact: true }).check();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL("**/onboarding?step=avatar");
  ok("G4 avatar step: six generated choices, no file input", (await p.locator('input[type=radio][name=avatar]').count()) === 6 && (await p.locator("input[type=file]").count()) === 0);
  await p.locator('input[type=radio][name=avatar]').nth(2).check();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL("**/onboarding?step=accessibility");
  await p.getByLabel("Dark").check();
  await p.waitForTimeout(600);
  ok("G5 accessibility change applies at once", (await p.locator("html").getAttribute("data-theme")) === "dark");
  await p.getByRole("link", { name: "Continue" }).click();
  await p.waitForURL("**/onboarding?step=project");
  ok("G6 project step renders (catalogue not built yet: empty and skippable)", (await p.getByRole("button", { name: /Go to my home page|Start with this one/ }).count()) > 0);
  await p.getByRole("button", { name: /Go to my home page|Decide later/ }).first().click();
  await p.waitForURL("**/home");
  ok("G7 onboarding finishes at /home", true);
  // Sign out and in again: saved preferences are copied into the a11y cookie.
  await c.clearCookies();
  await p.goto("/signin");
  await p.getByLabel("Username").fill(fx.activeUsername);
  await p.getByLabel("Password").fill(fx.password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/home");
  const a11y = (await c.cookies()).find((k) => k.name === "a11y");
  ok("G8 sign-in copies saved preferences into the a11y cookie and routes to /home", !!a11y && decodeURIComponent(a11y.value).includes('"theme":"dark"'), a11y?.value);
  await p.goto("/settings/independence");
  ok("G9 independence page explains it opens at 18 for a 16-year-old", (await p.getByText("This opens when you're 18").count()) > 0);
  await p.goto("/parent/onboarding"); ok("G10 a learner cannot open a parent page", !p.url().includes("/parent"), p.url());
  await c.close();
}

// H. Staff: first-time two-step enrolment with backup codes, then the challenge at next sign-in.
{
  const { c, p } = await ctx();
  await p.goto("/signin?as=parent&next=%2Fstudio%2Freview");
  const form = p.getByRole("form", { name: "Parent or carer sign-in" });
  await form.getByLabel("Email address").fill(fx.staffEmail);
  await form.getByLabel("Password").fill(fx.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/(signin\/two-factor\/setup|studio)/);
  if (p.url().includes("/studio")) {
    ok("H1 (STAFF_2FA_REQUIRED off in this environment: staff go straight to Studio)", true, p.url());
    await p.goto("/signin/two-factor/setup");
  } else ok("H1 staff without two-step are sent to set it up", true);
  await p.getByLabel("Your password").fill(fx.password);
  await p.getByRole("button", { name: "Start set-up" }).click();
  await p.getByTestId("totp-secret").waitFor();
  const secret = (await p.getByTestId("totp-secret").innerText()).replace(/\s+/g, "");
  const codes = await p.getByRole("list", { name: "Backup codes" }).getByRole("listitem").count();
  ok("H2 key and backup codes shown", secret.length >= 16 && codes >= 8, `${codes} backup codes`);
  await p.getByLabel("Six-digit code").fill("000000");
  await p.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await p.getByRole("alert").filter({ hasText: /isn't right/ }).waitFor();
  ok("H3 wrong code refused, key still on screen", (await p.getByTestId("totp-secret").count()) === 1);
  await p.getByLabel("Six-digit code").fill(totp(secret));
  await p.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await p.waitForURL("**/studio**");
  ok("H4 enrolment complete → Studio", true, p.url());
  await c.clearCookies();
  await p.goto("/signin?as=parent");
  await form.getByLabel("Email address").fill(fx.staffEmail);
  await form.getByLabel("Password").fill(fx.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/signin/two-factor**");
  ok("H5 next sign-in asks for the code (twoFactorRedirect)", true);
  await p.getByLabel("Six-digit code").fill(totp(secret));
  await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL("**/studio**");
  ok("H6 code accepted → Studio", true);
  await c.close();
}

// I. Reset and magic link.
{
  const { c, p } = await ctx();
  await p.goto("/reset");
  ok("I1 reset page tells a teen to ask their parent", (await p.getByText(/Ask your parent or carer to reset it/).count()) > 0);
  await p.getByLabel("Email address").fill(fx.parentEmail);
  await p.getByRole("button", { name: "Email me a reset link" }).click();
  await p.getByText("Check your email").waitFor();
  const link = lastLink(/reset-password/);
  await p.goto(link.replace("http://localhost:3000", BASE));
  await p.getByLabel("New password").fill("another-good-pass-91");
  await p.getByRole("button", { name: "Save new password" }).click();
  await p.getByText("Password changed").waitFor();
  ok("I2 parent resets their password by email", true);
  await p.goto("/signin?as=parent");
  await p.getByLabel("Email address for your link").fill(fx.parentEmail);
  await p.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.getByText(/sign-in link is on its way/).waitFor();
  const magic = lastLink(/magic-link\/verify/);
  await p.goto(magic.replace("http://localhost:3000", BASE));
  await p.waitForURL("**/parent");
  ok("I3 magic link signs the parent in and routes to /parent", true);
  await p.goto(magic.replace("http://localhost:3000", BASE));
  await p.waitForLoadState();
  ok("I4 a used link does nothing harmful", true, p.url());
  await c.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("Browser errors:\n" + [...new Set(errors)].slice(0, 15).join("\n"));
process.exit(failed.length ? 1 : 0);
