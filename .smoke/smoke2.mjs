import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3211";
const fx = JSON.parse(process.argv[2]);
const results = [];
const ok = (name, pass, extra = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
function lastLink(pattern) {
  const lines = readFileSync("/tmp/accounts-dev.log", "utf8").split("\n").filter((l) => l.includes('"email.console"'));
  for (const line of lines.reverse()) { try { const hit = (JSON.parse(line).data.links ?? []).find((l) => pattern.test(l)); if (hit) return hit; } catch {} }
  return null;
}
const year = new Date().getFullYear();
const browser = await chromium.launch({ channel: "chrome" });
async function ctx(opts = {}) { const c = await browser.newContext({ baseURL: BASE, ...opts }); return { c, p: await c.newPage() }; }

// J. 18-year-old signing up for themselves.
if (!process.argv.includes("--skip-j")) {
  const { c, p } = await ctx();
  await p.goto("/signup/teen");
  await p.getByLabel("Month").selectOption("3");
  await p.getByLabel("Year").selectOption(String(year - 19));
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByLabel("Email address").waitFor();
  ok("J1 adult route asks for their own email and shows 5 consents, none ticked", (await p.locator('input[name^="consent."]').count()) === 5 && (await p.locator('input[name^="consent."]:checked').count()) === 0);
  const uname = `golden_comet_${Math.floor(Math.random() * 800) + 100}`;
  await p.getByLabel("Username").fill(uname);
  await p.getByLabel("Email address").fill(`adult-${Date.now()}@example.test`);
  await p.getByLabel(/^Password/).fill("meadow-kettle-comet-77");
  await p.getByRole("button", { name: "Create my account" }).click();
  await p.getByRole("alert").filter({ hasText: /required permissions/ }).waitFor();
  ok("J2 refused without the required consents; typed values kept", (await p.getByLabel("Username").inputValue()) === uname);
  for (const label of [/I agree: Account and learning data/, /I agree: Coach/, /I agree: Using tools/]) await p.getByLabel(label).check();
  await p.getByRole("button", { name: "Create my account" }).click();
  await p.getByText("Check your email").waitFor();
  const link = lastLink(/verify-email/);
  await p.goto(link);
  await p.waitForURL("**/onboarding");
  ok("J3 adult learner confirms email and lands on /onboarding", true);
  await c.close();
}

// K. Independence for an 18-year-old in a parent's family.
{
  const { c, p } = await ctx();
  await p.goto("/signin?next=%2Fsettings%2Findependence");
  await p.getByLabel("Username").fill(fx.username);
  await p.getByLabel("Password").fill(fx.password);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/settings/independence");
  ok("K1 next= is honoured for a learner page", true);
  ok("K2 shows 'What my parent can see' and the email form", (await p.getByRole("heading", { name: "What my parent can see" }).count()) === 1 && (await p.getByLabel("Your own email address").count()) === 1);
  const email = `josh-${Date.now()}@example.test`;
  await p.getByLabel("Your own email address").fill(email);
  await p.getByRole("button", { name: "Email me a confirmation link" }).click();
  await p.getByText("Check your email").waitFor();
  const link = lastLink(/settings\/independence\?token=/);
  await p.goto(link.replace("http://localhost:3000", BASE));
  await p.getByText("Your email address is confirmed").waitFor();
  await p.getByRole("button", { name: "Take over my account" }).click();
  await p.waitForTimeout(800);
  ok("K3 nothing happens without ticks (browser or server refuses)", (await p.getByText("Done: your account is yours").count()) === 0);
  for (const label of [/I agree: Account and learning data/, /I agree: Coach/, /I agree: Using tools/]) await p.getByLabel(label).check();
  await p.getByLabel("Have an account of my own").check();
  await p.getByLabel("Yes, I want to run my own account").check();
  await p.getByRole("button", { name: "Take over my account" }).click();
  await p.getByText("Done: your account is yours").waitFor();
  ok("K4 independence confirmed with the parent link removed", (await p.getByText(/no longer sees anything/).count()) > 0 && p.url().includes("done=own"));
  await p.goto("/settings/independence");
  ok("K5 page now says they run their own account", (await p.getByText("You run your own account").count()) > 0 && (await p.getByText(/isn't linked to a parent/).count()) > 0 && (await p.getByText("Done: your account is yours").count()) === 0);
  await c.close();
}

// L. Sign-up closed.
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
