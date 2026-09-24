import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookie } from "cookie";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { createHeartbeatJob } from "./_core/heartbeat";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addAlertHistory, getAlertRule, getTelegramSettings, listAlertHistory, saveAlertRule, saveTelegramSettings, setTelegramScheduleTaskUid } from "./db";
import { getMarketData } from "./marketData";
import { sendTelegramMessage, telegramConfigured } from "./telegram";

const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.-]{0,9}$/);
const rangeSchema = z.string().trim().regex(/^\d+(\.\d{1,4})?$/).refine((value) => Number(value) > 0, "Range value must be positive");
const alertInput = z.object({ symbol: symbolSchema, demandLow: rangeSchema, demandHigh: rangeSchema, target1Low: rangeSchema, target1High: rangeSchema, target2Low: rangeSchema, target2High: rangeSchema });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  market: router({ quote: publicProcedure.input(z.object({ symbol: symbolSchema })).query(async ({ input }) => getMarketData(input.symbol)) }),
  alerts: router({
    rule: publicProcedure.input(z.object({ symbol: symbolSchema })).query(async ({ input }) => getAlertRule(input.symbol)),
    saveRule: publicProcedure.input(alertInput).mutation(async ({ input }) => saveAlertRule(input)),
    history: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(async ({ input }) => listAlertHistory(input?.limit ?? 50)),
    recordLocal: publicProcedure.input(z.object({ symbol: symbolSchema, alertType: z.enum(["demand", "target1", "target2"]), price: z.string(), rangeLabel: z.string(), provider: z.string() })).mutation(async ({ input }) => { await addAlertHistory({ ...input, delivery: "browser" }); return { success: true } as const; }),
  }),
  telegram: router({
    status: publicProcedure.query(async () => { const settings = await getTelegramSettings(); return { configured: telegramConfigured(), enabled: Boolean(settings?.enabled), chatId: settings?.chatId ?? "", scheduled: Boolean(settings?.scheduleCronTaskUid) }; }),
    save: publicProcedure.input(z.object({ chatId: z.string().trim().min(1).max(128), enabled: z.boolean() })).mutation(async ({ input }) => { const settings = await saveTelegramSettings(input.chatId, input.enabled ? 1 : 0); return { configured: telegramConfigured(), enabled: Boolean(settings?.enabled), chatId: settings?.chatId ?? input.chatId }; }),
    test: publicProcedure.input(z.object({ chatId: z.string().trim().min(1).max(128) })).mutation(async ({ input }) => { await sendTelegramMessage("Signal Desk v5\nتم اختبار اتصال Telegram بنجاح.", input.chatId); return { success: true } as const; }),
    schedule: publicProcedure.mutation(async ({ ctx }) => {
      const settings = await getTelegramSettings();
      if (!settings?.chatId) throw new Error("احفظ Chat ID أولاً");
      if (settings.scheduleCronTaskUid) return { scheduled: true, taskUid: settings.scheduleCronTaskUid };
      const cookies = parseCookie(ctx.req.headers.cookie ?? "");
      const sessionToken = cookies[COOKIE_NAME] ?? "";
      const job = await createHeartbeatJob({ name: "signal-desk-telegram-alerts", cron: "0 * * * * *", path: "/api/scheduled/check-alerts", description: "Check Signal Desk price alert ranges and send Telegram notifications." }, sessionToken);
      await setTelegramScheduleTaskUid(job.taskUid);
      return { scheduled: true, taskUid: job.taskUid };
    }),
  }),
});

export type AppRouter = typeof appRouter;
