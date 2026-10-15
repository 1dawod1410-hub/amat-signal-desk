import { getProviderHealth, recordProviderHealth } from "./db";
import { shouldBlockForNews, type NewsRisk } from "./technicalFilters";
import { requestWithBackoff } from "./providerResilience";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export type ProviderHealth = { provider: string; ok: boolean; latencyMs: number; error?: string };
let lastProviderHealthCheckAt = 0;

export async function checkProviderHealth(provider: "Yahoo Finance" | "Finnhub"): Promise<ProviderHealth> {
  const started = Date.now();
  try {
    const symbol = "AMAT";
    const url = provider === "Yahoo Finance"
      ? `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`
      : `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${encodeURIComponent(process.env.FINNHUB_API_KEY ?? "")}`;
    const response = await requestWithBackoff(`health:${provider}`, async () => { const result = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SignalDesk-Health/1.0" } }); if (!result.ok) { const error = new Error(`HTTP ${result.status}`) as Error & { status?: number }; error.status = result.status; throw error; } return result; });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json() as Record<string, unknown>;
    if (!json || (provider === "Yahoo Finance" && !(json as any)?.chart?.result?.[0]) || (provider === "Finnhub" && !Number.isFinite(Number((json as any)?.c)))) throw new Error("Invalid provider payload");
    const result = { provider, ok: true, latencyMs: Date.now() - started };
    await recordProviderHealth(result);
    return result;
  } catch (error) {
    const result = { provider, ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    await recordProviderHealth(result);
    return result;
  }
}

export async function getCompanyNewsRisk(symbol: string, now = Date.now(), options?: { windowHours?: number; failClosed?: boolean }): Promise<NewsRisk> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return { blocked: false, reason: null, articleCount: 0, checkedAt: now };
  const end = new Date(now); const start = new Date(now - 48 * 60 * 60 * 1000);
  const from = start.toISOString().slice(0, 10); const to = end.toISOString().slice(0, 10);
  try {
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Finnhub news ${response.status}`);
    const rows = await response.json() as Array<{ datetime?: number }>;
    const timestamps = rows.map((row) => Number(row.datetime) * 1000).filter(Number.isFinite);
    return shouldBlockForNews({ articleTimestamps: timestamps, now, windowHours: options?.windowHours ?? 24 });
  } catch {
    return { blocked: Boolean(options?.failClosed), reason: options?.failClosed ? "News source unavailable; fail-closed protection" : null, articleCount: 0, checkedAt: now };
  }
}

export async function checkAllProviders() {
  if (Date.now() - lastProviderHealthCheckAt < 15 * 60 * 1000) {
    const cached = await Promise.all([getProviderHealth("Yahoo Finance"), ...(process.env.FINNHUB_API_KEY ? [getProviderHealth("Finnhub")] : [])]);
    return cached.filter(Boolean).map((row) => ({ provider: row!.provider, ok: Boolean(row!.ok), latencyMs: row!.latencyMs, error: row!.lastError ?? undefined }));
  }
  lastProviderHealthCheckAt = Date.now();
  const checks = [checkProviderHealth("Yahoo Finance")];
  if (process.env.FINNHUB_API_KEY) checks.push(checkProviderHealth("Finnhub"));
  return Promise.all(checks);
}
