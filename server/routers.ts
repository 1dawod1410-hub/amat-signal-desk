import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { createHeartbeatJob } from "./_core/heartbeat";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addAlertHistory, addPermanentWatch, closeTrade, getAlertRule, getRadarSettings, getTelegramSettings, listAlertHistory, listPermanentWatchlist, listProviderHealth, listRadar, saveAlertRule, saveTelegramSettings, setRadarScheduleTaskUid, setTelegramScheduleTaskUid, trackTrade, updateTrailingSettings } from "./db";
import { getMarketData } from "./marketData";
import { scanRadar, scanAndNotifyRadar } from "./radar";
import { sendTelegramMessage, telegramConfigured } from "./telegram";

const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.-]{0,9}$/);
const priceSchema = z.string().trim().regex(/^\d+(\.\d{1,4})?$/).refine((value) => Number(value) > 0, "Price must be positive");
const alertInput = z.object({ symbol: symbolSchema, demandLow: priceSchema, demandHigh: priceSchema, target1Low: priceSchema, target1High: priceSchema, target2Low: priceSchema, target2High: priceSchema, stopLoss: priceSchema.nullable().optional(), target3Low: priceSchema.nullable().optional(), target3High: priceSchema.nullable().optional() });

export const appRouter = router({
  system: systemRouter,
  auth: router({ me: publicProcedure.query((opts) => opts.ctx.user), logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }) }),
  market: router({ quote: publicProcedure.input(z.object({ symbol: symbolSchema })).query(async ({ input }) => getMarketData(input.symbol)) }),
  health: router({ providers: publicProcedure.query(() => listProviderHealth()) }),
  alerts: router({
    rule: publicProcedure.input(z.object({ symbol: symbolSchema })).query(async ({ input }) => getAlertRule(input.symbol)),
    saveRule: publicProcedure.input(alertInput).mutation(async ({ input }) => saveAlertRule(input)),
    history: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(async ({ input }) => listAlertHistory(input?.limit ?? 50)),
    recordLocal: publicProcedure.input(z.object({ symbol: z.string().trim().toUpperCase().max(10), alertType: z.enum(["demand", "target1", "target2", "target3", "stopLoss", "trailingStop"]), price: z.string(), rangeLabel: z.string(), provider: z.string() })).mutation(async ({ input }) => { await addAlertHistory({ ...input, delivery: "browser" }); return { success: true } as const; }),
  }),
  trade: router({
    track: publicProcedure.input(z.object({ symbol: symbolSchema, active: z.boolean(), entryPrice: priceSchema.optional(), trailingPercent: priceSchema.optional() })).mutation(async ({ input }) => trackTrade(input.symbol, input.active, input.entryPrice, input.trailingPercent)),
    close: publicProcedure.input(z.object({ symbol: symbolSchema, price: priceSchema })).mutation(({ input }) => closeTrade(input.symbol, Number(input.price))),
    trailingSettings: publicProcedure.input(z.object({ symbol: symbolSchema, trailingPercent: priceSchema })).mutation(({ input }) => updateTrailingSettings(input.symbol, input.trailingPercent)),
  }),
  telegram: router({
    status: publicProcedure.query(async () => { const settings = await getTelegramSettings(); return { configured: telegramConfigured(), enabled: Boolean(settings?.enabled), chatId: settings?.chatId ?? "", scheduled: Boolean(settings?.scheduleCronTaskUid) }; }),
    save: publicProcedure.input(z.object({ chatId: z.string().trim().min(1).max(128), enabled: z.boolean() })).mutation(async ({ input }) => { const settings = await saveTelegramSettings(input.chatId, input.enabled ? 1 : 0); return { configured: telegramConfigured(), enabled: Boolean(settings?.enabled), chatId: settings?.chatId ?? input.chatId }; }),
    test: publicProcedure.input(z.object({ chatId: z.string().trim().min(1).max(128) })).mutation(async ({ input }) => { await sendTelegramMessage("Signal Desk v5.1\nتم اختبار اتصال Telegram بنجاح.", input.chatId); return { success: true } as const; }),
    schedule: publicProcedure.mutation(async ({ ctx }) => { const settings = await getTelegramSettings(); if (!settings?.chatId) throw new Error("احفظ Chat ID أولاً"); if (settings.scheduleCronTaskUid) return { scheduled: true, taskUid: settings.scheduleCronTaskUid }; const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? ""; const job = await createHeartbeatJob({ name: "signal-desk-telegram-alerts", cron: "0 * * * * *", path: "/api/scheduled/check-alerts", description: "Check Signal Desk price alert ranges and send Telegram notifications." }, sessionToken); await setTelegramScheduleTaskUid(job.taskUid); return { scheduled: true, taskUid: job.taskUid }; }),
  }),
  watchlist: router({ list: publicProcedure.query(() => listPermanentWatchlist()), add: publicProcedure.input(z.object({ symbol: symbolSchema, source: z.string().max(32).default("radar") })).mutation(({ input }) => addPermanentWatch(input.symbol, input.source)) }),
  radar: router({
    list: publicProcedure.query(() => listRadar()),
    status: publicProcedure.query(async () => ({ settings: await getRadarSettings(), count: (await listRadar()).length })),
    scanNow: publicProcedure.mutation(() => scanRadar()),
    notifyTop: publicProcedure.mutation(() => scanAndNotifyRadar()),
    addToWatchlist: publicProcedure.input(z.object({ symbol: symbolSchema })).mutation(({ input }) => addPermanentWatch(input.symbol, "radar")),
    schedule: publicProcedure.mutation(async ({ ctx }) => { const settings = await getRadarSettings(); if (settings?.scheduleCronTaskUid) return { scheduled: true, taskUid: settings.scheduleCronTaskUid }; const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? ""; const job = await createHeartbeatJob({ name: "signal-desk-radar-scan", cron: "0 0 * * * *", path: "/api/scheduled/scan-radar", description: "Refresh the capped 30-stock liquidity and momentum radar." }, sessionToken); await setRadarScheduleTaskUid(job.taskUid); return { scheduled: true, taskUid: job.taskUid }; }),
  }),
});

export type AppRouter = typeof appRouter;
