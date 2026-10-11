import { aggregateHourlyTo4H, fetchHourlyWithFallback } from "./candleZones";

export type ResistanceBar = { timestamp: Date; high: number; low?: number; open?: number; close?: number };
export type ResistanceLevel = { price: number; distancePercent: number; riskReward: number | null; sources: string[] };
export type ResistanceAnalysis = { currentPrice: number; entryPrice: number; stopLoss: number; atr: number; levels: ResistanceLevel[]; warning: boolean; relativeTargets: number[] };

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

export function findPivotHighs(bars: ResistanceBar[], lookback: number, left = 5, right = 5) {
  const data = bars.slice(-lookback);
  const pivots: ResistanceBar[] = [];
  for (let i = left; i < data.length - right; i += 1) {
    const candidate = data[i];
    const before = data.slice(i - left, i);
    const after = data.slice(i + 1, i + right + 1);
    if (candidate.high > Math.max(...before.map((bar) => bar.high)) && candidate.high > Math.max(...after.map((bar) => bar.high))) pivots.push(candidate);
  }
  return pivots;
}

export function calculateAtr(bars: ResistanceBar[], period = 14) {
  const data = bars.slice(-Math.max(period + 1, 2));
  if (data.length < 2) return 0;
  const ranges = data.slice(1).map((bar, index) => { const previousClose = data[index].close ?? data[index].high; const trueRange = Math.max((bar.high - (bar.low ?? bar.high)), Math.abs(bar.high - previousClose), Math.abs((bar.low ?? bar.high) - previousClose)); return trueRange; });
  return ranges.slice(-period).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(period, ranges.length));
}

export function mergeNearbyLevels(levels: Array<{ price: number; source: string }>, atr: number, thresholdMultiplier = 0.5) {
  const sorted = levels.filter((level) => Number.isFinite(level.price)).sort((a, b) => a.price - b.price);
  const groups: Array<{ price: number; sources: string[] }> = [];
  for (const level of sorted) {
    const last = groups.at(-1);
    if (last && Math.abs(level.price - last.price) < atr * thresholdMultiplier) {
      last.price = (last.price + level.price) / 2;
      if (!last.sources.includes(level.source)) last.sources.push(level.source);
    } else groups.push({ price: level.price, sources: [level.source] });
  }
  return groups;
}

export function calculateRiskReward(resistance: number, entryPrice: number, stopLoss: number) {
  const risk = entryPrice - stopLoss;
  return risk > 0 ? (resistance - entryPrice) / risk : null;
}

export function analyzeResistances(input: { currentPrice: number; demandLow: number; demandHigh: number; stopLoss: number; fourHourBars: ResistanceBar[]; dailyBars: ResistanceBar[] }) : ResistanceAnalysis {
  const atr = calculateAtr(input.fourHourBars);
  const fourHour = findPivotHighs(input.fourHourBars, 60).map((bar) => ({ price: bar.high, source: "4H pivot" }));
  const daily = findPivotHighs(input.dailyBars, 120).map((bar) => ({ price: bar.high, source: "Daily pivot" }));
  const yearHigh = Math.max(...input.dailyBars.slice(-252).map((bar) => bar.high), 0);
  const raw = [...fourHour, ...daily, ...(yearHigh > input.currentPrice ? [{ price: yearHigh, source: "52-week high" }] : [])].filter((level) => level.price > input.currentPrice);
  const entryPrice = input.currentPrice >= input.demandLow && input.currentPrice <= input.demandHigh ? input.currentPrice : input.demandHigh;
  const levels = mergeNearbyLevels(raw, atr).slice(0, 3).map((level) => ({ price: level.price, distancePercent: ((level.price - input.currentPrice) / input.currentPrice) * 100, riskReward: calculateRiskReward(level.price, entryPrice, input.stopLoss), sources: level.sources }))
    .sort((a, b) => a.price - b.price);
  return { currentPrice: input.currentPrice, entryPrice, stopLoss: input.stopLoss, atr, levels, warning: levels[0]?.riskReward !== null && levels[0]?.riskReward !== undefined && levels[0].riskReward < 1.5, relativeTargets: [input.demandHigh * 1.12, input.demandHigh * 1.30, input.demandHigh * 1.50] };
}

async function fetchDailyBars(symbol: string, lookbackDays = 370): Promise<ResistanceBar[]> {
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - lookbackDays * 86400;
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
  const response = await fetch(url, { headers: { "User-Agent": "SignalDesk-Resistance/1.0" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Yahoo daily resistance ${response.status}`);
  const result = (await response.json() as any)?.chart?.result?.[0];
  const timestamps = result?.timestamp as number[] | undefined;
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps?.length || !quote) throw new Error(`No daily resistance candles for ${symbol}`);
  return timestamps.map((timestamp, index) => ({ timestamp: new Date(timestamp * 1000), open: Number(quote.open?.[index]), high: Number(quote.high?.[index]), low: Number(quote.low?.[index]), close: Number(quote.close?.[index]) })).filter((bar: ResistanceBar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

export { fetchDailyBars };

export async function getResistanceAnalysis(symbol: string, currentPrice: number, demandLow: number, demandHigh: number, stopLoss: number) {
  const hourly = await fetchHourlyWithFallback(symbol);
  const daily = await fetchDailyBars(symbol);
  const fourHourBars = aggregateHourlyTo4H(hourly.bars).map((bar) => ({ timestamp: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
  return analyzeResistances({ currentPrice, demandLow, demandHigh, stopLoss, fourHourBars, dailyBars: daily });
}

export function formatResistanceSummary(analysis: ResistanceAnalysis) {
  return analysis.levels.map((level) => `$${level.price.toFixed(2)} (${level.distancePercent.toFixed(2)}%, R/R ${level.riskReward === null ? "—" : level.riskReward.toFixed(2)})`).join(" · ");
}

export function countWeekdays(start: Date, end: Date) {
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setHours(0, 0, 0, 0);
  while (cursor < finish) { cursor.setDate(cursor.getDate() + 1); const day = cursor.getDay(); if (day !== 0 && day !== 6) count += 1; }
  return count;
}

export function firstBreakWithinDays(input: { dailyBars: ResistanceBar[]; resistanceLevels: number[]; relativeTargets: number[]; days: number }) {
  const candidates = input.dailyBars.slice(0, input.days);
  for (const bar of candidates) {
    const resistance = input.resistanceLevels.find((level) => bar.high >= level);
    const targetIndex = input.relativeTargets.findIndex((level) => bar.high >= level);
    if (resistance !== undefined && targetIndex >= 0) return resistance <= input.relativeTargets[targetIndex] ? `مقاومة $${resistance.toFixed(2)}` : `هدف نسبي ${targetIndex + 1}`;
    if (resistance !== undefined) return `مقاومة $${resistance.toFixed(2)}`;
    if (targetIndex >= 0) return `هدف نسبي ${targetIndex + 1}`;
  }
  return null;
}
