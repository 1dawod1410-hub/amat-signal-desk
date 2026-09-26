import { describe, expect, it } from "vitest";
import { calculateTrailingStop } from "./db";

describe("calculateTrailingStop", () => {
  it("does not move the original stop before target one", () => {
    const result = calculateTrailingStop({ price: 108, entryPrice: 100, target1High: 115, previousStop: 95, trailingPercent: 5 });
    expect(result.target1Hit).toBe(false);
    expect(result.promoted).toBe(false);
    expect(result.trailingStop).toBe(95);
  });

  it("activates at target one and protects at least the entry price", () => {
    const result = calculateTrailingStop({ price: 116, entryPrice: 100, target1High: 115, previousStop: 95, trailingPercent: 5 });
    expect(result.target1Hit).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.highestPrice).toBe(116);
    expect(result.trailingStop).toBeCloseTo(110.2, 4);
    expect(result.stopped).toBe(false);
  });

  it("never places the promoted stop below break-even", () => {
    const result = calculateTrailingStop({ price: 116, entryPrice: 100, target1High: 115, previousStop: 90, trailingPercent: 50 });
    expect(result.target1Hit).toBe(true);
    expect(result.trailingStop).toBe(100);
    expect(result.trailingStop).toBeGreaterThanOrEqual(100);
  });

  it("only ratchets upward and flags a reversal through the stop", () => {
    const result = calculateTrailingStop({ price: 123, entryPrice: 100, target1High: 115, previousStop: 110.2, highestPrice: 130, target1Hit: true, trailingStopActive: true, trailingPercent: 5 });
    expect(result.highestPrice).toBe(130);
    expect(result.trailingStop).toBeCloseTo(123.5, 4);
    expect(result.promoted).toBe(false);
    expect(result.stopped).toBe(true);
  });
});
