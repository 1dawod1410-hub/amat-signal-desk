import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"), email: varchar("email", { length: 320 }), loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(), lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const alertRules = mysqlTable("alert_rules", {
  id: int("id").autoincrement().primaryKey(), symbol: varchar("symbol", { length: 10 }).notNull(),
  demandLow: decimal("demandLow", { precision: 12, scale: 4 }).notNull(), demandHigh: decimal("demandHigh", { precision: 12, scale: 4 }).notNull(),
  target1Low: decimal("target1Low", { precision: 12, scale: 4 }).notNull(), target1High: decimal("target1High", { precision: 12, scale: 4 }).notNull(),
  target2Low: decimal("target2Low", { precision: 12, scale: 4 }).notNull(), target2High: decimal("target2High", { precision: 12, scale: 4 }).notNull(),
  stopLoss: decimal("stopLoss", { precision: 12, scale: 4 }), target3Low: decimal("target3Low", { precision: 12, scale: 4 }), target3High: decimal("target3High", { precision: 12, scale: 4 }),
  trackTrade: int("trackTrade").default(0).notNull(), entryPrice: decimal("entryPrice", { precision: 12, scale: 4 }), trackedAt: timestamp("trackedAt"), lastPrice: decimal("lastPrice", { precision: 12, scale: 4 }), lastPnlPercent: decimal("lastPnlPercent", { precision: 12, scale: 4 }), trailingPercent: decimal("trailingPercent", { precision: 8, scale: 4 }).default("5"), highestPrice: decimal("highestPrice", { precision: 12, scale: 4 }), target1Hit: int("target1Hit").default(0).notNull(), trailingStopActive: int("trailingStopActive").default(0).notNull(), demandAlertLatched: int("demandAlertLatched").default(0).notNull(), closePrice: decimal("closePrice", { precision: 12, scale: 4 }), finalPnlPercent: decimal("finalPnlPercent", { precision: 12, scale: 4 }), closedAt: timestamp("closedAt"),
  enabled: int("enabled").default(1).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ symbolUnique: uniqueIndex("alert_rules_symbol_unique").on(table.symbol) }));

export const telegramSettings = mysqlTable("telegram_settings", {
  id: int("id").autoincrement().primaryKey(), chatId: varchar("chatId", { length: 128 }).notNull(), enabled: int("enabled").default(1).notNull(), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const radarSettings = mysqlTable("radar_settings", {
  id: int("id").autoincrement().primaryKey(), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }), enabled: int("enabled").default(1).notNull(), lastScanAt: timestamp("lastScanAt"), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const radarOpportunities = mysqlTable("radar_opportunities", {
  id: int("id").autoincrement().primaryKey(), symbol: varchar("symbol", { length: 10 }).notNull(), price: decimal("price", { precision: 12, scale: 4 }).notNull(), changePercent: decimal("changePercent", { precision: 12, scale: 4 }).notNull(), volume: decimal("volume", { precision: 20, scale: 0 }).notNull(), score: decimal("score", { precision: 12, scale: 4 }).notNull(), demandLow: decimal("demandLow", { precision: 12, scale: 4 }).notNull(), demandHigh: decimal("demandHigh", { precision: 12, scale: 4 }).notNull(), stopLoss: decimal("stopLoss", { precision: 12, scale: 4 }).notNull(), target1: decimal("target1", { precision: 12, scale: 4 }).notNull(), target2: decimal("target2", { precision: 12, scale: 4 }).notNull(), target3: decimal("target3", { precision: 12, scale: 4 }).notNull(), provider: varchar("provider", { length: 64 }).notNull(), scannedAt: timestamp("scannedAt").defaultNow().notNull(),
}, (table) => ({ symbolUnique: uniqueIndex("radar_opportunities_symbol_unique").on(table.symbol) }));

export const permanentWatchlist = mysqlTable("permanent_watchlist", {
  id: int("id").autoincrement().primaryKey(), symbol: varchar("symbol", { length: 10 }).notNull(), source: varchar("source", { length: 32 }).default("radar").notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ symbolUnique: uniqueIndex("permanent_watchlist_symbol_unique").on(table.symbol) }));

export const alertHistory = mysqlTable("alert_history", {
  id: int("id").autoincrement().primaryKey(), symbol: varchar("symbol", { length: 10 }).notNull(), alertType: mysqlEnum("alertType", ["demand", "target1", "target2", "target3", "stopLoss", "trailingStop"]).notNull(), price: varchar("price", { length: 32 }).notNull(), rangeLabel: varchar("rangeLabel", { length: 64 }).notNull(), provider: varchar("provider", { length: 64 }).notNull(), delivery: varchar("delivery", { length: 32 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect; export type InsertUser = typeof users.$inferInsert; export type AlertRule = typeof alertRules.$inferSelect; export type TelegramSetting = typeof telegramSettings.$inferSelect; export type AlertHistory = typeof alertHistory.$inferSelect; export type RadarOpportunity = typeof radarOpportunities.$inferSelect;
