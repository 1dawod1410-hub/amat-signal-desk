import { addAlertHistory, claimDemandAlert, getMarketSafetySettings, getTelegramSettings, listAlertRules, listPermanentWatchlist, listAlertHistory, hasRecentAlert, setDemandAlertLatched, updateAlertResistanceOutcomes, updateTrackedPrices } from "./db";
import { getMarketData } from "./marketData";
import { getEarningsRisk } from "./earnings";
import { getCompanyNewsRisk } from "./providerHealth";
import { isRegularUsMarketSession } from "./technicalFilters";
import { aggregateHourlyTo4H, fetchHourlyWithFallback, findConfirmedDemandZone } from "./candleZones";
import { MARKET_UNIVERSE } from "./marketUniverse";
import { countWeekdays, fetchDailyBars, firstBreakWithinDays, formatResistanceSummary, getResistanceAnalysis, type ResistanceAnalysis } from "./resistance";

const TELEGRAM_API = "https://api.telegram.org";
const demandAlertLatches = new Set<string>();

type AsyncTask<T> = (symbol: string) => Promise<T>;
async function mapWithConcurrency<T>(symbols: string[], limit: number, task: AsyncTask<T>) {
  const output: T[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const index = cursor++;
      output[index] = await task(symbols[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, symbols.length) }, worker));
  return output;
}

export function telegramConfigured() { return Boolean(process.env.TELEGRAM_BOT_TOKEN); }
export function isInsideDemand(price: number, low: number, high: number) { return price >= low && price <= high; }
export const DEFAULT_MONITORED_SYMBOLS = MARKET_UNIVERSE;
export function mergeMonitoredSymbols(saved: string[], rules: string[]) { return Array.from(new Set([...DEFAULT_MONITORED_SYMBOLS, ...saved, ...rules].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))); }
export function formatDemandAlert(input: { symbol: string; price: number; demandLow: number; demandHigh: number; stopLoss: number; target1Low: number; target1High: number; target2Low: number; target2High: number; provider: string; trackedPnl?: number | null; entryPrice?: number | null; earningsWarning?: boolean; earningsDate?: string | null; resistance?: ResistanceAnalysis | null }) {
  const pnlLine = input.trackedPnl === null || input.trackedPnl === undefined || input.entryPrice === null || input.entryPrice === undefined ? "" : `\nP/L من الدخول $${input.entryPrice.toFixed(2)}: ${input.trackedPnl >= 0 ? "+" : ""}${input.trackedPnl.toFixed(2)}%`;
  const earningsLine = input.earningsWarning ? `\n⚠️ HIGH RISK: Upcoming Earnings Release${input.earningsDate ? ` (${input.earningsDate})` : ""}` : "";
  const resistanceLine = input.resistance?.levels.length ? `\nأهداف المقاومات: ${formatResistanceSummary(input.resistance)}` : "";
  const qualifiedLine = input.resistance?.firstQualifiedLevel ? `\nأول مستوى عائده/مخاطرته >= 1.5: $${input.resistance.firstQualifiedLevel.price.toFixed(2)} (البعد ${input.resistance.firstQualifiedLevel.distancePercent.toFixed(2)}%)` : "\nلا يوجد مستوى بعائد/مخاطرة >= 1.5 ضمن المقاومات المكتشفة";
  const warningLine = input.resistance?.warning ? "\n⚠️ مساحة الصعود ضيقة" : "";
  return `Signal Desk · تنبيه منطقة الطلب${earningsLine}${warningLine}\nالسهم: ${input.symbol}\nالسعر الحالي: $${input.price.toFixed(2)}\nمنطقة الدخول: $${input.demandLow.toFixed(2)} — $${input.demandHigh.toFixed(2)}\nوقف الخسارة: $${input.stopLoss.toFixed(2)}\nالهدف 1: $${input.target1Low.toFixed(2)} — $${input.target1High.toFixed(2)} · أهداف نسبية\nالهدف 2: $${input.target2Low.toFixed(2)} — $${input.target2High.toFixed(2)} · أهداف نسبية${resistanceLine}${qualifiedLine}${pnlLine}\nالمصدر: ${input.provider}`;
}

async function refreshResistanceOutcomes() {
  const history = await listAlertHistory(100);
  const dailyCache = new Map<string, Awaited<ReturnType<typeof fetchDailyBars>>>();
  for (const row of history) {
    if (!row.resistanceJson) continue;
    let snapshot: Pick<ResistanceAnalysis, "levels" | "relativeTargets">;
    try { snapshot = JSON.parse(row.resistanceJson); } catch { continue; }
    const elapsed = countWeekdays(row.createdAt, new Date());
    if (elapsed < 5) continue;
    let daily = dailyCache.get(row.symbol);
    try { if (!daily) { daily = await fetchDailyBars(row.symbol); dailyCache.set(row.symbol, daily); } } catch { continue; }
    const bars = daily.filter((bar) => bar.timestamp >= row.createdAt);
    const updates: { break5?: string | null; break10?: string | null; break20?: string | null } = {};
    if (elapsed >= 5 && row.break5 === null) updates.break5 = firstBreakWithinDays({ dailyBars: bars, resistanceLevels: snapshot.levels.map((level) => level.price), relativeTargets: snapshot.relativeTargets, days: 5 });
    if (elapsed >= 10 && row.break10 === null) updates.break10 = firstBreakWithinDays({ dailyBars: bars, resistanceLevels: snapshot.levels.map((level) => level.price), relativeTargets: snapshot.relativeTargets, days: 10 });
    if (elapsed >= 20 && row.break20 === null) updates.break20 = firstBreakWithinDays({ dailyBars: bars, resistanceLevels: snapshot.levels.map((level) => level.price), relativeTargets: snapshot.relativeTargets, days: 20 });
    if (Object.keys(updates).length) await updateAlertResistanceOutcomes(row.id, updates);
  }
}

export async function sendTelegramMessage(text: string, chatId?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const destination = chatId ?? (await getTelegramSettings())?.chatId;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  if (!destination) throw new Error("Telegram chat ID is not configured");
  const response = await fetch(`${TELEGRAM_API}/bot${encodeURIComponent(token)}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: destination, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  const result = await response.json() as { ok?: boolean; description?: string };
  if (!result.ok) throw new Error(result.description ?? "Telegram rejected the message");
  return result;
}

export async function runAlertSweep() {
  const settings = await getTelegramSettings();
  if (!settings?.enabled || !settings.chatId || !telegramConfigured()) return { checked: 0, sent: 0, skipped: "Telegram is not configured or disabled" };
  const safety = await getMarketSafetySettings();
  if (!isRegularUsMarketSession()) return { checked: 0, sent: 0, skipped: "Outside regular US market session" };
  const rules = await listAlertRules();
  await refreshResistanceOutcomes();
  const savedWatchlist = await listPermanentWatchlist();
  const ruleBySymbol = new Map(rules.map((rule) => [rule.symbol, rule]));
  const monitoredSymbols = mergeMonitoredSymbols(savedWatchlist.map((row) => row.symbol), rules.map((rule) => rule.symbol));
  const sentBySymbol = await mapWithConcurrency(monitoredSymbols, 4, async (symbol) => {
    const rule = ruleBySymbol.get(symbol);
    let market;
    try { market = await getMarketData(symbol); } catch { return 0; }
    const price = market.quote.price;
    if (market.quote.gapBlocked) return 0;

    const trailing = rule?.trackTrade ? await updateTrackedPrices(symbol, price) : null;
    if (trailing?.promoted && rule && !(await hasRecentAlert(symbol, "trailingStop", 120))) {
      let trailingResistance: ResistanceAnalysis | null = null;
      try { trailingResistance = await getResistanceAnalysis(symbol, price, Number(rule.demandLow), Number(rule.demandHigh), Number(trailing.trailingStop ?? rule.stopLoss ?? (Number(rule.demandLow) * 0.982))); } catch { /* resistance enrichment must not block trailing alerts */ }
      const qualifiedLine = trailingResistance?.firstQualifiedLevel ? `أول مستوى عائده/مخاطرته >= 1.5: $${trailingResistance.firstQualifiedLevel.price.toFixed(2)} (البعد ${trailingResistance.firstQualifiedLevel.distancePercent.toFixed(2)}%)\n` : "لا يوجد مستوى بعائد/مخاطرة >= 1.5 ضمن المقاومات المكتشفة\n";
      const message = `Signal Desk\n${symbol} · Trailing Stop مفعّل\nالهدف الأول تحقق عند $${price.toFixed(2)}\nالوقف الجديد: $${Number(trailing.trailingStop).toFixed(2)}\n${trailingResistance?.levels.length ? `أهداف المقاومات: ${formatResistanceSummary(trailingResistance)}\n` : ""}${qualifiedLine}${trailingResistance?.warning ? "⚠️ مساحة الصعود ضيقة\n" : ""}حماية مستمرة للأرباح من أعلى سعر مسجل.`;
      try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol, alertType: "trailingStop", price: price.toFixed(2), rangeLabel: `وقف متحرك $${Number(trailing.trailingStop).toFixed(2)}`, provider: market.provider, delivery: "telegram", resistanceJson: trailingResistance ? JSON.stringify({ levels: trailingResistance.levels, relativeTargets: trailingResistance.relativeTargets }) : null, resistanceWarning: trailingResistance?.warning ? 1 : 0 }); } catch { /* retry on next heartbeat */ }
    }

    let liveZone = null;
    try { const candles = await fetchHourlyWithFallback(symbol); liveZone = findConfirmedDemandZone(aggregateHourlyTo4H(candles.bars), symbol); } catch { /* use the saved rule as a fallback */ }
    const demandLow = liveZone?.demandLow ?? (rule ? Number(rule.demandLow) : NaN);
    const demandHigh = liveZone?.demandHigh ?? (rule ? Number(rule.demandHigh) : NaN);
    if (!Number.isFinite(demandLow) || !Number.isFinite(demandHigh)) return 0;

    const insideDemand = isInsideDemand(price, demandLow, demandHigh);
    if (!insideDemand) {
      demandAlertLatches.delete(symbol);
      if (rule?.demandAlertLatched) await setDemandAlertLatched(symbol, false);
      return 0;
    }
    if (demandAlertLatches.has(symbol) || rule?.demandAlertLatched || await hasRecentAlert(symbol, "demand", 30)) return 0;

    const trackedPnl = rule?.trackTrade && rule.entryPrice ? ((price - Number(rule.entryPrice)) / Number(rule.entryPrice)) * 100 : null;
    const earnings = await getEarningsRisk(symbol);
    const news = await getCompanyNewsRisk(symbol, Date.now(), { windowHours: safety.newsWindowHours, failClosed: Boolean(safety.newsFailClosed) });
    if (news.blocked) return 0;

    const entry = demandHigh;
    let resistance: ResistanceAnalysis | null = null;
    try { resistance = await getResistanceAnalysis(symbol, price, demandLow, demandHigh, Number(rule?.stopLoss ?? demandLow * 0.982)); } catch { /* resistance enrichment must not block existing alerts */ }
    if (rule && !(await claimDemandAlert(symbol))) return 0;
    const provider = `${market.provider}; ${liveZone?.provider ?? "saved alert rule"}`;
    const message = formatDemandAlert({ symbol, price, demandLow, demandHigh, stopLoss: Number(rule?.stopLoss ?? demandLow * 0.982), target1Low: Number(rule?.target1Low ?? entry * 1.10), target1High: Number(rule?.target1High ?? entry * 1.15), target2Low: Number(rule?.target2Low ?? entry * 1.30), target2High: Number(rule?.target2High ?? entry * 1.33), provider, trackedPnl, entryPrice: rule?.entryPrice ? Number(rule.entryPrice) : null, earningsWarning: earnings.highRisk, earningsDate: earnings.earningsDate, resistance });
    try {
      await sendTelegramMessage(message, settings.chatId);
      demandAlertLatches.add(symbol);
      await addAlertHistory({ symbol, alertType: "demand", price: price.toFixed(2), rangeLabel: `$${demandLow.toFixed(2)} — $${demandHigh.toFixed(2)}`, provider, delivery: "telegram", resistanceJson: resistance ? JSON.stringify({ levels: resistance.levels, relativeTargets: resistance.relativeTargets }) : null, resistanceWarning: resistance?.warning ? 1 : 0 });
      return 1;
    } catch {
      demandAlertLatches.delete(symbol);
      if (rule) await setDemandAlertLatched(symbol, false);
      return 0;
    }
  });
  return { checked: monitoredSymbols.length, sent: sentBySymbol.reduce<number>((sum, count) => sum + count, 0) };
}
