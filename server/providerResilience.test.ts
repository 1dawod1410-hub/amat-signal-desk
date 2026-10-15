import { describe, expect, it } from "vitest";
import { backoffDelaysForTest, cacheProviderValue, clearProviderResilienceState, getCachedProviderValue, requestWithBackoff } from "./providerResilience";

describe("provider resilience", () => {
  it("keeps the last successful value within its cache window", () => {
    clearProviderResilienceState();
    cacheProviderValue("quote:AMAT", { price: 100 }, 1_000);
    expect(getCachedProviderValue<{ price: number }>("quote:AMAT", 10_000, 5_000)?.value).toEqual({ price: 100 });
    expect(getCachedProviderValue("quote:AMAT", 2_000, 5_000)).toBeNull();
  });

  it("uses progressively longer retry delays and blocks immediate repeats after rate limiting", async () => {
    clearProviderResilienceState();
    expect(backoffDelaysForTest()).toEqual([5_000, 15_000, 60_000]);
    await expect(requestWithBackoff("test:429", async () => { throw new Error("HTTP 429"); }, 1)).rejects.toThrow("HTTP 429");
    await expect(requestWithBackoff("test:429", async () => ({ ok: true }), 1)).rejects.toThrow(/backoff active/);
  });
});
