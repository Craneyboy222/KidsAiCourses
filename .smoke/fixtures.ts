import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { createInviteCode } from "@/server/services/invite";
import { CONSENT_HOLD } from "@/server/services/consent";
import { createLearner, createParent, createStaff, TEST_PASSWORD } from "../tests/helpers/factories";

async function main() {
  const tag = process.argv[2] ?? "a";
  const parent = await createParent({ email: `smoke-parent-${tag}@example.test`, password: TEST_PASSWORD });
  const held = await createLearner({ familyId: parent.family.id, username: `held_heron_${tag}`, nickname: "Maya", status: "paused", age: 14 });
  await db.update(user).set({ statusReason: CONSENT_HOLD.required }).where(eq(user.id, held.user.id));
  const invite = await createInviteCode({ now: new Date() }, { learnerId: held.user.id, familyId: parent.family.id, createdBy: parent.user.id }, db);
  const active = await createLearner({ familyId: parent.family.id, username: `lively_lynx_${tag}`, nickname: "Josh", password: TEST_PASSWORD, age: 16, interests: [] });
  const staff = await createStaff({ email: `smoke-staff-${tag}@example.test`, password: TEST_PASSWORD, roles: ["editor"] });
  console.log(JSON.stringify({ parentEmail: parent.user.email, heldId: held.user.id, heldUsername: `held_heron_${tag}`, inviteCode: invite.formatted, activeUsername: `lively_lynx_${tag}`, staffEmail: staff.user.email, password: TEST_PASSWORD }));
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
