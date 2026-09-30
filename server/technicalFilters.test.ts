import { describe, expect, it } from "vitest";
import { calculateAtr, detectGapRisk, passesAtrFilter, shouldBlockForNews } from "./technicalFilters";

describe("technical safety filters", () => {
  it("calculates a true-range ATR", () => {
    const candles = Array.from({ length: 16 }, (_, index) => ({ open: 100, high: 104, low: 98, close: 101 + (index % 2), volume: 1 }));
    const result = calculateAtr(candles, 14);
    expect(result?.atr).toBeCloseTo(6, 5);
  });

  it("rejects zones that are too tight or too wide relative to ATR", () => {
    expect(passesAtrFilter({ demandLow: 100, demandHigh: 101, atr: 6 })).toBe(true);
    expect(passesAtrFilter({ demandLow: 100, demandHigh: 100.1, atr: 6 })).toBe(false);
    expect(passesAtrFilter({ demandLow: 100, demandHigh: 110, atr: 6 })).toBe(false);
  });

  it("blocks significant opening gaps at the configured threshold", () => {
    expect(detectGapRisk(100, 103.99).blocked).toBe(false);
    expect(detectGapRisk(100, 104).blocked).toBe(true);
    expect(detectGapRisk(100, 96).blocked).toBe(true);
  });

  it("blocks only recent company-news articles", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(shouldBlockForNews({ now, articleTimestamps: [now - 2 * 60 * 60 * 1000] }).blocked).toBe(true);
    expect(shouldBlockForNews({ now, articleTimestamps: [now - 25 * 60 * 60 * 1000] }).blocked).toBe(false);
  });
});
