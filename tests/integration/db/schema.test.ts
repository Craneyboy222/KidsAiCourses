import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/env";
import { PATHWAYS, SAFETY_BANDS, STAFF_ROLES, USER_STATUSES } from "@/server/authz/actor";
import * as schema from "@/server/db/schema";
import { APPEND_ONLY_TABLES, withAppendOnlyMaintenance } from "@/server/db/append-only";
import { runMigrations } from "@/server/db/migrate";
import { closeDb, db, resetDb } from "../../helpers/db";
import {
  createConsentDefinition,
  createFamily,
  createInviteCode,
  createLearner,
  createParent,
  createParentControl,
  createParentLinkRequest,
  createStaff,
  createUsageDay,
  recordConsent,
} from "../../helpers/factories";

const {
  account,
  aiProcessor,
  auditLog,
  authRateLimit,
  consentDefinition,
  consentRecord,
  course,
  courseVersion,
  creditBalance,
  creditLedger,
  family,
  familyMember,
  inviteCode,
  learnerProfile,
  parentControl,
  parentLinkRequest,
  session,
  staffRole,
  tool,
  twoFactor,
  usageDay,
  user,
  verification,
} = schema;

/** Runs a statement that should be refused and returns the Postgres error message. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
  throw new Error("Expected the database to refuse the statement, but it succeeded");
}

async function count(table: PgTable): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.n ?? 0;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("migrations", () => {
  it("applied every migration in the journal", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.length).toBeGreaterThanOrEqual(2);
    const applied = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied[0]?.n).toBe(journal.entries.length);
  });

  it("created every table declared in the Drizzle schema, and nothing else", async () => {
    const declared = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => value instanceof PgTable)
      .map((table) => getTableConfig(table).name)
      .sort();
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const actual = Array.from(rows, (r) => r.tablename).sort();
    expect(actual).toEqual(declared);
    expect(declared.length).toBe(90);
  });

  it("is a no-op when run again", async () => {
    await expect(runMigrations(env.DATABASE_URL)).resolves.toBeUndefined();
  });

  it("created no table for a future addition (spec Section 19)", async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = Array.from(rows, (r) => r.tablename);
    for (const banned of [
      "school",
      "class",
      "teacher",
      "badge",
      "xp",
      "streak",
      "leaderboard",
      "gallery",
      "playground",
    ]) {
      expect(names.filter((n) => n.includes(banned))).toEqual([]);
    }
  });

  it("uses exactly the enum values defined in authz/actor.ts", async () => {
    const valuesOf = async (typeName: string) => {
      const rows = await db.execute<{ v: string }>(
        sql`select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${typeName} order by e.enumsortorder`,
      );
      return Array.from(rows, (r) => r.v);
    };
    expect(await valuesOf("user_status")).toEqual([...USER_STATUSES]);
    expect(await valuesOf("safety_band")).toEqual([...SAFETY_BANDS]);
    expect(await valuesOf("pathway")).toEqual([...PATHWAYS]);
    expect(await valuesOf("staff_role_name")).toEqual([...STAFF_ROLES]);
  });

  it("gives every table a uuid primary key that the database generates", async () => {
    const rows = await db.execute<{
      table_name: string;
      data_type: string;
      column_default: string | null;
    }>(sql`
      select c.table_name, c.data_type, c.column_default
      from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'id'`);
    expect(rows.length).toBe(90);
    for (const row of rows) {
      expect(row.data_type, row.table_name).toBe("uuid");
      expect(row.column_default, row.table_name).toBe("gen_random_uuid()");
    }
  });

  it("stores every time as timestamptz", async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp without time zone'`);
    expect(Array.from(rows)).toEqual([]);
  });

  it("indexes every learner_id and user_id column", async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select c.table_name, c.column_name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.column_name in ('learner_id', 'user_id')
        and not exists (
          select 1
          from pg_index i
          join pg_class t on t.oid = i.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
          where n.nspname = 'public' and t.relname = c.table_name and a.attname = c.column_name
        )`);
    // Leading column of at least one index, so a look-up by learner never scans the table.
    expect(Array.from(rows)).toEqual([]);
  });
});

describe("identity tables", () => {
  it("accepts a row in every identity table through the factories", async () => {
    const { family: fam, parent, parentActor } = await createFamily();
    const secondParent = await createParent({ familyId: fam.id });
    const learner = await createLearner({ age: 14, familyId: fam.id, password: "orbit-lantern-walrus-42" });
    const pendingTeen = await createLearner({ age: 16, status: "pending_parent" });
    const staff = await createStaff({ roles: ["editor", "reviewer"] });

    await createInviteCode({ familyId: fam.id, learnerId: learner.user.id, createdBy: parent.id });
    await createParentLinkRequest({ learnerId: pendingTeen.user.id });
    const definition = await createConsentDefinition({ key: "ai_processing" });
    await recordConsent({
      learnerId: learner.user.id,
      actorUserId: parent.id,
      familyId: fam.id,
      consentKey: definition.key,
      consentVersion: definition.version,
    });
    await createParentControl({ learnerId: learner.user.id, familyId: fam.id, dailyMinutesCap: 60 });
    await createUsageDay({ learnerId: learner.user.id, seconds: 120 });

    // The Better Auth tables that the factories do not reach.
    await db.insert(session).values({
      userId: learner.user.id,
      token: "test-session-token",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .insert(verification)
      .values({ identifier: "test", value: "v", expiresAt: new Date(Date.now() + 60_000) });
    await db
      .insert(twoFactor)
      .values({ userId: staff.user.id, secret: "enc-secret", backupCodes: "enc-codes" });
    await db.insert(authRateLimit).values({ key: "ip|/sign-in/username", count: 1, lastRequest: Date.now() });

    expect(await count(user)).toBe(5);
    expect(await count(account)).toBe(1); // only the learner was given a password
    expect(await count(session)).toBe(1);
    expect(await count(verification)).toBe(1);
    expect(await count(twoFactor)).toBe(1);
    expect(await count(authRateLimit)).toBe(1);
    expect(await count(staffRole)).toBe(2);
    expect(await count(learnerProfile)).toBe(2);
    expect(await count(family)).toBe(1);
    expect(await count(familyMember)).toBe(3);
    expect(await count(parentLinkRequest)).toBe(1);
    expect(await count(inviteCode)).toBe(1);
    expect(await count(consentDefinition)).toBe(1);
    expect(await count(consentRecord)).toBe(1);
    expect(await count(parentControl)).toBe(1);
    expect(await count(usageDay)).toBe(1);

    // Actors come back ready to use.
    expect(parentActor).toEqual({ type: "parent", userId: parent.id, familyId: fam.id, status: "active" });
    expect(secondParent.actor.familyId).toBe(fam.id);
    expect(learner.actor).toMatchObject({
      type: "learner",
      familyId: fam.id,
      age: 14,
      safetyBand: "teen_13_15",
    });
    expect(learner.profile.pathway).toBe("ks3");
    expect(pendingTeen.actor).toMatchObject({
      familyId: null,
      age: 16,
      safetyBand: "teen_16_17",
      status: "pending_parent",
    });
    expect(staff.actor).toMatchObject({
      type: "staff",
      roles: ["editor", "reviewer"],
      twoFactorVerified: true,
    });
  });

  it("gives a learner a non-routable placeholder email, and parents and staff their real one", async () => {
    const { parent } = await createFamily({ email: "Priya@Example.Test" });
    const learner = await createLearner();
    expect(parent.email).toBe("priya@example.test");
    expect(learner.user.email).toMatch(/^[0-9a-f-]{36}@learner\.invalid$/);
    expect(learner.user.emailVerified).toBe(true);
    expect(learner.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The placeholder never uses the user id.
    expect(learner.user.email.startsWith(learner.user.id)).toBe(false);
  });

  it("refuses a placeholder email on anything but a learner", async () => {
    const message = await refusal(() =>
      db.insert(user).values({ kind: "parent", name: "X", email: "abc@learner.invalid" }),
    );
    expect(message).toContain("user_placeholder_email_learner_only");
  });

  it("treats usernames as case-insensitive and unique", async () => {
    await createLearner({ username: "maya_k" });
    await expect(createLearner({ username: "MAYA_K" })).rejects.toMatchObject({ code: "conflict" });
    const found = await db.select({ id: user.id }).from(user).where(eq(user.username, "Maya_K"));
    expect(found).toHaveLength(1);
  });

  it("refuses to create an account for an under-13 through the factory", async () => {
    await expect(createLearner({ age: 12 })).rejects.toThrow(/Under-13s cannot have an account/);
    expect(await count(user)).toBe(0);
  });

  it("allows one family per account", async () => {
    const { family: famA } = await createFamily();
    const { family: famB } = await createFamily();
    const learner = await createLearner({ familyId: famA.id });
    const message = await refusal(() =>
      db.insert(familyMember).values({ familyId: famB.id, userId: learner.user.id, role: "learner" }),
    );
    expect(message).toContain("family_member_user_uq");
  });

  it("removes a learner's own rows when the account is deleted", async () => {
    const { family: fam } = await createFamily();
    const learner = await createLearner({ familyId: fam.id });
    await createParentControl({ learnerId: learner.user.id, familyId: fam.id });
    await createUsageDay({ learnerId: learner.user.id });
    await db.delete(user).where(eq(user.id, learner.user.id));
    expect(await count(learnerProfile)).toBe(0);
    expect(await count(parentControl)).toBe(0);
    expect(await count(usageDay)).toBe(0);
    expect(await count(family)).toBe(1);
  });

  it("will not delete a parent who still owns a family", async () => {
    const { parent } = await createFamily();
    const message = await refusal(() => db.delete(user).where(eq(user.id, parent.id)));
    expect(message).toContain("family_owner_user_id_user_id_fk");
  });
});

describe("append-only tables", () => {
  async function seed() {
    const { family: fam, parent } = await createFamily();
    const learner = await createLearner({ familyId: fam.id });
    const consent = await recordConsent({
      learnerId: learner.user.id,
      actorUserId: parent.id,
      familyId: fam.id,
      consentKey: "ai_processing",
    });
    const ledger = (
      await db
        .insert(creditLedger)
        .values({
          learnerId: learner.user.id,
          familyId: fam.id,
          entryType: "grant",
          amount: 50,
          periodKey: "2026-11",
          idempotencyKey: "grant:2026-11:test",
        })
        .returning()
    )[0];
    const audit = (
      await db
        .insert(auditLog)
        .values({
          actorType: "parent",
          actorId: parent.id,
          action: "consent.grant",
          targetType: "learner",
          targetId: learner.user.id,
        })
        .returning()
    )[0];
    if (!ledger || !audit) throw new Error("seed failed");
    return { consent, ledger, audit };
  }

  it("lists exactly the three protected tables", () => {
    expect([...APPEND_ONLY_TABLES].sort()).toEqual(["audit_log", "consent_record", "credit_ledger"]);
  });

  it("refuses UPDATE on consent_record, credit_ledger and audit_log", async () => {
    const { consent, ledger, audit } = await seed();

    expect(
      await refusal(() =>
        db.update(consentRecord).set({ action: "revoked" }).where(eq(consentRecord.id, consent.id)),
      ),
    ).toContain('Table "consent_record" is append-only: UPDATE is not allowed');
    expect(
      await refusal(() =>
        db.update(creditLedger).set({ amount: 5000 }).where(eq(creditLedger.id, ledger.id)),
      ),
    ).toContain('Table "credit_ledger" is append-only: UPDATE is not allowed');
    expect(
      await refusal(() =>
        db.update(auditLog).set({ action: "nothing.happened" }).where(eq(auditLog.id, audit.id)),
      ),
    ).toContain('Table "audit_log" is append-only: UPDATE is not allowed');

    // Nothing changed.
    expect((await db.select().from(consentRecord))[0]?.action).toBe("granted");
    expect((await db.select().from(creditLedger))[0]?.amount).toBe(50);
    expect((await db.select().from(auditLog))[0]?.action).toBe("consent.grant");
  });

  it("refuses DELETE on consent_record, credit_ledger and audit_log", async () => {
    const { consent, ledger, audit } = await seed();

    expect(await refusal(() => db.delete(consentRecord).where(eq(consentRecord.id, consent.id)))).toContain(
      'Table "consent_record" is append-only: DELETE is not allowed',
    );
    expect(await refusal(() => db.delete(creditLedger).where(eq(creditLedger.id, ledger.id)))).toContain(
      'Table "credit_ledger" is append-only: DELETE is not allowed',
    );
    expect(await refusal(() => db.delete(auditLog).where(eq(auditLog.id, audit.id)))).toContain(
      'Table "audit_log" is append-only: DELETE is not allowed',
    );

    expect(await count(consentRecord)).toBe(1);
    expect(await count(creditLedger)).toBe(1);
    expect(await count(auditLog)).toBe(1);
  });

  it("refuses TRUNCATE on all three", async () => {
    await seed();
    for (const table of APPEND_ONLY_TABLES) {
      expect(await refusal(() => db.execute(sql.raw(`TRUNCATE TABLE "${table}"`)))).toContain(
        `Table "${table}" is append-only: TRUNCATE is not allowed`,
      );
    }
    expect(await count(auditLog)).toBe(1);
  });

  it("still accepts new rows", async () => {
    await seed();
    await db
      .insert(auditLog)
      .values({ actorType: "system", actorLabel: "retention.sweep", action: "retention.run" });
    expect(await count(auditLog)).toBe(2);
  });

  it("keeps the records when the learner's account is deleted", async () => {
    const { family: fam, parent } = await createFamily();
    const learner = await createLearner({ familyId: fam.id });
    await recordConsent({ learnerId: learner.user.id, actorUserId: parent.id, consentKey: "ai_processing" });
    await db.delete(user).where(eq(user.id, learner.user.id));
    expect(await count(consentRecord)).toBe(1);
  });

  it("lets the retention job delete, but never update, inside withAppendOnlyMaintenance", async () => {
    const { audit } = await seed();

    const updateMessage = await refusal(() =>
      withAppendOnlyMaintenance(db, "retention", (tx) =>
        tx.update(auditLog).set({ action: "rewritten" }).where(eq(auditLog.id, audit.id)),
      ),
    );
    expect(updateMessage).toContain("UPDATE is not allowed");

    await withAppendOnlyMaintenance(db, "retention", async (tx) => {
      await tx.delete(auditLog).where(eq(auditLog.id, audit.id));
    });
    expect(await count(auditLog)).toBe(0);

    // The bypass ended with that transaction: the next statement is refused again.
    await db.insert(auditLog).values({ actorType: "system", action: "retention.run" });
    expect(await refusal(() => db.delete(auditLog))).toContain("DELETE is not allowed");
  });

  it("ignores a maintenance reason it does not recognise", async () => {
    await seed();
    const message = await refusal(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.append_only_maintenance', 'because-i-said-so', true)`);
        await tx.delete(auditLog);
      }),
    );
    expect(message).toContain("DELETE is not allowed");
  });
});

describe("other database guards", () => {
  it("never lets a session outlive its ceiling or gain a second factor after sign-in", async () => {
    const staff = await createStaff();
    const ceiling = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const inserted = (
      await db
        .insert(session)
        .values({
          userId: staff.user.id,
          token: "staff-token",
          // Better Auth's default would be seven days: the trigger pulls it back.
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          absoluteExpiresAt: ceiling,
        })
        .returning()
    )[0];
    expect(inserted?.expiresAt.getTime()).toBe(ceiling.getTime());
    expect(inserted?.twoFactorVerified).toBe(false);

    // A refresh, or anything else, tries to extend it and to switch the flag on.
    const updated = (
      await db
        .update(session)
        .set({
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          twoFactorVerified: true,
        })
        .where(eq(session.token, "staff-token"))
        .returning()
    )[0];
    expect(updated?.expiresAt.getTime()).toBe(ceiling.getTime());
    expect(updated?.absoluteExpiresAt?.getTime()).toBe(ceiling.getTime());
    expect(updated?.twoFactorVerified).toBe(false);

    // Removing the ceiling is not possible either.
    const cleared = (
      await db
        .update(session)
        .set({ absoluteExpiresAt: null })
        .where(eq(session.token, "staff-token"))
        .returning()
    )[0];
    expect(cleared?.absoluteExpiresAt?.getTime()).toBe(ceiling.getTime());
  });

  it("freezes a course version once it is published", async () => {
    const createdCourse = (
      await db.insert(course).values({ slug: "test-course", title: "Test course" }).returning()
    )[0];
    if (!createdCourse) throw new Error("no course");
    const draft = (
      await db
        .insert(courseVersion)
        .values({ courseId: createdCourse.id, revision: 1, snapshot: { title: "Test course" } })
        .returning()
    )[0];
    if (!draft) throw new Error("no version");

    // A draft can be edited freely.
    await db
      .update(courseVersion)
      .set({ snapshot: { title: "Edited" } })
      .where(eq(courseVersion.id, draft.id));

    await db
      .update(courseVersion)
      .set({ status: "published", publishedAt: new Date(), materialisedAt: new Date() })
      .where(eq(courseVersion.id, draft.id));

    expect(
      await refusal(() =>
        db
          .update(courseVersion)
          .set({ snapshot: { title: "Sneaky edit" } })
          .where(eq(courseVersion.id, draft.id)),
      ),
    ).toContain("is published and immutable");
    expect(
      await refusal(() =>
        db.update(courseVersion).set({ publishedAt: null }).where(eq(courseVersion.id, draft.id)),
      ),
    ).toContain("is published and immutable");

    // Its status may still move on, e.g. when a newer version replaces it.
    await db.update(courseVersion).set({ status: "retired" }).where(eq(courseVersion.id, draft.id));
    const after = (await db.select().from(courseVersion).where(eq(courseVersion.id, draft.id)))[0];
    expect(after?.status).toBe("retired");
    expect(after?.snapshot).toEqual({ title: "Edited" });
  });

  it("keeps revisions unique per course", async () => {
    const createdCourse = (
      await db.insert(course).values({ slug: "rev-course", title: "Revisions" }).returning()
    )[0];
    if (!createdCourse) throw new Error("no course");
    await db.insert(courseVersion).values({ courseId: createdCourse.id, revision: 1, snapshot: {} });
    expect(
      await refusal(() =>
        db.insert(courseVersion).values({ courseId: createdCourse.id, revision: 1, snapshot: {} }),
      ),
    ).toContain("course_version_course_revision_uq");
  });

  it("finds a course by full-text search over its title, tagline and what-you-make", async () => {
    await db.insert(course).values([
      {
        slug: "snap",
        title: "Build Your Own Snapchat-Style App",
        tagline: "Filters, chat and a camera",
        whatYouMake: "A web app",
      },
      {
        slug: "music",
        title: "Make Your Own AI Music Video",
        tagline: "Lights, camera, algorithm",
        whatYouMake: "A music video",
      },
    ]);
    const hits = await db
      .select({ slug: course.slug })
      .from(course)
      .where(sql`${course.search} @@ websearch_to_tsquery('english', ${"music videos"})`);
    expect(hits.map((h) => h.slug)).toEqual(["music"]);
  });

  it("will not let credits be overspent, even by a direct update", async () => {
    const learner = await createLearner();
    await db.insert(creditBalance).values({
      learnerId: learner.user.id,
      periodKey: "2026-11",
      periodStart: new Date("2026-11-01T00:00:00Z"),
      periodEnd: new Date("2026-12-01T00:00:00Z"),
      granted: 50,
      spent: 45,
    });
    expect(
      await refusal(() =>
        db.update(creditBalance).set({ reserved: 6 }).where(eq(creditBalance.learnerId, learner.user.id)),
      ),
    ).toContain("credit_balance_never_overspent");
    await db.update(creditBalance).set({ reserved: 5 }).where(eq(creditBalance.learnerId, learner.user.id));
  });

  it("will not enable a model provider without a recorded approval and DPA (decision D1)", async () => {
    expect(
      await refusal(() =>
        db.insert(aiProcessor).values({ providerKey: "acme", name: "Acme", purpose: "Coach", enabled: true }),
      ),
    ).toContain("ai_processor_enabled_needs_approval");
    await db.insert(aiProcessor).values({
      providerKey: "acme",
      name: "Acme",
      purpose: "Coach",
      enabled: true,
      approvedAt: new Date(),
      dpaReference: "DPA-2026-001",
    });
  });

  it("will not mark a tool parent_operated or approved without the human record", async () => {
    expect(
      await refusal(() =>
        db.insert(tool).values({ slug: "t1", name: "T1", under18Policy: "parent_operated" }),
      ),
    ).toContain("tool_parent_operated_recorded");
    expect(
      await refusal(() => db.insert(tool).values({ slug: "t2", name: "T2", status: "approved" })),
    ).toContain("tool_approved_has_policy");
    // A Radar candidate starts with no policy at all.
    const candidate = (await db.insert(tool).values({ slug: "t3", name: "T3" }).returning())[0];
    expect(candidate?.status).toBe("candidate");
    expect(candidate?.under18Policy).toBeNull();
  });
});
