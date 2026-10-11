import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_ADMIN_TIMEOUT_SECONDS,
  GrammyTelegramBot,
  type TelegramBot,
} from "./telegram/telegram-bot.js";
import {
  TelegramLinkService,
  WEBHOOK_RECHECK_MS,
  WEBHOOK_RETRY_DELAYS_MS,
} from "./telegram/telegram-link.service.js";

const WEBHOOK_URL = "https://hooks.outegro.test/telegram";
const SECRET = "s".repeat(64);
const NETWORK_ERROR = "Network request for 'setWebhook' failed!";

type Outcome = "drop" | "hang" | "ok";

/** A stand-in Bot API: each call gets the next scripted outcome, then "ok". */
async function fakeBotApi(script: Outcome[]) {
  const calls: { method: string; body: unknown }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({
      method: req.url?.split("/").at(-1) ?? "",
      body: JSON.parse(raw || "{}"),
    });
    const outcome = script.shift() ?? "ok";
    // The connection dies mid-call, as on 11.10.
    if (outcome === "drop") return void req.socket.destroy();
    if (outcome === "hang") return;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    calls,
    bot: new GrammyTelegramBot("123:test", {
      apiRoot: `http://127.0.0.1:${port}`,
    }),
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** Fails the first `failures` registrations, then accepts. */
class ScriptedBot implements TelegramBot {
  readonly configured = true;
  calls = 0;
  constructor(private readonly failures: number) {}
  async status() {
    return { configured: false as const };
  }
  async registerWebhook() {
    this.calls++;
    if (this.calls <= this.failures) throw new Error(NETWORK_ERROR);
  }
}

const linkService = (bot: TelegramBot) =>
  new TelegramLinkService(
    {} as never,
    {} as never,
    {} as never,
    bot,
    { telegramWebhookUrl: WEBHOOK_URL, telegramWebhookSecret: SECRET } as never,
    {} as never,
  );

let logs: Record<"log" | "warn" | "error" | "debug", unknown[][]>;
let services: TelegramLinkService[];

beforeEach(() => {
  logs = { log: [], warn: [], error: [], debug: [] };
  for (const level of ["log", "warn", "error", "debug"] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args) => {
      logs[level].push(args);
    });
  }
  services = [];
  // Only our timers are fake: sockets and the fake API run for real.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  for (const service of services) service.onApplicationShutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = (bot: TelegramBot) => {
  const service = linkService(bot);
  services.push(service);
  return { service, bootstrap: service.onApplicationBootstrap() };
};

describe("Telegram webhook registration", () => {
  it("retries a call the network dropped and registers on the next attempt", async () => {
    const api = await fakeBotApi(["drop"]);
    try {
      start(api.bot);
      await vi.waitFor(() => expect(logs.warn).toHaveLength(1));
      expect(logs.warn[0]).toEqual([
        {
          err: NETWORK_ERROR,
          attempt: 1,
          retryInMs: WEBHOOK_RETRY_DELAYS_MS[0],
        },
        "Telegram webhook registration failed, retrying",
      ]);
      expect(logs.log).toEqual([]);

      await vi.advanceTimersByTimeAsync(WEBHOOK_RETRY_DELAYS_MS[0] ?? 0);
      await vi.waitFor(() => expect(logs.log).toHaveLength(1));
      expect(logs.log[0]).toEqual([
        { attempt: 2 },
        "Telegram webhook registered",
      ]);
      expect(api.calls).toEqual([
        expect.objectContaining({ method: "setWebhook" }),
        {
          method: "setWebhook",
          body: {
            url: WEBHOOK_URL,
            secret_token: SECRET,
            allowed_updates: ["message", "my_chat_member"],
          },
        },
      ]);
      expect(logs.error).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      api.close();
    }
  });

  it("does not hold startup, and a call Telegram never answers times out into a retry", async () => {
    const api = await fakeBotApi(["hang"]);
    try {
      const { bootstrap } = start(api.bot);
      // Nothing to await: startup goes on while Telegram is silent.
      expect(bootstrap).toBeUndefined();
      await vi.waitFor(() => expect(api.calls).toHaveLength(1));
      expect(logs.warn).toEqual([]);

      await vi.advanceTimersByTimeAsync(BOT_ADMIN_TIMEOUT_SECONDS * 1000);
      await vi.waitFor(() => expect(logs.warn).toHaveLength(1));
      expect(logs.warn[0]?.[0]).toMatchObject({
        err: NETWORK_ERROR,
        attempt: 1,
      });

      await vi.advanceTimersByTimeAsync(WEBHOOK_RETRY_DELAYS_MS[0] ?? 0);
      await vi.waitFor(() => expect(logs.log).toHaveLength(1));
      expect(api.calls).toHaveLength(2);
    } finally {
      api.close();
    }
  });

  it("gives up loudly once after about two minutes, then rechecks every 15 min until it succeeds", async () => {
    const bot = new ScriptedBot(WEBHOOK_RETRY_DELAYS_MS.length + 2);
    start(bot);
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
      expect(logs.error).toEqual([]);
      await vi.advanceTimersByTimeAsync(delay);
    }
    const total = WEBHOOK_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThanOrEqual(120_000);
    expect(bot.calls).toBe(WEBHOOK_RETRY_DELAYS_MS.length + 1);
    expect(logs.warn.map(([fields]) => fields)).toEqual(
      WEBHOOK_RETRY_DELAYS_MS.map((retryInMs, i) => ({
        err: NETWORK_ERROR,
        attempt: i + 1,
        retryInMs,
      })),
    );
    expect(logs.error).toEqual([
      [
        {
          err: NETWORK_ERROR,
          attempts: WEBHOOK_RETRY_DELAYS_MS.length + 1,
          retryEveryMs: WEBHOOK_RECHECK_MS,
        },
        "Telegram webhook registration keeps failing; linking is unavailable until it succeeds",
      ],
    ]);

    // The slow retries: still failing is not news.
    await vi.advanceTimersByTimeAsync(WEBHOOK_RECHECK_MS - 1);
    expect(bot.calls).toBe(WEBHOOK_RETRY_DELAYS_MS.length + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bot.calls).toBe(WEBHOOK_RETRY_DELAYS_MS.length + 2);
    expect(logs.error).toHaveLength(1);
    expect(logs.warn).toHaveLength(WEBHOOK_RETRY_DELAYS_MS.length);
    expect(logs.debug).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(WEBHOOK_RECHECK_MS);
    expect(logs.log).toEqual([
      [
        { attempt: WEBHOOK_RETRY_DELAYS_MS.length + 3 },
        "Telegram webhook registered",
      ],
    ]);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(bot.calls).toBe(WEBHOOK_RETRY_DELAYS_MS.length + 3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying at shutdown, also when an attempt fails after it", async () => {
    const bot = new ScriptedBot(Number.POSITIVE_INFINITY);
    const { service } = start(bot);
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.calls).toBe(1);
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(bot.calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    let fail: (error: Error) => void = () => undefined;
    const late = start({
      configured: true,
      status: async () => ({ configured: false }),
      registerWebhook: () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    });
    late.service.onApplicationShutdown();
    fail(new Error(NETWORK_ERROR));
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(logs.warn).toHaveLength(1);
  });
});
