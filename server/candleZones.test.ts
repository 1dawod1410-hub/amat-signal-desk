import { describe, expect, it } from "vitest";
import { addCandleFeatures, aggregateHourlyTo4H, classifyDemandBreak, findConfirmedDemandZone, isMagnetOrAccumulation, type Candle4H, type HourlyBar } from "./candleZones";

function candle(timestamp: string, open: number, high: number, low: number, close: number, volume = 100): Candle4H {
  return { timestamp: new Date(timestamp), open, high, low, close, volume, bars: 4, bodyLow: 0, bodyHigh: 0, body: 0, range: 0, lowerWick: 0, upperWick: 0, bodyRatio: 0, volumeMedian20: null };
}

function hourly(timestamp: string, price: number): HourlyBar { return { timestamp: new Date(timestamp), open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 100 }; }

describe("4H candle demand zones", () => {
  it("aggregates completed hourly bars and excludes an incomplete final bar", () => {
    const bars = [
      hourly("2026-09-28T13:30:00Z", 100), hourly("2026-09-28T14:30:00Z", 101), hourly("2026-09-28T15:30:00Z", 102), hourly("2026-09-28T16:30:00Z", 103),
      hourly("2026-09-28T17:30:00Z", 104), hourly("2026-09-28T18:30:00Z", 105), hourly("2026-09-28T19:30:00Z", 106),
    ];
    const result = aggregateHourlyTo4H(bars, new Date("2026-09-28T21:00:00Z"));
    expect(result).toHaveLength(2);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(104);
    expect(result[0].low).toBe(99);
    expect(result[0].close).toBe(103.5);
  });

  it("recognizes a long lower-tail magnet candle", () => {
    const [magnet] = addCandleFeatures([candle("2026-09-28T13:30:00Z", 100, 104, 90, 102)]);
    expect(magnet.lowerWick).toBe(10);
    expect(magnet.bodyHigh).toBe(102);
    expect(magnet.bodyRatio).toBeCloseTo(2 / 14, 6);
    expect(isMagnetOrAccumulation(magnet)).toBe(true);
  });

  it("requires a later closing confirmation before creating a zone", () => {
    const candles = addCandleFeatures([
      candle("2026-09-25T13:30:00Z", 98, 101, 95, 100),
      candle("2026-09-26T13:30:00Z", 99, 102, 96, 101),
      candle("2026-09-27T13:30:00Z", 100, 104, 90, 102),
      candle("2026-09-28T13:30:00Z", 102, 106, 101, 105),
      candle("2026-09-29T13:30:00Z", 105, 107, 103, 106),
      candle("2026-09-30T13:30:00Z", 106, 108, 104, 107),
    ]);
    const zone = findConfirmedDemandZone(candles, "AMAT");
    expect(zone?.status).toBe("confirmed");
    expect(zone?.demandLow).toBe(90);
    expect(zone?.demandHigh).toBe(102);
    expect(zone?.confirmationClose).toBe(105);
  });

  it("uses only the latest active demand candle without expanding its boundaries", () => {
    const candles = addCandleFeatures([
      candle("2026-09-21T13:30:00Z", 98, 103, 94, 100),
      candle("2026-09-22T13:30:00Z", 100, 104, 95, 101),
      candle("2026-09-23T13:30:00Z", 100, 105, 90, 102),
      candle("2026-09-24T13:30:00Z", 102, 108, 101, 106),
      candle("2026-09-25T13:30:00Z", 106, 109, 104, 107),
      candle("2026-09-26T13:30:00Z", 107, 111, 106, 110),
      candle("2026-09-29T13:30:00Z", 109, 113, 96, 111),
      candle("2026-09-30T13:30:00Z", 111, 116, 110, 115),
      candle("2026-10-01T13:30:00Z", 115, 118, 112, 117),
      candle("2026-10-02T13:30:00Z", 117, 120, 116, 119),
    ]);

    const zone = findConfirmedDemandZone(candles, "AAPL");
    expect(zone?.sourceCandleTime).toEqual(new Date("2026-09-29T13:30:00Z"));
    expect(zone?.demandLow).toBe(96);
    expect(zone?.demandHigh).toBe(111);
  });

  it("distinguishes a wick sweep from a confirmed closing break", () => {
    const zone = { symbol: "AMAT", demandLow: 90, demandHigh: 102, sourceCandleTime: new Date(), confirmationClose: 105, status: "confirmed" as const, breakType: "none" as const, provider: "test" };
    expect(classifyDemandBreak(zone, 89, 91)).toBe("wick_break");
    expect(classifyDemandBreak(zone, 89, 89.5)).toBe("confirmed_close_break");
    expect(classifyDemandBreak(zone, 92, 93)).toBe("none");
  });

  it("rejects a zone after the latest completed 4H candle closes below demandLow", () => {
    const candles = addCandleFeatures([
      candle("2026-09-25T13:30:00Z", 98, 101, 95, 100),
      candle("2026-09-26T13:30:00Z", 99, 102, 96, 101),
      candle("2026-09-27T13:30:00Z", 100, 104, 90, 102),
      candle("2026-09-28T13:30:00Z", 102, 106, 101, 105),
      candle("2026-09-29T13:30:00Z", 105, 107, 103, 106),
      candle("2026-09-30T13:30:00Z", 89, 93, 87, 88),
    ]);
    expect(findConfirmedDemandZone(candles, "AMAT")).toBeNull();
  });

  it("keeps a zone active when the latest candle only sweeps the low with its wick", () => {
    const candles = addCandleFeatures([
      candle("2026-09-25T13:30:00Z", 98, 101, 95, 100),
      candle("2026-09-26T13:30:00Z", 99, 102, 96, 101),
      candle("2026-09-27T13:30:00Z", 100, 104, 90, 102),
      candle("2026-09-28T13:30:00Z", 102, 106, 101, 105),
      candle("2026-09-29T13:30:00Z", 105, 107, 103, 106),
      candle("2026-09-30T13:30:00Z", 92, 103, 89, 94),
    ]);
    expect(findConfirmedDemandZone(candles, "AMAT")?.breakType).toBe("wick_break");
  });
});
