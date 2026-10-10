import { addAlertHistory, claimDemandAlert, claimRadarDemandAlert, getMarketSafetySettings, getTelegramSettings, listAlertRules, listPermanentWatchlist, listRadar, hasRecentAlert, setDemandAlertLatched, setRadarDemandAlertLatched, updateTrackedPrices } from "./db";
import { getMarketData } from "./marketData";
import { getEarningsRisk } from "./earnings";
import { getCompanyNewsRisk } from "./providerHealth";
import { isRegularUsMarketSession } from "./technicalFilters";
import { aggregateHourlyTo4H, fetchHourlyWithFallback, findConfirmedDemandZone } from "./candleZones";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured() { return Boolean(process.env.TELEGRAM_BOT_TOKEN); }
export function isInsideDemand(price: number, low: number, high: number) { return price >= low && price <= high; }
export const DEFAULT_MONITORED_SYMBOLS = ["AMAT", "TSLA", "NVDA", "PL"] as const;
export function mergeMonitoredSymbols(saved: string[], rules: string[]) { return Array.from(new Set([...DEFAULT_MONITORED_SYMBOLS, ...saved, ...rules].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))); }
export function formatDemandAlert(input: { symbol: string; price: number; demandLow: number; demandHigh: number; stopLoss: number; target1Low: number; target1High: number; target2Low: number; target2High: number; provider: string; trackedPnl?: number | null; entryPrice?: number | null; earningsWarning?: boolean; earningsDate?: string | null }) {
  const pnlLine = input.trackedPnl === null || input.trackedPnl === undefined || input.entryPrice === null || input.entryPrice === undefined ? "" : `\nP/L من الدخول $${input.entryPrice.toFixed(2)}: ${input.trackedPnl >= 0 ? "+" : ""}${input.trackedPnl.toFixed(2)}%`;
  const earningsLine = input.earningsWarning ? `\n⚠️ HIGH RISK: Upcoming Earnings Release${input.earningsDate ? ` (${input.earningsDate})` : ""}` : "";
  return `Signal Desk · تنبيه منطقة الطلب${earningsLine}\nالسهم: ${input.symbol}\nالسعر الحالي: $${input.price.toFixed(2)}\nمنطقة الدخول: $${input.demandLow.toFixed(2)} — $${input.demandHigh.toFixed(2)}\nوقف الخسارة: $${input.stopLoss.toFixed(2)}\nالهدف 1: $${input.target1Low.toFixed(2)} — $${input.target1High.toFixed(2)}\nالهدف 2: $${input.target2Low.toFixed(2)} — $${input.target2High.toFixed(2)}${pnlLine}\nالمصدر: ${input.provider}`;
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
  const savedWatchlist = await listPermanentWatchlist();
  const ruleBySymbol = new Map(rules.map((rule) => [rule.symbol, rule]));
  const monitoredSymbols = mergeMonitoredSymbols(savedWatchlist.map((row) => row.symbol), rules.map((rule) => rule.symbol));
  let checked = 0; let sent = 0;
  for (const symbol of monitoredSymbols) {
    const rule = ruleBySymbol.get(symbol);
    checked += 1;
    let market;
    try { market = await getMarketData(symbol); } catch { continue; }
    const price = market.quote.price;
    if (market.quote.gapBlocked) continue;
    const trailing = rule?.trackTrade ? await updateTrackedPrices(symbol, price) : null;
    if (trailing?.promoted && !(await hasRecentAlert(symbol, "trailingStop", 120))) {
      const message = `Signal Desk\n${symbol} · Trailing Stop مفعّل\nالهدف الأول تحقق عند $${price.toFixed(2)}\nالوقف الجديد: $${Number(trailing.trailingStop).toFixed(2)}\nحماية مستمرة للأرباح من أعلى سعر مسجل.`;
      try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol, alertType: "trailingStop", price: price.toFixed(2), rangeLabel: `وقف متحرك $${Number(trailing.trailingStop).toFixed(2)}`, provider: market.provider, delivery: "telegram" }); sent += 1; } catch { /* retry on next heartbeat */ }
    }
    let liveZone = null;
    try { const candles = await fetchHourlyWithFallback(symbol); liveZone = findConfirmedDemandZone(aggregateHourlyTo4H(candles.bars), symbol); } catch { /* use the saved rule as a fallback */ }
    const demandLow = liveZone?.demandLow ?? (rule ? Number(rule.demandLow) : NaN);
    const demandHigh = liveZone?.demandHigh ?? (rule ? Number(rule.demandHigh) : NaN);
    if (!Number.isFinite(demandLow) || !Number.isFinite(demandHigh)) continue;
    const insideDemand = isInsideDemand(price, demandLow, demandHigh);
    if (!insideDemand && rule?.demandAlertLatched) {
      await setDemandAlertLatched(symbol, false);
      continue;
    }
    if (!insideDemand || rule?.demandAlertLatched || await hasRecentAlert(symbol, "demand", 30)) continue;
    const trackedPnl = rule?.trackTrade && rule.entryPrice ? ((price - Number(rule.entryPrice)) / Number(rule.entryPrice)) * 100 : null;
    const earnings = await getEarningsRisk(symbol);
    const news = await getCompanyNewsRisk(symbol, Date.now(), { windowHours: safety.newsWindowHours, failClosed: Boolean(safety.newsFailClosed) });
    if (news.blocked) continue;
    const entry = demandHigh;
    const claim = rule ? await claimDemandAlert(symbol) : true;
    if (!claim) continue;
    const message = formatDemandAlert({ symbol, price, demandLow, demandHigh, stopLoss: Number(rule?.stopLoss ?? demandLow * 0.982), target1Low: Number(rule?.target1Low ?? entry * 1.10), target1High: Number(rule?.target1High ?? entry * 1.15), target2Low: Number(rule?.target2Low ?? entry * 1.30), target2High: Number(rule?.target2High ?? entry * 1.33), provider: `${market.provider}; ${liveZone?.provider ?? "saved alert rule"}`, trackedPnl, entryPrice: rule?.entryPrice ? Number(rule.entryPrice) : null, earningsWarning: earnings.highRisk, earningsDate: earnings.earningsDate });
    try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol, alertType: "demand", price: price.toFixed(2), rangeLabel: `$${demandLow.toFixed(2)} — $${demandHigh.toFixed(2)}`, provider: `${market.provider}; ${liveZone?.provider ?? "saved alert rule"}`, delivery: "telegram" }); sent += 1; } catch { if (rule) await setDemandAlertLatched(symbol, false); /* retry on next heartbeat */ }
  }
  const ruleSymbols = new Set(rules.map((rule) => rule.symbol));
  for (const zone of await listRadar()) {
    if (ruleSymbols.has(zone.symbol) || zone.zoneStatus !== "confirmed") continue;
    let market;
    try { market = await getMarketData(zone.symbol); } catch { continue; }
    const price = market.quote.price; if (market.quote.gapBlocked || Number(zone.gapBlocked) === 1) continue; const demandLow = Number(zone.demandLow); const demandHigh = Number(zone.demandHigh); const insideDemand = isInsideDemand(price, demandLow, demandHigh);
    if (!insideDemand && zone.demandAlertLatched) { await setRadarDemandAlertLatched(zone.symbol, false); continue; }
    if (!insideDemand || zone.demandAlertLatched || await hasRecentAlert(zone.symbol, "demand", 30)) continue;
    const earnings = await getEarningsRisk(zone.symbol);
    const news = await getCompanyNewsRisk(zone.symbol, Date.now(), { windowHours: safety.newsWindowHours, failClosed: Boolean(safety.newsFailClosed) });
    if (news.blocked) continue;
    const message = formatDemandAlert({ symbol: zone.symbol, price, demandLow, demandHigh, stopLoss: Number(zone.stopLoss), target1Low: Number(zone.target1), target1High: Number(zone.target1), target2Low: Number(zone.target2), target2High: Number(zone.target2), provider: `${market.provider}; ${zone.provider}`, earningsWarning: earnings.highRisk, earningsDate: earnings.earningsDate });
    if (!(await claimRadarDemandAlert(zone.symbol))) continue;
    try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol: zone.symbol, alertType: "demand", price: price.toFixed(2), rangeLabel: `$${demandLow.toFixed(2)} — $${demandHigh.toFixed(2)}`, provider: `${market.provider}; ${zone.provider}`, delivery: "telegram" }); sent += 1; } catch { await setRadarDemandAlertLatched(zone.symbol, false); /* retry only after a failed delivery */ }
  }
  return { checked, sent };
}
