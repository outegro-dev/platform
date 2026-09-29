import type { ConfigType } from "@nestjs/config";
import { Api } from "grammy";
import { channelsConfig } from "../config/config.js";

export type TelegramStatus =
  | { configured: false }
  | {
      configured: true;
      /** null when Telegram could not be reached. */
      username: string | null;
      webhook: {
        url: string | null;
        pendingUpdates: number;
        lastErrorAt: string | null;
        lastError: string | null;
      } | null;
    };

/** Bot administration (webhook, status), separate from message delivery. */
export interface TelegramBot {
  readonly configured: boolean;
  status(): Promise<TelegramStatus>;
  registerWebhook(url: string, secret: string): Promise<void>;
}
export const TELEGRAM_BOT = Symbol("TELEGRAM_BOT");

export class GrammyTelegramBot implements TelegramBot {
  readonly configured = true;
  private readonly api: Api;

  constructor(token: string) {
    this.api = new Api(token);
  }

  async status(): Promise<TelegramStatus> {
    try {
      const [me, hook] = await Promise.all([
        this.api.getMe(),
        this.api.getWebhookInfo(),
      ]);
      return {
        configured: true,
        username: me.username,
        webhook: {
          url: hook.url || null,
          pendingUpdates: hook.pending_update_count,
          lastErrorAt: hook.last_error_date
            ? new Date(hook.last_error_date * 1000).toISOString()
            : null,
          lastError: hook.last_error_message ?? null,
        },
      };
    } catch {
      return { configured: true, username: null, webhook: null };
    }
  }

  async registerWebhook(url: string, secret: string) {
    await this.api.setWebhook(url, {
      secret_token: secret,
      allowed_updates: ["message", "my_chat_member"],
    });
  }
}

export class DisabledTelegramBot implements TelegramBot {
  readonly configured = false;
  async status(): Promise<TelegramStatus> {
    return { configured: false };
  }
  async registerWebhook() {}
}

export const telegramBotProvider = {
  provide: TELEGRAM_BOT,
  inject: [channelsConfig.KEY],
  useFactory: (config: ConfigType<typeof channelsConfig>): TelegramBot =>
    config.telegramBotToken
      ? new GrammyTelegramBot(config.telegramBotToken)
      : new DisabledTelegramBot(),
};
