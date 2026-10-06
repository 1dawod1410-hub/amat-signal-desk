import { describe, expect, it } from "vitest";

describe("Finnhub environment secret", () => {
  it(
    "authenticates successfully against the lightweight quote endpoint",
    async () => {
      const token = process.env.FINNHUB_API_KEY;
      expect(token, "FINNHUB_API_KEY must be configured").toBeTruthy();

      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(token!)}`,
      );

      expect(response.ok, `Finnhub returned HTTP ${response.status}`).toBe(true);
      const payload = (await response.json()) as { c?: unknown };
      expect(typeof payload.c, "Finnhub quote response should include current price").toBe(
        "number",
      );
    },
    15_000,
  );
});
