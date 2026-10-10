import { describe, expect, it } from "vitest";
import { DEFAULT_MONITORED_SYMBOLS, formatDemandAlert, isInsideDemand, mergeMonitoredSymbols } from "./telegram";
import { isWithinTwoTradingSessions } from "./earnings";

describe("individual demand alerts", () => {
  it("fires only inside the inclusive demand range", () => {
    expect(isInsideDemand(111.39, 111.39, 114.87)).toBe(true);
    expect(isInsideDemand(114.87, 111.39, 114.87)).toBe(true);
    expect(isInsideDemand(116.03, 111.39, 114.87)).toBe(false);
  });

  it("includes the full execution parameters", () => {
    const message = formatDemandAlert({ symbol: "INTC", price: 113.2, demandLow: 111.39, demandHigh: 114.87, stopLoss: 109.16, target1Low: 124, target1High: 127, target2Low: 145, target2High: 149, provider: "Yahoo Finance" });
    expect(message).toContain("السهم: INTC");
    expect(message).toContain("السعر الحالي: $113.20");
    expect(message).toContain("منطقة الدخول: $111.39 — $114.87");
    expect(message).toContain("وقف الخسارة: $109.16");
    expect(message).toContain("الهدف 1: $124.00 — $127.00");
    expect(message).toContain("الهدف 2: $145.00 — $149.00");
  });

  it("adds the earnings warning without changing the technical alert", () => {
    const message = formatDemandAlert({ symbol: "INTC", price: 113.2, demandLow: 111.39, demandHigh: 114.87, stopLoss: 109.16, target1Low: 124, target1High: 127, target2Low: 145, target2High: 149, provider: "Yahoo Finance", earningsWarning: true, earningsDate: "2026-10-01" });
    expect(message).toContain("⚠️ HIGH RISK: Upcoming Earnings Release");
    expect(message).toContain("2026-10-01");
  });

  it("treats the next two weekdays as the warning window", () => {
    expect(isWithinTwoTradingSessions(new Date("2026-09-28T12:00:00Z"), new Date("2026-09-30T12:00:00Z"))).toBe(true);
    expect(isWithinTwoTradingSessions(new Date("2026-09-28T12:00:00Z"), new Date("2026-10-01T12:00:00Z"))).toBe(false);
  });

  it("covers every current watchlist symbol plus saved rules without duplicates", () => {
    const symbols = mergeMonitoredSymbols(["TSLA", "AAPL", "nvda"], ["AMAT", "PL"]);
    expect(symbols).toEqual([...DEFAULT_MONITORED_SYMBOLS, "AAPL"]);
  });
});
