"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/action";
import { getAuth } from "@/server/auth/auth";
import { getCtx } from "@/server/context";
import { redeemInviteCode } from "@/server/services/invite";
import { endSession, finishSignIn, requestHeaders } from "../_lib/after-sign-in";
import { raw, text } from "../_lib/form";

const joinSchema = z.object({
  code: z.string().trim().min(1, "Enter the code your parent or carer gave you.").max(40),
  username: z.string().trim().min(1, "Enter your username.").max(60),
  password: z.string().min(1, "Choose a password.").max(128),
});

/**
 * A learner uses their one-time code: they choose their own password and are signed in.
 * The code is rate limited and counted by `redeemInviteCode` itself (per caller and per code).
 */
export async function redeemInviteAction(_prev: ActionState<never>, formData: FormData): Promise<ActionState<never>> {
  return runAction(async () => {
    const ctx = await getCtx();
    const input = joinSchema.parse({ code: text(formData, "code"), username: text(formData, "username"), password: raw(formData, "password") });
    // Whoever was signed in on this device before, the code is for one learner only.
    const anonymous = { ...ctx, actor: { type: "anonymous" as const } };
    const { learnerId } = await redeemInviteCode(anonymous, input);
    await endSession();
    try {
      await getAuth().api.signInUsername({ body: { username: input.username, password: input.password }, headers: await requestHeaders() });
    } catch {
      // The password is set; they can sign in by hand.
      redirect("/signin?as=learner&notice=joined");
    }
    return finishSignIn(learnerId);
  });
}
