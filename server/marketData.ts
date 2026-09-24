const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMESERIES = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";

type YahooNumber = { raw?: number };
type YahooSeriesPoint = { asOfDate?: string; reportedValue?: YahooNumber };
type YahooSeriesResult = { meta?: { type?: string[] }; [key: string]: unknown };

export type MarketData = {
  symbol: string;
  companyName: string;
  exchange: string;
  currency: string;
  quote: {
    price: number;
    previousClose: number;
    change: number;
    percent: number;
    marketTime: number;
  };
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

async function yahooJson(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "SignalDesk/2.0 market-data-proxy" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
}

function getSeries(json: Record<string, any>, type: string) {
  const result = (json?.timeseries?.result as YahooSeriesResult[] | undefined)?.find((item) => item?.meta?.type?.[0] === type);
  const points = result?.[type] as YahooSeriesPoint[] | undefined;
  return (points ?? [])
    .filter((point) => point.asOfDate && Number.isFinite(point.reportedValue?.raw))
    .map((point) => ({ date: point.asOfDate as string, value: point.reportedValue?.raw as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function latest(series: { date: string; value: number }[]) {
  return series.length ? series[series.length - 1] : null;
}

function sameQuarterLastYear(series: { date: string; value: number }[], current: { date: string; value: number } | null) {
  if (!current) return null;
  const date = new Date(`${current.date}T00:00:00Z`);
  const yearAgo = `${date.getUTCFullYear() - 1}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return series.find((point) => point.date === yearAgo) ?? series.filter((point) => point.date < current.date).at(-2) ?? series.at(-2) ?? null;
}

export async function getMarketData(inputSymbol: string): Promise<MarketData> {
  const symbol = cleanSymbol(inputSymbol);
  const period1 = Math.floor(Date.now() / 1000) - 740 * 24 * 60 * 60;
  const period2 = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const chartUrl = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
  const fundamentalsUrl = `${YAHOO_TIMESERIES}/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=quarterlyTotalRevenue,quarterlyNetIncome,quarterlyGrossProfit&merge=false&period1=${period1}&period2=${period2}`;
  const [chart, fundamentals] = await Promise.all([yahooJson(chartUrl), yahooJson(fundamentalsUrl)]);
  const chartResult = chart?.chart?.result?.[0];
  const meta = chartResult?.meta;
  const price = Number(meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.previousClose);
  const previousClose = Number(meta?.previousClose ?? meta?.chartPreviousClose);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error(`No live quote available for ${symbol}`);

  const revenueSeries = getSeries(fundamentals, "quarterlyTotalRevenue");
  const netIncomeSeries = getSeries(fundamentals, "quarterlyNetIncome");
  const grossProfitSeries = getSeries(fundamentals, "quarterlyGrossProfit");
  const revenue = latest(revenueSeries);
  const netIncome = latest(netIncomeSeries);
  const grossProfit = latest(grossProfitSeries);
  const previousRevenue = sameQuarterLastYear(revenueSeries, revenue);
  const revenueGrowthYoY = revenue && previousRevenue && previousRevenue.value !== 0 ? ((revenue.value - previousRevenue.value) / previousRevenue.value) * 100 : null;
  const netMargin = revenue && netIncome ? (netIncome.value / revenue.value) * 100 : null;
  const grossMargin = revenue && grossProfit ? (grossProfit.value / revenue.value) * 100 : null;

  return {
    symbol,
    companyName: meta?.longName ?? meta?.shortName ?? symbol,
    exchange: meta?.fullExchangeName ?? meta?.exchangeName ?? "NASDAQ",
    currency: meta?.currency ?? "USD",
    quote: { price, previousClose, change: price - previousClose, percent: ((price - previousClose) / previousClose) * 100, marketTime: Number(meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) },
    fundamentals: {
      quarter: revenue?.date ?? null,
      revenue: revenue?.value ?? null,
      revenueGrowthYoY,
      netIncome: netIncome?.value ?? null,
      netMargin,
      grossMargin,
      source: "Yahoo Finance fundamentals-timeseries",
      available: Boolean(revenue || netIncome || grossProfit),
    },
    fetchedAt: Date.now(),
  };
}
