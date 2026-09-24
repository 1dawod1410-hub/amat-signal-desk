import { afterEach, describe, expect, it } from "vitest";
import { telegramConfigured } from "./telegram";

describe("Telegram configuration", () => {
  const original = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = original;
  });

  it("reports missing bot token without exposing credentials", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(telegramConfigured()).toBe(false);
  });

  it("detects a configured bot token", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token-not-used-for-network";
    expect(telegramConfigured()).toBe(true);
  });
});
