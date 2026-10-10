import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("alerts.rule query contract", () => {
  it("never resolves undefined for NVDA when no saved rule exists", async () => {
    const result = await appRouter.createCaller(context).alerts.rule({ symbol: "NVDA" });
    expect(result).not.toBeUndefined();
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("returns a defined live 4H demand-zone result for NVDA", async () => {
    const result = await appRouter.createCaller(context).market.demandZone({ symbol: "NVDA" });
    expect(result).not.toBeUndefined();
    if (result) {
      expect(result.symbol).toBe("NVDA");
      expect(result.demandLow).toBeLessThan(result.demandHigh);
    }
  }, 20_000);
});
