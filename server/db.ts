import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alertHistory, alertRules, InsertUser, telegramSettings, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"), lastSignedIn: user.lastSignedIn ?? new Date() };
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: { name: values.name, email: values.email, loginMethod: values.loginMethod, role: values.role, lastSignedIn: values.lastSignedIn } });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listAlertRules() { const db = await getDb(); return db ? db.select().from(alertRules).where(eq(alertRules.enabled, 1)) : []; }
export async function getAlertRule(symbol: string) { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(alertRules).where(eq(alertRules.symbol, symbol)).limit(1); return rows[0]; }
export async function saveAlertRule(input: { symbol: string; demandLow: string; demandHigh: string; target1Low: string; target1High: string; target2Low: string; target2High: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const existing = await getAlertRule(input.symbol);
  if (existing) await db.update(alertRules).set({ ...input, updatedAt: new Date() }).where(eq(alertRules.symbol, input.symbol));
  else await db.insert(alertRules).values({ ...input, enabled: 1 });
  return getAlertRule(input.symbol);
}
export async function getTelegramSettings() { const db = await getDb(); if (!db) return undefined; const rows = await db.select().from(telegramSettings).limit(1); return rows[0]; }
export async function saveTelegramSettings(chatId: string, enabled: number) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  const current = await getTelegramSettings();
  if (current) await db.update(telegramSettings).set({ chatId, enabled, updatedAt: new Date() }).where(eq(telegramSettings.id, current.id));
  else await db.insert(telegramSettings).values({ chatId, enabled });
  return getTelegramSettings();
}
export async function addAlertHistory(input: { symbol: string; alertType: "demand" | "target1" | "target2"; price: string; rangeLabel: string; provider: string; delivery: string }) { const db = await getDb(); if (db) await db.insert(alertHistory).values(input); }
export async function listAlertHistory(limit = 50) { const db = await getDb(); return db ? db.select().from(alertHistory).orderBy(desc(alertHistory.createdAt)).limit(limit) : []; }

export async function hasRecentAlert(symbol: string, alertType: "demand" | "target1" | "target2", minutes: number) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: alertHistory.id }).from(alertHistory).where(eq(alertHistory.symbol, symbol)).orderBy(desc(alertHistory.createdAt)).limit(20);
  const cutoff = Date.now() - minutes * 60_000;
  const recent = await Promise.all(rows.map(async (row) => {
    const full = await db.select().from(alertHistory).where(eq(alertHistory.id, row.id)).limit(1);
    return full[0];
  }));
  return recent.some((row) => row?.alertType === alertType && row.createdAt.getTime() >= cutoff);
}

export async function setTelegramScheduleTaskUid(taskUid: string) {
  const db = await getDb();
  const current = await getTelegramSettings();
  if (!db || !current) throw new Error("Telegram settings must be saved before scheduling");
  await db.update(telegramSettings).set({ scheduleCronTaskUid: taskUid, updatedAt: new Date() }).where(eq(telegramSettings.id, current.id));
  return getTelegramSettings();
}
