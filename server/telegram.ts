import { addAlertHistory, getTelegramSettings, listAlertRules, hasRecentAlert, updateTrackedPrices } from "./db";
import { getMarketData } from "./marketData";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured() { return Boolean(process.env.TELEGRAM_BOT_TOKEN); }

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
  const rules = await listAlertRules();
  let checked = 0; let sent = 0;
  for (const rule of rules) {
    checked += 1;
    let market;
    try { market = await getMarketData(rule.symbol); } catch { continue; }
    const price = market.quote.price;
    const ranges = [
      { type: "demand" as const, low: Number(rule.demandLow), high: Number(rule.demandHigh), label: `$${Number(rule.demandLow).toFixed(2)} — $${Number(rule.demandHigh).toFixed(2)}`, title: "منطقة الطلب" },
      { type: "target1" as const, low: Number(rule.target1Low), high: Number(rule.target1High), label: `$${Number(rule.target1Low).toFixed(2)} — $${Number(rule.target1High).toFixed(2)}`, title: "الهدف الأول" },
      { type: "target2" as const, low: Number(rule.target2Low), high: Number(rule.target2High), label: `$${Number(rule.target2Low).toFixed(2)} — $${Number(rule.target2High).toFixed(2)}`, title: "الهدف الثاني" },
      ...(rule.target3Low && rule.target3High ? [{ type: "target3" as const, low: Number(rule.target3Low), high: Number(rule.target3High), label: `$${Number(rule.target3Low).toFixed(2)} — $${Number(rule.target3High).toFixed(2)}`, title: "الهدف الممتد" }] : []),
      ...(rule.stopLoss ? [{ type: "stopLoss" as const, low: 0, high: Number(rule.stopLoss), label: `دون $${Number(rule.stopLoss).toFixed(2)}`, title: "وقف الخسارة", stop: true }] : []),
    ];
    for (const range of ranges) {
      if (("stop" in range && price > range.high) || (!("stop" in range) && (price < range.low || price > range.high)) || await hasRecentAlert(rule.symbol, range.type, 30)) continue;
      const trackedPnl = rule.trackTrade && rule.entryPrice ? ((price - Number(rule.entryPrice)) / Number(rule.entryPrice)) * 100 : null;
      if (rule.trackTrade) await updateTrackedPrices(rule.symbol, price);
      const pnlLine = trackedPnl === null ? "" : `\nP/L من الدخول $${Number(rule.entryPrice).toFixed(2)}: ${trackedPnl >= 0 ? "+" : ""}${trackedPnl.toFixed(2)}%`;
      const message = `Signal Desk\n${rule.symbol} · ${range.title}\nالسعر: $${price.toFixed(2)}\nالنطاق: ${range.label}${pnlLine}\nالمصدر: ${market.provider}`;
      try { await sendTelegramMessage(message, settings.chatId); await addAlertHistory({ symbol: rule.symbol, alertType: range.type, price: price.toFixed(2), rangeLabel: range.label, provider: market.provider, delivery: "telegram" }); sent += 1; } catch { /* keep sweep idempotent; next run can retry */ }
    }
  }
  return { checked, sent };
}
