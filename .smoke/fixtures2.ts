import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { closeDb, db } from "@/server/db/client";
import { systemCtx } from "@/server/context";
import { saveConsents } from "@/server/services/consent";
import { recalculateBands } from "@/server/services/safety-band";
import { createLearner, createParent, TEST_PASSWORD } from "../tests/helpers/factories";

async function main() {
  const tag = process.argv[2] ?? "a";
  const parent = await createParent({ email: `smoke18-parent-${tag}@example.test`, password: TEST_PASSWORD });
  const adult = await createLearner({ familyId: parent.family.id, username: `nimble_raven_${tag}`, nickname: "Josh", password: TEST_PASSWORD, age: 18 });
  await saveConsents({ db, actor: parent.actor, now: new Date(), requestId: "smoke" }, adult.user.id, { choices: { account_learning_data: true, ai_processing: true, third_party_tools: true } });
  await db.update((await import("@/server/db/schema")).learnerProfile).set({ onboardingCompletedAt: new Date() });
  const bands = await recalculateBands(systemCtx("smoke"));
  console.log(JSON.stringify({ username: `nimble_raven_${tag}`, parentEmail: parent.user.email, password: TEST_PASSWORD, bands }));
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
