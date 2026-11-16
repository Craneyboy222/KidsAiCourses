import { formatDate } from "@/lib/dates";
import type { EnergyView } from "@/server/ai/types";
import { ProgressBar } from "@/components/ui";

/**
 * Coach "energy": a simple meter. It never shows money, because learners never see prices
 * (spec 3.5). When it runs out, the copy points to a parent or carer rather than to a checkout.
 */
export function EnergyMeter({ energy }: { energy: EnergyView }) {
  const text = `${energy.balance} of ${energy.monthlyAllowance} left`;
  return (
    <div data-testid="coach-energy" className="flex flex-col gap-1">
      <ProgressBar label="Coach energy" value={energy.balance} max={Math.max(1, energy.monthlyAllowance)} valueText={text} />
      <p className="text-ink-muted text-sm">
        Each answer from Coach uses a little energy. It tops up on {formatDate(energy.resetsAt)}. Hints on the step are always free.
      </p>
    </div>
  );
}
