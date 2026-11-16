import { describe, expect, it } from "vitest";
import { DEFAULT_CREDIT_PRICING, costMillipence, creditsForCost, creditsToCommit, energyPercent, estimateCredits, estimateTokens, spendLevel } from "@/server/ai/cost";

const prices = { inputPencePerMillionTokens: 240, outputPencePerMillionTokens: 1200 };

describe("cost maths", () => {
  it("costs a call in millipence, rounded up", () => {
    // 2,000 in at 240p/M = 0.48p; 300 out at 1200p/M = 0.36p; 0.84p = 840 millipence.
    expect(costMillipence({ inputTokens: 2000, outputTokens: 300 }, prices)).toBe(840);
    expect(costMillipence({ inputTokens: 1, outputTokens: 0 }, prices)).toBe(1);
    expect(costMillipence({ inputTokens: 0, outputTokens: 0 }, prices)).toBe(0);
    expect(costMillipence({ inputTokens: 1000, outputTokens: 1000 }, { inputPencePerMillionTokens: 0, outputPencePerMillionTokens: 0 })).toBe(0);
  });

  it("does not round up floating-point dust", () => {
    // 0.1 + 0.2 style sums must not become one millipence more.
    expect(costMillipence({ inputTokens: 1000, outputTokens: 2000 }, { inputPencePerMillionTokens: 100, outputPencePerMillionTokens: 100 })).toBe(300);
  });

  it("ignores negative or broken token counts", () => {
    expect(costMillipence({ inputTokens: -5, outputTokens: Number.NaN }, prices)).toBe(0);
  });

  it("turns cost into credits with the 1.3× margin at 0.1p a credit", () => {
    // 840 millipence = 0.84p; × 1.3 = 1.092p; ÷ 0.1p = 10.92 → 11 credits.
    expect(creditsForCost(840)).toBe(11);
    expect(creditsForCost(100)).toBe(2); // 0.1p × 1.3 = 0.13p → 2
    expect(creditsForCost(77)).toBe(2); // 0.077p × 1.3 = 0.1001p → just over one credit → 2
    expect(creditsForCost(76)).toBe(1); // 0.0988p → 1
  });

  it("never charges less than the minimum, and the fixture model costs exactly the minimum", () => {
    expect(creditsForCost(0)).toBe(1);
    expect(creditsForCost(0, { ...DEFAULT_CREDIT_PRICING, minimumCredits: 3 })).toBe(3);
    expect(creditsForCost(1, { ...DEFAULT_CREDIT_PRICING, minimumCredits: 0 })).toBe(1);
  });

  it("uses the configured credit value and margin", () => {
    expect(creditsForCost(1000, { creditValuePence: 0.5, creditMargin: 2, minimumCredits: 1 })).toBe(4);
    // A margin below 1 is treated as 1: credits never undercut cost.
    expect(creditsForCost(1000, { creditValuePence: 1, creditMargin: 0.5, minimumCredits: 1 })).toBe(1);
  });

  it("estimates the reservation as an upper bound across two attempts", () => {
    const estimate = estimateCredits({ promptChars: 8000, maxOutputTokens: 300, attempts: 2 }, prices);
    expect(estimate.millipence).toBe(840 * 2);
    expect(estimate.credits).toBe(creditsForCost(1680));
    expect(estimateCredits({ promptChars: 8000, maxOutputTokens: 300 }, { inputPencePerMillionTokens: 0, outputPencePerMillionTokens: 0 }).credits).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("commits no more than was reserved and releases the rest", () => {
    expect(creditsToCommit(25, 840)).toBe(11);
    expect(creditsToCommit(5, 840)).toBe(5);
    expect(creditsToCommit(1, 0)).toBe(1);
    expect(creditsToCommit(0, 840)).toBe(0);
  });

  it("spend levels: alert from 80%, tripped from 100%", () => {
    const cap = 2000; // pence
    expect(spendLevel(1_599_999, cap)).toBe("ok");
    expect(spendLevel(1_600_000, cap)).toBe("alert");
    expect(spendLevel(1_999_999, cap)).toBe("alert");
    expect(spendLevel(2_000_000, cap)).toBe("tripped");
    expect(spendLevel(0, 0)).toBe("tripped");
  });

  it("the energy meter is a whole number from 0 to 100 with no money in it", () => {
    expect(energyPercent(25, 50)).toBe(50);
    expect(energyPercent(0, 50)).toBe(0);
    expect(energyPercent(80, 50)).toBe(100);
    expect(energyPercent(0, 0)).toBe(0);
  });
});
