const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMESERIES = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
import { detectGapRisk } from "./technicalFilters";
import { getMarketSafetySettings, isProviderCircuitOpen, recordProviderHealth } from "./db";

type YahooNumber = { raw?: number };
type YahooSeriesPoint = { asOfDate?: string; reportedValue?: YahooNumber };
type YahooSeriesResult = { meta?: { type?: string[] }; [key: string]: unknown };
type SeriesPoint = { date: string; value: number };

export type MarketData = {
  symbol: string;
  companyName: string;
  exchange: string;
  currency: string;
  provider: "Yahoo Finance" | "Finnhub";
  fallbackUsed: boolean;
  quote: { price: number; previousClose: number; currentOpen: number; gapPercent: number; gapBlocked: boolean; change: number; percent: number; marketTime: number };
  fundamentals: {
    quarter: string | null;
    revenue: number | null;
    revenueGrowthYoY: number | null;
    netIncome: number | null;
    netMargin: number | null;
    grossMargin: number | null;
    source: string;
    available: boolean;
  };
  fetchedAt: number;
};

function cleanSymbol(value: string) {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Invalid ticker symbol");
  return symbol;
}

async function jsonRequest(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  const json = await response.json() as Record<string, any>;
  if (json.error || json.errorCode) throw new Error(json.error?.description ?? json.errorMessage ?? "Provider returned an error");
  return json;
}

function getSeries(json: Record<string, any>, type: string): SeriesPoint[] {
  const result = (json?.timeseries?.result as YahooSeriesResult[] | undefined)?.find((item) => item?.meta?.type?.[0] === type);
  const points = result?.[type] as YahooSeriesPoint[] | undefined;
  return (points ?? []).filter((point) => point.asOfDate && Number.isFinite(point.reportedValue?.raw)).map((point) => ({ date: point.asOfDate as string, value: point.reportedValue?.raw as number })).sort((a, b) => a.date.localeCompare(b.date));
}

function latest(series: SeriesPoint[]) { return series.length ? series[series.length - 1] : null; }

function sameQuarterLastYear(series: SeriesPoint[], current: SeriesPoint | null) {
  if (!current) return null;
  const date = new Date(`${current.date}T00:00:00Z`);
  const yearAgo = `${date.getUTCFullYear() - 1}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return series.find((point) => point.date === yearAgo) ?? series.filter((point) => point.date < current.date).at(-2) ?? series.at(-2) ?? null;
}

function buildFundamentals(revenueSeries: SeriesPoint[], netIncomeSeries: SeriesPoint[], grossProfitSeries: SeriesPoint[], source: string) {
  const revenue = latest(revenueSeries);
  const netIncome = latest(netIncomeSeries);
  const grossProfit = latest(grossProfitSeries);
  const previousRevenue = sameQuarterLastYear(revenueSeries, revenue);
  return {
    quarter: revenue?.date ?? null,
    revenue: revenue?.value ?? null,
    revenueGrowthYoY: revenue && previousRevenue && previousRevenue.value !== 0 ? ((revenue.value - previousRevenue.value) / previousRevenue.value) * 100 : null,
    netIncome: netIncome?.value ?? null,
    netMargin: revenue && netIncome ? (netIncome.value / revenue.value) * 100 : null,
    grossMargin: revenue && grossProfit ? (grossProfit.value / revenue.value) * 100 : null,
    source,
    available: Boolean(revenue || netIncome || grossProfit),
  };
}

async function getYahooData(symbol: string): Promise<MarketData> {
  const period1 = Math.floor(Date.now() / 1000) - 740 * 24 * 60 * 60;
  const period2 = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const chartUrl = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
  const fundamentalsUrl = `${YAHOO_TIMESERIES}/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=quarterlyTotalRevenue,quarterlyNetIncome,quarterlyGrossProfit&merge=false&period1=${period1}&period2=${period2}`;
  const [chart, fundamentals] = await Promise.all([jsonRequest(chartUrl, { "User-Agent": "SignalDesk/4.0" }), jsonRequest(fundamentalsUrl, { "User-Agent": "SignalDesk/4.0" })]);
  const meta = chart?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.previousClose);
  const previousClose = Number(meta?.previousClose ?? meta?.chartPreviousClose);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error(`No live quote available for ${symbol}`);
  const safety = await getMarketSafetySettings(); const gap = detectGapRisk(previousClose, Number(meta?.regularMarketOpen ?? price), Number(safety.gapThresholdPercent));
  const fundamentalsData = buildFundamentals(getSeries(fundamentals, "quarterlyTotalRevenue"), getSeries(fundamentals, "quarterlyNetIncome"), getSeries(fundamentals, "quarterlyGrossProfit"), "Yahoo Finance fundamentals-timeseries");
  return {
    symbol, companyName: meta?.longName ?? meta?.shortName ?? symbol, exchange: meta?.fullExchangeName ?? meta?.exchangeName ?? "NASDAQ", currency: meta?.currency ?? "USD", provider: "Yahoo Finance", fallbackUsed: false,
    quote: { price, previousClose, currentOpen: Number(meta?.regularMarketOpen ?? price), gapPercent: gap.gapPercent, gapBlocked: gap.blocked, change: price - previousClose, percent: ((price - previousClose) / previousClose) * 100, marketTime: Number(meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) },
    fundamentals: fundamentalsData,
    fetchedAt: Date.now(),
  };
}

type FinnhubMetric = { concept?: string; value?: number; end?: string; start?: string };
function findFinnhubValue(rows: FinnhubMetric[] | undefined, concepts: string[]) {
  const row = (rows ?? []).find((item) => concepts.some((concept) => (item.concept ?? "").toLowerCase().includes(concept)) && Number.isFinite(item.value));
  return row ? { date: row.end ?? row.start ?? new Date().toISOString().slice(0, 10), value: Number(row.value) } : null;
}

async function getFinnhubData(symbol: string): Promise<MarketData> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const auth = `token=${encodeURIComponent(token)}`;
  const [quote, profile, statements] = await Promise.all([
    jsonRequest(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&${auth}`),
    jsonRequest(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&${auth}`),
    jsonRequest(`${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(symbol)}&freq=quarterly&${auth}`),
  ]);
  const price = Number(quote?.c);
  const previousClose = Number(quote?.pc);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error(`Finnhub has no quote for ${symbol}`);
  const safety = await getMarketSafetySettings(); const gap = detectGapRisk(previousClose, Number(quote?.o ?? price), Number(safety.gapThresholdPercent));
  const reports = (statements?.data ?? []) as Array<{ endDate?: string; report?: { ic?: FinnhubMetric[]; bs?: FinnhubMetric[] } }>;
  const revenueSeries = reports.map((item) => findFinnhubValue(item.report?.ic, ["revenuefromcontractwithcustomer", "revenues", "revenue"])).filter(Boolean).map((item) => item as SeriesPoint).sort((a, b) => a.date.localeCompare(b.date));
  const netIncomeSeries = reports.map((item) => findFinnhubValue(item.report?.ic, ["netincomeloss", "netincome"])).filter(Boolean).map((item) => item as SeriesPoint).sort((a, b) => a.date.localeCompare(b.date));
  const grossProfitSeries = reports.map((item) => findFinnhubValue(item.report?.ic, ["grossprofit"])).filter(Boolean).map((item) => item as SeriesPoint).sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol, companyName: profile?.name ?? symbol, exchange: profile?.exchange ?? "NASDAQ", currency: profile?.currency ?? "USD", provider: "Finnhub", fallbackUsed: true,
    quote: { price, previousClose, currentOpen: Number(quote?.o ?? price), gapPercent: gap.gapPercent, gapBlocked: gap.blocked, change: Number(quote?.d ?? price - previousClose), percent: Number(quote?.dp ?? ((price - previousClose) / previousClose) * 100), marketTime: Number(quote?.t ?? Math.floor(Date.now() / 1000)) },
    fundamentals: buildFundamentals(revenueSeries, netIncomeSeries, grossProfitSeries, "Finnhub financials-reported"),
    fetchedAt: Date.now(),
  };
}

export async function getMarketData(inputSymbol: string): Promise<MarketData> {
  const symbol = cleanSymbol(inputSymbol);
  const started = Date.now();
  try {
    if (await isProviderCircuitOpen("Yahoo Finance")) throw new Error("Yahoo circuit breaker open");
    const data = await getYahooData(symbol); await recordProviderHealth({ provider: "Yahoo Finance", ok: true, latencyMs: Date.now() - started }); return data;
  } catch (yahooError) {
    await recordProviderHealth({ provider: "Yahoo Finance", ok: false, latencyMs: Date.now() - started, error: yahooError instanceof Error ? yahooError.message : String(yahooError) });
    try {
      if (await isProviderCircuitOpen("Finnhub")) throw new Error("Finnhub circuit breaker open");
      const fallbackStarted = Date.now(); const data = await getFinnhubData(symbol); await recordProviderHealth({ provider: "Finnhub", ok: true, latencyMs: Date.now() - fallbackStarted }); return data;
    } catch (finnhubError) {
      await recordProviderHealth({ provider: "Finnhub", ok: false, latencyMs: Date.now() - started, error: finnhubError instanceof Error ? finnhubError.message : String(finnhubError) });
      const yahooMessage = yahooError instanceof Error ? yahooError.message : "Yahoo unavailable";
      const finnhubMessage = finnhubError instanceof Error ? finnhubError.message : "Finnhub unavailable";
      throw new Error(`Market data unavailable. Yahoo: ${yahooMessage}. Finnhub: ${finnhubMessage}.`);
    }
  }
}
