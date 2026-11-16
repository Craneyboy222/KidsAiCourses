import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { SEED_TOTP_SECRET, formatSeedResult, runSeed, type SeedResult } from "../../../scripts/seed";
import { closeDb, db, resetDb } from "../../helpers/db";

/**
 * The whole seed, twice, against a real database. Placeholder media is switched off here (it has
 * its own test and would write into the shared local storage folder).
 */

/** Tables that legitimately grow when the seed is run again: logs of what was done, not seeded data. */
const LOG_TABLES = new Set(["audit_log", "job_run", "rate_limit_bucket", "auth_rate_limit", "metric_counter"]);

async function tableCounts(): Promise<Record<string, number>> {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    const rows = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${tablename.replace(/"/g, '""')}"`));
    counts[tablename] = rows[0]?.n ?? 0;
  }
  return counts;
}

let first: SeedResult;
let second: SeedResult;
let afterFirst: Record<string, number>;
let afterSecond: Record<string, number>;
const lines: string[] = [];

beforeAll(async () => {
  await resetDb();
  first = await runSeed({ assets: false, log: (line) => lines.push(line) });
  afterFirst = await tableCounts();
  second = await runSeed({ assets: false, log: (line) => lines.push(line) });
  afterSecond = await tableCounts();
}, 300_000);
afterAll(closeDb);

describe("pnpm db:seed", () => {
  it("runs on an empty database with nothing failing", () => {
    expect(first.problems).toEqual([]);
    expect(first.signupOpen).toBe(true);
  });

  it("runs a second time without error", () => {
    expect(second.problems).toEqual([]);
  });

  it("creates no duplicates on the second run", () => {
    const changed = Object.keys(afterSecond).filter((table) => !LOG_TABLES.has(table) && afterSecond[table] !== afterFirst[table]);
    expect(Object.fromEntries(changed.map((table) => [table, [afterFirst[table], afterSecond[table]]]))).toEqual({});
  });

  it("creates the owner, one account per staff role, two families, an adult learner and a pending teen", async () => {
    const roles = await db.execute<{ role: string; n: number }>(sql`select role::text as role, count(*)::int as n from staff_role group by role order by role`);
    expect(Object.fromEntries(Array.from(roles, (row) => [row.role, row.n]))).toEqual({ admin: 1, dsl: 1, editor: 1, moderator: 1, reviewer: 1, safety_reviewer: 1, super_admin: 1, support: 1 });
    const users = await db.execute<{ kind: string; status: string; n: number }>(sql`select kind, status::text as status, count(*)::int as n from "user" group by kind, status order by kind, status`);
    expect(Array.from(users, (row) => `${row.kind}/${row.status}:${row.n}`)).toEqual(["learner/active:5", "learner/pending_parent:1", "parent/active:2", "staff/active:8"]);
    const families = await db.execute<{ plan: string; level: string }>(sql`select f.plan, f.age_assurance_level::text as level from family f join "user" u on u.id = f.owner_user_id where u.kind = 'parent' order by f.plan`);
    expect(Array.from(families, (row) => `${row.plan}:${row.level}`)).toEqual(["family:paid_subscription", "free:card_authorisation"]);
  });

  it("seeds learners aged 13, 15, 16, 17 and 18 with complete consent", async () => {
    const bands = await db.execute<{ band: string; n: number }>(sql`select p.safety_band::text as band, count(*)::int as n from learner_profile p join "user" u on u.id = p.user_id where u.status = 'active' group by 1 order by 1`);
    expect(Object.fromEntries(Array.from(bands, (row) => [row.band, row.n]))).toEqual({ adult_18: 1, teen_13_15: 2, teen_16_17: 2 });
    const consents = await db.execute<{ n: number }>(sql`select count(distinct learner_id)::int as n from consent_record where action = 'granted'`);
    expect(consents[0]?.n).toBe(5);
  });

  it("enrols every staff account in two-step sign-in", async () => {
    const rows = await db.execute<{ staff: number; enrolled: number }>(sql`select count(*)::int as staff, count(*) filter (where u.two_factor_enabled and exists (select 1 from two_factor t where t.user_id = u.id))::int as enrolled from "user" u where u.kind = 'staff'`);
    expect(rows[0]).toEqual({ staff: 8, enrolled: 8 });
    // The secret is stored encrypted, never as it is printed.
    const leaked = await db.execute<{ n: number }>(sql`select count(*)::int as n from two_factor where secret like ${`%${SEED_TOTP_SECRET}%`}`);
    expect(leaked[0]?.n).toBe(0);
  });

  it("publishes every course through a real review decision, and leaves one AI draft in review", async () => {
    const courses = await db.execute<{ status: string; origin: string; n: number }>(sql`select status::text as status, origin::text as origin, count(*)::int as n from course group by 1, 2 order by 1, 2`);
    const byStatus = Object.fromEntries(Array.from(courses, (row) => [`${row.origin}/${row.status}`, row.n]));
    expect(byStatus["ai_on_demand/in_review"]).toBe(1);
    expect(byStatus["hand_made/published"]).toBeGreaterThanOrEqual(5);
    const unapproved = await db.execute<{ n: number }>(sql`select count(*)::int as n from course c where c.status = 'published' and not exists (select 1 from review_decision d where d.course_version_id = c.published_version_id and d.decision = 'approve')`);
    expect(unapproved[0]?.n).toBe(0);
  });

  it("seeds the ideas backlog, plans, promo samples, tags and retention policies", () => {
    expect(afterFirst.course_idea).toBe(175);
    expect(afterFirst.plan).toBe(2);
    expect(afterFirst.promo_code).toBe(3);
    expect(afterFirst.tag).toBe(40);
    expect(afterFirst.retention_policy).toBe(11);
    expect(afterFirst.consent_definition).toBe(5);
  });

  it("adds ten candidate tools to verify, with no age or under-18 policy guessed and no course using them", async () => {
    const rows = await db.execute<{ status: string; n: number; guessed: number; used: number }>(sql`
      select status, count(*)::int as n,
        count(*) filter (where min_age is not null or under18_policy is not null)::int as guessed,
        count(*) filter (where exists (select 1 from course_tool ct where ct.tool_id = tool.id or ct.fallback_tool_id = tool.id))::int as used
      from tool group by status`);
    expect(rows.find((row) => row.status === "candidate")).toMatchObject({ n: 10, guessed: 0, used: 0 });
    expect(rows.find((row) => row.status === "approved")?.n).toBe(5);
  });

  it("prints the local two-step secret against every staff account in the table", () => {
    const staffRows = second.accounts.filter((row) => row.kind.startsWith("staff:"));
    expect(staffRows).toHaveLength(8);
    for (const row of staffRows) expect(row.notes).toContain(SEED_TOTP_SECRET);
  });

  it("publishes the six legal pages (as drafts, for local use) and, when the marketing slice is present, its marketing and help pages", async () => {
    const rows = await db.execute<{ kind: string; n: number; shown: number }>(sql`select kind::text as kind, count(*)::int as n, count(current_version_id)::int as shown from page group by kind`);
    const of = (kind: string) => rows.find((row) => row.kind === kind) ?? { n: 0, shown: 0 };
    expect(of("legal")).toMatchObject({ n: 6, shown: 6 });
    const pagesSkipped = first.skipped.some((item) => item.includes("import-pages"));
    if (!pagesSkipped) {
      expect(of("marketing").shown).toBeGreaterThanOrEqual(1);
      // Spec Section 15: "about 10 help articles".
      expect(of("help").shown).toBeGreaterThanOrEqual(10);
    }
    expect(second.signupOpen).toBe(true);
  });

  it("leaves realistic learning behind: progress, an accepted and a pending submission, a certificate, moderation examples", async () => {
    expect(afterFirst.enrolment).toBe(6);
    const projects = await db.execute<{ status: string; n: number }>(sql`select status::text as status, count(*)::int as n from project group by 1 order by 1`);
    expect(Object.fromEntries(Array.from(projects, (row) => [row.status, row.n]))).toEqual({ accepted: 2, awaiting_review: 1 });
    expect(afterFirst.certificate).toBe(2);
    const queue = await db.execute<{ state: string; n: number }>(sql`select state::text as state, count(*)::int as n from moderation_item group by 1 order by 1`);
    expect(Object.fromEntries(Array.from(queue, (row) => [row.state, row.n]))).toEqual({ approved: 1, pending: 2 });
    const partWay = await db.execute<{ n: number }>(sql`select count(*)::int as n from enrolment where status = 'active'`);
    expect(partWay[0]?.n).toBeGreaterThanOrEqual(3);
  });

  it("puts one family on the Family plan through the webhook handler, not by writing the plan", async () => {
    const subs = await db.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from subscription group by 1`);
    expect(Array.from(subs, (row) => `${row.status}:${row.n}`)).toEqual(["active:1"]);
    const events = await db.execute<{ n: number }>(sql`select count(*)::int as n from stripe_event where status = 'processed'`);
    expect(events[0]?.n).toBeGreaterThanOrEqual(5);
  });

  it("says which parts were skipped because they are not built, and prints no password", () => {
    const table = formatSeedResult(second);
    expect(table).toContain("parent.family@example.test");
    expect(table).toContain("neon_badger");
    expect(table).toContain("SEED_PASSWORD");
    expect(table).not.toContain(process.env.SEED_PASSWORD ?? "no-seed-password-set");
    for (const item of second.skipped) expect(lines.some((line) => line.startsWith("skipped: ") && line.includes("not built yet")), item).toBe(true);
  });
});

describe("pnpm db:seed outside local development", () => {
  it("refuses on a preview deployment and writes nothing", async () => {
    const before = await tableCounts();
    const saved = { APP_ENV: process.env.APP_ENV, STAFF_2FA_REQUIRED: process.env.STAFF_2FA_REQUIRED };
    process.env.APP_ENV = "preview";
    process.env.STAFF_2FA_REQUIRED = "true";
    resetEnvCache();
    try {
      await expect(runSeed({ assets: false, log: () => undefined })).rejects.toThrow(/refuses to run/);
    } finally {
      process.env.APP_ENV = saved.APP_ENV;
      process.env.STAFF_2FA_REQUIRED = saved.STAFF_2FA_REQUIRED;
      resetEnvCache();
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("cannot even load a production configuration that still has a seed password", async () => {
    const saved = { APP_ENV: process.env.APP_ENV, STAFF_2FA_REQUIRED: process.env.STAFF_2FA_REQUIRED };
    process.env.APP_ENV = "production";
    process.env.STAFF_2FA_REQUIRED = "true";
    resetEnvCache();
    try {
      await expect(runSeed({ assets: false, log: () => undefined })).rejects.toThrow(/SEED_PASSWORD must not be set in production/);
    } finally {
      process.env.APP_ENV = saved.APP_ENV;
      process.env.STAFF_2FA_REQUIRED = saved.STAFF_2FA_REQUIRED;
      resetEnvCache();
    }
  });
});
