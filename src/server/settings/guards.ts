import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { computeLaunchReadiness } from "./launch-readiness";
import type { SettingKey, SettingValue } from "./registry";
import { getSetting } from "./store";

/**
 * Guards that ship with the settings system. `setSetting` runs the one for a key before saving,
 * then any added with `registerSettingGuard`. A guard throws an `AppError` to refuse the change.
 */
export type BuiltInGuards = { [K in SettingKey]?: (ctx: Ctx, value: SettingValue<K>) => Promise<void> };

const hasText = (value: string | null): boolean => typeof value === "string" && value.trim().length > 0;

export const BUILT_IN_GUARDS: BuiltInGuards = {
  /** Decision D2: sign-up cannot open while any launch-readiness item is outstanding. Closing is always allowed. */
  "site.signup_open": async (ctx, open) => {
    if (!open) return;
    const readiness = await computeLaunchReadiness(ctx);
    if (readiness.ready) return;
    const outstanding = readiness.outstanding.map((item) => item.label);
    throw new AppError(
      "not_ready",
      `Sign-up can't be opened yet. Still to do on the launch-readiness checklist: ${outstanding.join("; ")}.`,
      { detail: { outstanding: readiness.outstanding.map((item) => item.key) } },
    );
  },

  /** Spec Section 9: deputy escalation stays off until a deputy is named. */
  "safeguarding.deputy_escalation_enabled": async (ctx, enabled) => {
    if (!enabled) return;
    if (!hasText(await getSetting(ctx, "safeguarding.deputy_name"))) {
      throw new AppError(
        "not_ready",
        "Name a deputy or outsourced cover in Settings → Safeguarding before switching on escalation to the deputy.",
      );
    }
  },

  /** The other half of the rule above: the deputy cannot be removed while escalation still points at them. */
  "safeguarding.deputy_name": async (ctx, name) => {
    if (hasText(name)) return;
    if (await getSetting(ctx, "safeguarding.deputy_escalation_enabled")) {
      throw new AppError(
        "conflict",
        "Switch off escalation to the deputy before removing the deputy's name.",
      );
    }
  },

  "radar.score_weights": async (_ctx, weights) => {
    const values = Object.values(weights);
    if (values.some((v) => !Number.isFinite(v) || v < 0)) {
      throw new AppError("invalid_input", "Each score weight must be zero or more.");
    }
    const total = values.reduce((sum, v) => sum + v, 0);
    if (Math.abs(total - 100) > 1e-6) {
      throw new AppError(
        "invalid_input",
        `The score weights must add up to 100. They currently add up to ${Number(total.toFixed(2))}.`,
      );
    }
  },
};
