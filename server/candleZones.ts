export type HourlyBar = { timestamp: Date; open: number; high: number; low: number; close: number; volume: number };
export type Candle4H = HourlyBar & { bars: number; bodyLow: number; bodyHigh: number; body: number; range: number; lowerWick: number; upperWick: number; bodyRatio: number; volumeMedian20: number | null };
export type DemandZone = { symbol: string; demandLow: number; demandHigh: number; sourceCandleTime: Date; confirmationClose: number; status: "confirmed" | "unconfirmed"; breakType: "none" | "wick_break" | "confirmed_close_break"; provider: string };

const NY_TIME = "America/New_York";
const FINNHUB_CANDLES = "https://finnhub.io/api/v1/stock/candle";

function toNewYorkParts(date: Date) { return new Intl.DateTimeFormat("en-US", { timeZone: NY_TIME, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).reduce<Record<string, string>>((out, part) => { out[part.type] = part.value; return out; }, {}); }
function isRegularSessionBar(date: Date) { const parts = toNewYorkParts(date); const minutes = Number(parts.hour) * 60 + Number(parts.minute); return minutes >= 570 && minutes < 960; }

export async function fetchFinnhubHourly(symbol: string, lookbackDays = 30): Promise<HourlyBar[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const now = Math.floor(Date.now() / 1000);
  const from = now - lookbackDays * 24 * 60 * 60;
  const url = `${FINNHUB_CANDLES}?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${from}&to=${now}&token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "SignalDesk-CandleScanner/1.0" } });
  if (!response.ok) throw new Error(`Finnhub candles ${response.status}`);
  const json = await response.json() as { s?: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
  if (json.s !== "ok" || !json.t?.length) throw new Error(`No hourly candles for ${symbol}`);
  return json.t.map((unix, i) => ({ timestamp: new Date(unix * 1000), open: Number(json.o?.[i]), high: Number(json.h?.[i]), low: Number(json.l?.[i]), close: Number(json.c?.[i]), volume: Number(json.v?.[i]) })).filter((bar) => isRegularSessionBar(bar.timestamp) && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function fetchYahooHourly(symbol: string, lookbackDays = 30): Promise<HourlyBar[]> {
  const period2 = Math.floor(Date.now() / 1000); const period1 = period2 - lookbackDays * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=60m&includePrePost=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "SignalDesk-CandleScanner/1.0" } });
  if (!response.ok) throw new Error(`Yahoo candles ${response.status}`);
  const json = await response.json() as any; const result = json?.chart?.result?.[0]; const timestamps = result?.timestamp as number[] | undefined; const quote = result?.indicators?.quote?.[0];
  if (!timestamps?.length || !quote) throw new Error(`No Yahoo hourly candles for ${symbol}`);
  return timestamps.map((unix, i) => ({ timestamp: new Date(unix * 1000), open: Number(quote.open?.[i]), high: Number(quote.high?.[i]), low: Number(quote.low?.[i]), close: Number(quote.close?.[i]), volume: Number(quote.volume?.[i]) })).filter((bar: HourlyBar) => isRegularSessionBar(bar.timestamp) && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)).sort((a: HourlyBar, b: HourlyBar) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function fetchHourlyWithFallback(symbol: string) { try { return { bars: await fetchFinnhubHourly(symbol), provider: "Finnhub 60m aggregated to 4H" }; } catch { return { bars: await fetchYahooHourly(symbol), provider: "Yahoo Finance 60m aggregated to 4H" }; } }

export function aggregateHourlyTo4H(hourly: HourlyBar[], now = new Date()): Candle4H[] {
  const byDay = new Map<string, HourlyBar[]>();
  for (const bar of hourly.filter((item) => isRegularSessionBar(item.timestamp))) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NY_TIME, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(bar.timestamp).reduce<Record<string, string>>((out, part) => { out[part.type] = part.value; return out; }, {});
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    const day = byDay.get(key) ?? []; day.push(bar); byDay.set(key, day);
  }
  const result: Candle4H[] = [];
  for (const bars of Array.from(byDay.values())) {
    bars.sort((a: HourlyBar, b: HourlyBar) => a.timestamp.getTime() - b.timestamp.getTime());
    for (let i = 0; i < bars.length; i += 4) {
      const group = bars.slice(i, i + 4);
      if (group.length < 3) continue;
      const last = group[group.length - 1];
      if (last.timestamp.getTime() + 60 * 60 * 1000 > now.getTime()) continue;
      result.push({ timestamp: last.timestamp, open: group[0].open, high: Math.max(...group.map((bar: HourlyBar) => bar.high)), low: Math.min(...group.map((bar: HourlyBar) => bar.low)), close: group[group.length - 1].close, volume: group.reduce((sum: number, bar: HourlyBar) => sum + bar.volume, 0), bars: group.length, bodyLow: 0, bodyHigh: 0, body: 0, range: 0, lowerWick: 0, upperWick: 0, bodyRatio: 0, volumeMedian20: null });
    }
  }
  return addCandleFeatures(result.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));
}

export function addCandleFeatures(candles: Candle4H[]): Candle4H[] {
  return candles.map((candle, index, all) => { const bodyLow = Math.min(candle.open, candle.close); const bodyHigh = Math.max(candle.open, candle.close); const range = candle.high - candle.low; const body = Math.abs(candle.close - candle.open); const previousVolumes = all.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume).sort((a, b) => a - b); const middle = Math.floor(previousVolumes.length / 2); const volumeMedian20 = previousVolumes.length ? (previousVolumes.length % 2 ? previousVolumes[middle] : (previousVolumes[middle - 1] + previousVolumes[middle]) / 2) : null; return { ...candle, bodyLow, bodyHigh, body, range, lowerWick: bodyLow - candle.low, upperWick: candle.high - bodyHigh, bodyRatio: range > 0 ? body / range : 1, volumeMedian20 }; });
}

export function isMagnetOrAccumulation(candle: Candle4H) { return candle.range > 0 && candle.lowerWick >= Math.max(candle.body * 1.5, candle.range * 0.35) && candle.bodyRatio <= 0.55 && (candle.volumeMedian20 === null || candle.volume >= candle.volumeMedian20 * 0.8); }

export function findConfirmedDemandZone(candles: Candle4H[], symbol: string, lookback = 30): DemandZone | null {
  const data = candles.slice(-lookback);
  for (let i = data.length - 4; i >= 0; i -= 1) {
    const candidate = data[i];
    if (!isMagnetOrAccumulation(candidate)) continue;
    const confirmation = data.slice(i + 1, i + 4).find((candle) => candle.close > candidate.bodyHigh);
    if (!confirmation) continue;
    const cluster = data.slice(Math.max(0, i - 2), i + 1);
    const zone: DemandZone = { symbol: symbol.toUpperCase(), demandLow: Math.min(...cluster.map((candle) => candle.low)), demandHigh: Math.max(...cluster.map((candle) => candle.bodyHigh)), sourceCandleTime: candidate.timestamp, confirmationClose: confirmation.close, status: "confirmed", breakType: "none", provider: "Finnhub 60m aggregated to 4H" };
    const latest = data[data.length - 1];
    zone.breakType = classifyDemandBreak(zone, latest.low, latest.close);
    if (zone.breakType === "confirmed_close_break") return null;
    return zone;
  }
  return null;
}

export function classifyDemandBreak(zone: DemandZone, candleLow: number, candleClose: number): DemandZone["breakType"] { if (candleLow < zone.demandLow && candleClose >= zone.demandLow) return "wick_break"; if (candleClose < zone.demandLow) return "confirmed_close_break"; return "none"; }
