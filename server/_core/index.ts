import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { runAlertSweep, sendTelegramMessage } from "../telegram";
import { scanAndNotifyRadar } from "../radar";
import { getRadarSettingsByTaskUid, getTelegramSettings, listProviderHealth, markProviderHealthNotified } from "../db";
import { checkAllProviders } from "../providerHealth";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  app.post("/api/scheduled/check-alerts", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await runAlertSweep();
      const healthBeforeChecks = new Map((await listProviderHealth()).map((health) => [health.provider, health]));
      await checkAllProviders();
      const settings = await getTelegramSettings();
      for (const health of await listProviderHealth()) {
        const previous = healthBeforeChecks.get(health.provider);
        const recovered = Boolean(previous && !previous.ok && previous.failureCount >= 3 && health.ok);
        if (recovered && settings?.enabled && settings.chatId && process.env.TELEGRAM_BOT_TOKEN) {
          try { await sendTelegramMessage(`Signal Desk\n✅ Provider recovered\n${health.provider} is responding again after ${previous?.failureCount ?? 0} consecutive failures.`, settings.chatId); await markProviderHealthNotified(health.id); } catch { /* retry on a later heartbeat */ }
        }
        const due = health.failureCount >= 3 && (!health.lastNotifiedAt || Date.now() - health.lastNotifiedAt.getTime() > 6 * 60 * 60 * 1000);
        if (due && settings?.enabled && settings.chatId && process.env.TELEGRAM_BOT_TOKEN) {
          try { await sendTelegramMessage(`Signal Desk\n⚠️ Provider health warning\n${health.provider} failed ${health.failureCount} consecutive checks.\nLast error: ${health.lastError ?? "unknown"}`, settings.chatId); await markProviderHealthNotified(health.id); } catch { /* retry on a later heartbeat */ }
        }
      }
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
    }
  });
  app.post("/api/scheduled/scan-radar", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      if (!(await getRadarSettingsByTaskUid(user.taskUid))) return res.json({ ok: true, skipped: "orphan" });
      return res.json({ ok: true, ...(await scanAndNotifyRadar()) });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
    }
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
