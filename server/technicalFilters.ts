export type CandleLike = { open: number; high: number; low: number; close: number; timestamp?: Date };

export type AtrResult = { atr: number; trueRanges: number[] };
export type NewsRisk = { blocked: boolean; reason: string | null; articleCount: number; checkedAt: number };

export function calculateAtr(candles: CandleLike[], period = 14): AtrResult | null {
  if (period <= 0 || candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]; const previous = candles[i - 1];
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  const window = trueRanges.slice(-period);
  return window.length === period ? { atr: window.reduce((sum, value) => sum + value, 0) / period, trueRanges } : null;
}

export function passesAtrFilter(input: { demandLow: number; demandHigh: number; atr: number | null; minZoneAtr?: number; maxZoneAtr?: number }): boolean {
  if (!input.atr || !Number.isFinite(input.atr) || input.atr <= 0) return false;
  const width = input.demandHigh - input.demandLow;
  if (!Number.isFinite(width) || width <= 0) return false;
  return width >= input.atr * (input.minZoneAtr ?? 0.15) && width <= input.atr * (input.maxZoneAtr ?? 1.5);
}

export function detectGapRisk(previousClose: number, currentOpen: number, thresholdPercent = 4): { blocked: boolean; gapPercent: number } {
  if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(currentOpen)) return { blocked: true, gapPercent: NaN };
  const gapPercent = ((currentOpen - previousClose) / previousClose) * 100;
  return { blocked: Math.abs(gapPercent) >= thresholdPercent, gapPercent };
}

export function shouldBlockForNews(input: { articleTimestamps: number[]; now?: number; windowHours?: number }): NewsRisk {
  const now = input.now ?? Date.now(); const windowMs = (input.windowHours ?? 24) * 60 * 60 * 1000;
  const recent = input.articleTimestamps.filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= windowMs);
  return { blocked: recent.length > 0, reason: recent.length ? `${recent.length} recent article(s) within ${input.windowHours ?? 24}h` : null, articleCount: recent.length, checkedAt: now };
}
