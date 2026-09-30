import { replaceRadar, listRadar, getRadarSettings, updateTrackedPrices, listAlertRules, addAlertHistory, hasRecentAlert, getTelegramSettings } from "./db";
import { fetchHourlyWithFallback, aggregateHourlyTo4H, findConfirmedDemandZone } from "./candleZones";
import { sendTelegramMessage } from "./telegram";
import { detectGapRisk } from "./technicalFilters";

export const RADAR_UNIVERSE = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","AVGO","TSLA","AMD","NFLX","MU","AMAT","QCOM","INTC","LRCX","KLAC","CRM","ORCL","PLTR","SMCI","COIN","MSTR","MARA","CRWD","PANW","SOFI","UBER","SHOP","ARM","MRVL"] as const;
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

type RadarQuote = { symbol: string; price: number; previousClose: number; currentOpen: number; gapPercent: number; gapBlocked: boolean; changePercent: number; volume: number; provider: string };
type RadarCandidate = RadarQuote & { zone: NonNullable<ReturnType<typeof findConfirmedDemandZone>>; candleProvider: string };

async function getRadarQuote(symbol: string): Promise<RadarQuote> {
  const url = `${CHART_URL}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const response = await fetch(url, { headers: { "User-Agent": "SignalDesk-Radar/2.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const json = await response.json() as any; const result = json?.chart?.result?.[0]; const meta = result?.meta; const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close ?? []).filter((x: unknown) => Number.isFinite(x)) as number[]; const opens = (quote?.open ?? []).filter((x: unknown) => Number.isFinite(x)) as number[]; const volumes = (quote?.volume ?? []).filter((x: unknown) => Number.isFinite(x)) as number[];
  const price = Number(meta?.regularMarketPrice ?? closes.at(-1)); const previousClose = Number(meta?.previousClose ?? closes.at(-2) ?? price); const currentOpen = Number(opens.at(-1) ?? price); const gap = detectGapRisk(previousClose, currentOpen); const volume = Number(meta?.regularMarketVolume ?? volumes.at(-1) ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || price <= 0) throw new Error(`No quote for ${symbol}`);
  return { symbol, price, previousClose, currentOpen, gapPercent: gap.gapPercent, gapBlocked: gap.blocked, changePercent: ((price - previousClose) / previousClose) * 100, volume, provider: "Yahoo Finance chart" };
}

async function pool<T>(items: readonly string[], limit: number, task: (item: string) => Promise<T>) { const output: T[] = []; let cursor = 0; async function worker() { while (cursor < items.length) { const index = cursor++; try { output[index] = await task(items[index]); } catch { /* skip symbols without usable candles */ } } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return output.filter(Boolean); }

export async function scanRadar() {
  const candidates = await pool(RADAR_UNIVERSE, 3, async (symbol): Promise<RadarCandidate> => { const quote = await getRadarQuote(symbol); const candle = await fetchHourlyWithFallback(symbol); const zone = findConfirmedDemandZone(aggregateHourlyTo4H(candle.bars), symbol); if (!zone || quote.gapBlocked) throw new Error(`ATR or gap filter rejected ${symbol}`); return { ...quote, zone, candleProvider: candle.provider }; });
  const previous = await listRadar();
  if (candidates.length < 10 && previous.length > 0) return previous;
  const averageVolume = candidates.length ? candidates.reduce((sum, row) => sum + row.volume, 0) / candidates.length : 1;
  const rows = candidates.map((row) => { const entry = row.zone.demandHigh; const volumeScore = Math.min(100, (row.volume / Math.max(averageVolume, 1)) * 50); const momentumScore = Math.min(100, Math.abs(row.changePercent) * 12); const score = Math.min(100, volumeScore * 0.6 + momentumScore * 0.4); return { symbol: row.symbol, price: row.price.toFixed(4), changePercent: row.changePercent.toFixed(4), volume: String(Math.round(row.volume)), score: score.toFixed(4), demandLow: row.zone.demandLow.toFixed(4), demandHigh: row.zone.demandHigh.toFixed(4), atr: row.zone.atr.toFixed(4), gapPercent: row.gapPercent.toFixed(4), gapBlocked: 0, stopLoss: (row.zone.demandLow * 0.98).toFixed(4), target1: (entry * 1.12).toFixed(4), target2: (entry * 1.30).toFixed(4), target3: (entry * 1.50).toFixed(4), sourceCandleTime: row.zone.sourceCandleTime, confirmationClose: row.zone.confirmationClose.toFixed(4), zoneStatus: row.zone.status, breakType: row.zone.breakType, provider: `${row.provider}; ${row.candleProvider}`, scannedAt: new Date() }; }).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 30);
  return replaceRadar(rows);
}

export async function scanAndNotifyRadar() {
  const rows = await scanRadar();
  const telegram = await getTelegramSettings();
  for (const rule of await listAlertRules()) if (rule.trackTrade && rule.entryPrice) { const quote = rows.find((row) => row.symbol === rule.symbol); if (quote) { const trailing = await updateTrackedPrices(rule.symbol, Number(quote.price)); if (trailing.promoted && telegram?.enabled && telegram.chatId && process.env.TELEGRAM_BOT_TOKEN && !(await hasRecentAlert(rule.symbol, "trailingStop", 120))) { const stop = Number(trailing.trailingStop); await sendTelegramMessage(`Signal Desk\n${rule.symbol} · Trailing Stop مفعّل\nالهدف الأول تحقق عند $${Number(quote.price).toFixed(2)}\nالوقف الجديد: $${stop.toFixed(2)}`, telegram.chatId); await addAlertHistory({ symbol: rule.symbol, alertType: "trailingStop", price: Number(quote.price).toFixed(2), rangeLabel: `وقف متحرك $${stop.toFixed(2)}`, provider: quote.provider, delivery: "telegram" }); } } }
  return { count: rows.length, top: rows.slice(0, 5), settings: await getRadarSettings() };
}

export async function getRadarSnapshot() { return listRadar(); }
