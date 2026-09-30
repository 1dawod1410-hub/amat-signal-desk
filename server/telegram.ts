import { addAlertHistory, claimDemandAlert, claimRadarDemandAlert, getMarketSafetySettings, getTelegramSettings, listAlertRules, listRadar, hasRecentAlert, setDemandAlertLatched, setRadarDemandAlertLatched, updateTrackedPrices } from "./db";
import { getMarketData } from "./marketData";
import { getEarningsRisk } from "./earnings";
import { getCompanyNewsRisk } from "./providerHealth";
import { isRegularUsMarketSession } from "./technicalFilters";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured() { return Boolean(process.env.TELEGRAM_BOT_TOKEN); }
export function isInsideDemand(price: number, low: number, high: number) { return price >= low && price <= high; }
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
  let checked = 0; let sent = 0;
  for (const rule of rules) {
    checked += 1;
    let market;
    try { market = await getMarketData(rule.symbol); } catch { continue; }
    const price = market.quote.price;
    if (market.quote.gapBlocked) continue;
    const trailing = rule.trackTrade ? await updateTrackedPrices(rule.symbol, price) : null;
    if (trailing?.promoted && !(await hasRecentAlert(rule.symbol, "trailingStop", 120))) {
      const message = `Signal Desk\n${rule.symbol} · Trailing Stop مفعّل\nالهدف الأول تحقق عند $${price.toFixed(2)}\nالوقف الجديد: $${Number(trailing.trailingStop).toFixed(2)}\nحماية مستمرة للأرباح من أعلى سعر مسجل.`;
      try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol: rule.symbol, alertType: "trailingStop", price: price.toFixed(2), rangeLabel: `وقف متحرك $${Number(trailing.trailingStop).toFixed(2)}`, provider: market.provider, delivery: "telegram" }); sent += 1; } catch { /* retry on next heartbeat */ }
    }
    const demandLow = Number(rule.demandLow); const demandHigh = Number(rule.demandHigh);
    const insideDemand = isInsideDemand(price, demandLow, demandHigh);
    if (!insideDemand && rule.demandAlertLatched) {
      await setDemandAlertLatched(rule.symbol, false);
      continue;
    }
    if (!insideDemand || rule.demandAlertLatched || await hasRecentAlert(rule.symbol, "demand", 30)) continue;
    const trackedPnl = rule.trackTrade && rule.entryPrice ? ((price - Number(rule.entryPrice)) / Number(rule.entryPrice)) * 100 : null;
    const earnings = await getEarningsRisk(rule.symbol);
    const news = await getCompanyNewsRisk(rule.symbol, Date.now(), { windowHours: safety.newsWindowHours, failClosed: Boolean(safety.newsFailClosed) });
    if (news.blocked) continue;
    const message = formatDemandAlert({ symbol: rule.symbol, price, demandLow, demandHigh, stopLoss: Number(rule.stopLoss ?? 0), target1Low: Number(rule.target1Low), target1High: Number(rule.target1High), target2Low: Number(rule.target2Low), target2High: Number(rule.target2High), provider: market.provider, trackedPnl, entryPrice: rule.entryPrice ? Number(rule.entryPrice) : null, earningsWarning: earnings.highRisk, earningsDate: earnings.earningsDate });
    if (!(await claimDemandAlert(rule.symbol))) continue;
    try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol: rule.symbol, alertType: "demand", price: price.toFixed(2), rangeLabel: `$${demandLow.toFixed(2)} — $${demandHigh.toFixed(2)}`, provider: market.provider, delivery: "telegram" }); sent += 1; } catch { await setDemandAlertLatched(rule.symbol, false); /* retry only after a failed delivery */ }
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
