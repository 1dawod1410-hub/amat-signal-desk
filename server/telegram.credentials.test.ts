import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("Telegram bot credential", () => {
  it("accepts the configured token at Telegram getMe", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token, "TELEGRAM_BOT_TOKEN must be configured").toBeTruthy();
    const { stdout } = await execFileAsync("curl", ["--silent", "--show-error", "--fail", "--max-time", "20", `https://api.telegram.org/bot${token}/getMe`], { maxBuffer: 1024 * 1024 });
    const body = JSON.parse(stdout) as { ok?: boolean; result?: { is_bot?: boolean } };
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
  }, 30_000);
});
