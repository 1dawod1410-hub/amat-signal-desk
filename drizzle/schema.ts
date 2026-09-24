import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const alertRules = mysqlTable("alert_rules", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  demandLow: decimal("demandLow", { precision: 12, scale: 4 }).notNull(),
  demandHigh: decimal("demandHigh", { precision: 12, scale: 4 }).notNull(),
  target1Low: decimal("target1Low", { precision: 12, scale: 4 }).notNull(),
  target1High: decimal("target1High", { precision: 12, scale: 4 }).notNull(),
  target2Low: decimal("target2Low", { precision: 12, scale: 4 }).notNull(),
  target2High: decimal("target2High", { precision: 12, scale: 4 }).notNull(),
  enabled: int("enabled").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ symbolUnique: uniqueIndex("alert_rules_symbol_unique").on(table.symbol) }));

export const telegramSettings = mysqlTable("telegram_settings", {
  id: int("id").autoincrement().primaryKey(),
  chatId: varchar("chatId", { length: 128 }).notNull(),
  enabled: int("enabled").default(1).notNull(),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const alertHistory = mysqlTable("alert_history", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  alertType: mysqlEnum("alertType", ["demand", "target1", "target2"]).notNull(),
  price: varchar("price", { length: 32 }).notNull(),
  rangeLabel: varchar("rangeLabel", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  delivery: varchar("delivery", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type TelegramSetting = typeof telegramSettings.$inferSelect;
export type AlertHistory = typeof alertHistory.$inferSelect;
