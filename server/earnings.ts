type EarningsRisk = { highRisk: boolean; earningsDate: string | null; source: string | null };

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function parseDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1000 : value);
  if (typeof value === "string" && value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
  return null;
}

export function tradingSessionDistance(from: Date, to: Date) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  if (end < start) return null;
  let sessions = 0;
  for (let cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) sessions += 1;
  }
  return sessions;
}

export function isWithinTwoTradingSessions(now: Date, earningsDate: Date) {
  const sessions = tradingSessionDistance(now, earningsDate);
  return sessions !== null && sessions >= 0 && sessions <= 2;
}

async function requestJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "SignalDesk-Earnings/1.0" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Earnings provider returned ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
}

async function fromFinnhub(symbol: string): Promise<{ date: Date; source: string } | null> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return null;
  const now = new Date(); const end = new Date(now); end.setUTCDate(end.getUTCDate() + 7);
  const json = await requestJson(`https://finnhub.io/api/v1/calendar/earnings?from=${isoDate(now)}&to=${isoDate(end)}&symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`);
  const dates = ((json.earningsCalendar ?? []) as Array<{ date?: string }>).map((row) => parseDate(row.date)).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ? { date: dates[0], source: "Finnhub earnings calendar" } : null;
}

async function fromYahoo(symbol: string): Promise<{ date: Date; source: string } | null> {
  const json = await requestJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`);
  const events = json?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? [];
  const dates = (events as Array<{ raw?: number; fmt?: string }>).map((event) => parseDate(event.raw ?? event.fmt)).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ? { date: dates[0], source: "Yahoo Finance calendar" } : null;
}

export async function getEarningsRisk(symbol: string, now = new Date()): Promise<EarningsRisk> {
  let event: { date: Date; source: string } | null = null;
  try { event = await fromFinnhub(symbol); } catch { /* try Yahoo fallback */ }
  if (!event) { try { event = await fromYahoo(symbol); } catch { return { highRisk: false, earningsDate: null, source: null }; } }
  if (!event) return { highRisk: false, earningsDate: null, source: null };
  const selected = event;
  return { highRisk: isWithinTwoTradingSessions(now, selected.date), earningsDate: isoDate(selected.date), source: selected.source };
}
