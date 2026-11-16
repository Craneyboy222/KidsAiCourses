"use server";

import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { requireLearner } from "@/server/context";
import { rateLimit } from "@/server/ratelimit";
import { setCertificateName, type CertificateNameSettings } from "@/server/services/certificate";

const schema = z.object({ choice: z.enum(["nickname", "first_name"]), firstName: z.string().max(60).optional() });

/** The learner chooses the name on their future certificates: nickname (the default) or first name. */
export async function setCertificateNameAction(_prev: ActionState<CertificateNameSettings>, formData: FormData): Promise<ActionState<CertificateNameSettings>> {
  return runAction(async () => {
    const ctx = await requireLearner();
    const input = schema.parse(Object.fromEntries(formData));
    await rateLimit(ctx, "certificate.name", { limit: 20, windowSec: 3600 });
    return setCertificateName(ctx, ctx.actor.userId, input);
  });
}
