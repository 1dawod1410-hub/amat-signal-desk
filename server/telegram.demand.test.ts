import { describe, expect, it } from "vitest";
import { formatDemandAlert, isInsideDemand } from "./telegram";

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
});
