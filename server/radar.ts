import { replaceRadar, listRadar, getRadarSettings, updateTrackedPrices, listAlertRules, addAlertHistory, hasRecentAlert } from "./db";
import { sendTelegramMessage } from "./telegram";

export const RADAR_UNIVERSE = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","AVGO","TSLA","AMD","NFLX","MU","AMAT","QCOM","INTC","LRCX","KLAC","CRM","ORCL","PLTR","SMCI","COIN","MSTR","MARA","CRWD","PANW","SOFI","UBER","SHOP","ARM","MRVL"] as const;
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

type RadarQuote = { symbol: string; price: number; previousClose: number; changePercent: number; volume: number; provider: string };
async function getRadarQuote(symbol: string): Promise<RadarQuote> {
  const url = `${CHART_URL}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const response = await fetch(url, { headers: { "User-Agent": "SignalDesk-Radar/1.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const json = await response.json() as any;
  const result = json?.chart?.result?.[0]; const meta = result?.meta; const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close ?? []).filter((x: unknown) => Number.isFinite(x)) as number[];
  const volumes = (quote?.volume ?? []).filter((x: unknown) => Number.isFinite(x)) as number[];
  const price = Number(meta?.regularMarketPrice ?? closes.at(-1)); const previousClose = Number(meta?.previousClose ?? closes.at(-2) ?? price); const volume = Number(meta?.regularMarketVolume ?? volumes.at(-1) ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || price <= 0) throw new Error(`No quote for ${symbol}`);
  return { symbol, price, previousClose, changePercent: ((price - previousClose) / previousClose) * 100, volume, provider: "Yahoo Finance chart" };
}

async function pool<T>(items: readonly string[], limit: number, task: (item: string) => Promise<T>) { const output: T[] = []; let cursor = 0; async function worker() { while (cursor < items.length) { const index = cursor++; try { output[index] = await task(items[index]); } catch { /* skip an unavailable symbol */ } } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return output.filter(Boolean); }

export async function scanRadar() {
  const quotes = await pool(RADAR_UNIVERSE, 4, getRadarQuote);
  const averageVolume = quotes.length ? quotes.reduce((sum, row) => sum + row.volume, 0) / quotes.length : 1;
  const rows = quotes.map((row) => {
    const demandLow = row.price * 0.96; const demandHigh = row.price * 0.99; const stopLoss = demandLow * 0.98; const entry = demandHigh;
    const volumeScore = Math.min(100, (row.volume / Math.max(averageVolume, 1)) * 50); const momentumScore = Math.min(100, Math.abs(row.changePercent) * 12); const score = Math.min(100, volumeScore * 0.6 + momentumScore * 0.4);
    return { symbol: row.symbol, price: row.price.toFixed(4), changePercent: row.changePercent.toFixed(4), volume: String(Math.round(row.volume)), score: score.toFixed(4), demandLow: demandLow.toFixed(4), demandHigh: demandHigh.toFixed(4), stopLoss: stopLoss.toFixed(4), target1: (entry * 1.12).toFixed(4), target2: (entry * 1.30).toFixed(4), target3: (entry * 1.50).toFixed(4), provider: row.provider, scannedAt: new Date() };
  }).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 30);
  return replaceRadar(rows);
}

export async function scanAndNotifyRadar() {
  const rows = await scanRadar();
  const telegram = await import("./db").then(({ getTelegramSettings }) => getTelegramSettings());
  if (telegram?.enabled && telegram.chatId && process.env.TELEGRAM_BOT_TOKEN && rows[0]) {
    const top = rows.slice(0, 3).map((row, index) => `${index + 1}. ${row.symbol} · $${Number(row.price).toFixed(2)} · score ${Number(row.score).toFixed(0)} · طلب $${Number(row.demandLow).toFixed(2)}–$${Number(row.demandHigh).toFixed(2)}`).join("\n");
    if (!(await hasRecentAlert("RADAR", "demand", 55))) { await sendTelegramMessage(`Alpha Signals · Radar 30\nأعلى الفرص نشاطاً:\n${top}`, telegram.chatId); await addAlertHistory({ symbol: "RADAR", alertType: "demand", price: String(rows[0].price), rangeLabel: "Top 3 radar", provider: "Yahoo Finance chart", delivery: "telegram" }); }
  }
  for (const rule of await listAlertRules()) if (rule.trackTrade && rule.entryPrice) { const quote = rows.find((row) => row.symbol === rule.symbol); if (quote) await updateTrackedPrices(rule.symbol, Number(quote.price)); }
  return { count: rows.length, top: rows.slice(0, 5), settings: await getRadarSettings() };
}

export async function getRadarSnapshot() { return listRadar(); }
