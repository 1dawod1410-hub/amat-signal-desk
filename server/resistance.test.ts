import { describe, expect, it } from "vitest";
import { analyzeResistances, calculateRiskReward, filterResistanceCandidates, findPivotHighs, firstBreakWithinDays, mergeNearbyLevels } from "./resistance";

const bar = (day: number, high: number, close = high - 1) => ({ timestamp: new Date(`2026-01-${String(day).padStart(2, "0")}T15:00:00Z`), open: close - 1, high, close });

describe("resistance analysis", () => {
  it("finds pivot highs only with five bars on both sides", () => {
    const bars = Array.from({ length: 13 }, (_, index) => bar(index + 1, 100));
    bars[6] = bar(7, 120);
    expect(findPivotHighs(bars, 60)).toHaveLength(1);
    expect(findPivotHighs(bars, 60)[0].high).toBe(120);
  });

  it("merges levels within half ATR", () => {
    expect(mergeNearbyLevels([{ price: 110, source: "4H pivot" }, { price: 111, source: "Daily pivot" }, { price: 115, source: "52-week high" }], 3).map((item) => item.sources)).toEqual([["4H pivot", "Daily pivot"], ["52-week high"]]);
  });

  it("calculates resistance risk/reward", () => {
    expect(calculateRiskReward(120, 100, 90)).toBe(2);
    expect(calculateRiskReward(120, 100, 100)).toBeNull();
  });

  it("filters a resistance at 0.3 ATR but keeps one at 0.7 ATR", () => {
    const filtered = filterResistanceCandidates([{ price: 100.3, source: "near" }, { price: 100.7, source: "valid" }], 100, 1);
    expect(filtered.map((level) => level.source)).toEqual(["valid"]);
  });

  it("adds the narrow-upside warning below 1.5R", () => {
    const fourHour = Array.from({ length: 20 }, (_, index) => bar(index + 1, 100)); fourHour[10] = bar(11, 104);
    const daily = Array.from({ length: 130 }, (_, index) => bar((index % 28) + 1, 100)); daily[70] = bar(15, 112);
    const analysis = analyzeResistances({ currentPrice: 100, demandLow: 95, demandHigh: 99, stopLoss: 95, fourHourBars: fourHour, dailyBars: daily });
    expect(analysis.levels[0].riskReward).toBeLessThan(1.5);
    expect(analysis.warning).toBe(true);
  });

  it("records the first broken level at a checkpoint", () => {
    const daily = [bar(1, 105), bar(2, 115), bar(3, 130)];
    expect(firstBreakWithinDays({ dailyBars: daily, resistanceLevels: [110], relativeTargets: [120], days: 3 })).toBe("مقاومة $110.00");
    expect(firstBreakWithinDays({ dailyBars: daily.slice(1), resistanceLevels: [125], relativeTargets: [120], days: 2 })).toBe("هدف نسبي 1");
  });

  it("reports no first level when every filtered resistance is below 1.5R", () => {
    const fourHour = Array.from({ length: 20 }, (_, index) => ({ ...bar(index + 1, 100), low: 99 })); fourHour[10] = { ...bar(11, 104), low: 103 };
    const daily = Array.from({ length: 130 }, (_, index) => ({ ...bar((index % 28) + 1, 100), low: 99 })); daily[70] = { ...bar(15, 104), low: 103 };
    const analysis = analyzeResistances({ currentPrice: 100, demandLow: 95, demandHigh: 99, stopLoss: 95, fourHourBars: fourHour, dailyBars: daily });
    expect(analysis.firstQualifiedLevel).toBeNull();
  });
});
