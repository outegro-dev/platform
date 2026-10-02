import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  heldBySafeMode,
} from "@outegro/nest-common";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  TELEGRAM_PROVIDER,
  type TelegramProvider,
} from "../channels/providers.js";
import type { NotificationsDatabase } from "../common/database.js";
import { channelsConfig } from "../config/config.js";
import { recipients, telegramLinks } from "../db/schema.js";
import { IntentsService } from "../intents/intents.service.js";
import { TELEGRAM_BOT, type TelegramBot } from "./telegram-bot.js";

const LINK_TTL_MS = 10 * 60_000;

const chatSchema = z.object({ id: z.number(), type: z.string() });
/** The part of a Telegram update the bot reacts to; everything else is ignored. */
const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: chatSchema,
      text: z.string().max(4096).optional(),
      from: z.object({ language_code: z.string().optional() }).optional(),
    })
    .optional(),
  my_chat_member: z
    .object({
      chat: chatSchema,
      new_chat_member: z.object({ status: z.string() }),
    })
    .optional(),
});

const START = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{16,64}))?\s*$/;
const STOP = /^\/stop(?:@\w+)?\s*$/;

type Locale = "en" | "ru";
const replies = {
  linked: {
    en: "Connected. outegro.dev notifications will arrive in this chat. Send /stop to disconnect.",
    ru: "Готово. Уведомления outegro.dev будут приходить в этот чат. Чтобы отключить, отправьте /stop.",
  },
  invalid: {
    en: "This link is invalid or has expired. Create a new one in your account: {url}",
    ru: "Ссылка недействительна или устарела. Создайте новую в аккаунте: {url}",
  },
  welcome: {
    en: "This bot delivers outegro.dev notifications. Connect it from your account: {url}",
    ru: "Этот бот присылает уведомления outegro.dev. Подключите его в аккаунте: {url}",
  },
  stopped: {
    en: "Disconnected. No more notifications will be sent here.",
    ru: "Отключено. Уведомления сюда больше не придут.",
  },
} satisfies Record<string, Record<Locale, string>>;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Links a Telegram chat to an account (N-04). The account creates a one-time
 * deep link; the chat that opens it with /start becomes the user's channel.
 * A chat belongs to at most one account, and /stop or blocking the bot unlinks.
 */
@Injectable()
export class TelegramLinkService implements OnApplicationBootstrap {
  private readonly logger = new Logger("TelegramLinks");

  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
    @Inject(TELEGRAM_BOT) private readonly bot: TelegramBot,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
    private readonly intents: IntentsService,
  ) {}

  async onApplicationBootstrap() {
    if (heldBySafeMode("telegram webhook registration")) return;
    const url = this.config.telegramWebhookUrl;
    const secret = this.config.telegramWebhookSecret;
    if (!this.bot.configured || !url || !secret) return;
    try {
      await this.bot.registerWebhook(url, secret);
      this.logger.log("Telegram webhook registered");
    } catch (error) {
      // Linking stays unavailable until the next start; delivery is unaffected.
      this.logger.error(
        { err: (error as Error).message },
        "Telegram webhook registration failed",
      );
    }
  }

  get available() {
    return this.bot.configured && !!this.config.telegramBotUsername;
  }

  async createLink(userId: string) {
    if (!this.available) throw new AppError("DEPENDENCY_UNAVAILABLE");
    const token = randomBytes(24).toString("base64url");
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
    await this.database.db.insert(telegramLinks).values({
      tokenHash: hash(token),
      userId,
      expiresAt,
      createdAt: now,
    });
    return {
      url: `https://t.me/${this.config.telegramBotUsername}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async status(userId: string) {
    const [row] = await this.database.db
      .select({
        chatId: recipients.telegramChatId,
        linkedAt: recipients.telegramLinkedAt,
      })
      .from(recipients)
      .where(eq(recipients.userId, userId));
    return {
      available: this.available,
      linked: !!row?.chatId,
      linkedAt: row?.linkedAt?.toISOString() ?? null,
      botUsername: this.config.telegramBotUsername ?? null,
    };
  }

  async unlink(userId: string) {
    await this.database.db
      .update(recipients)
      .set({
        telegramChatId: null,
        telegramLinkedAt: null,
        updatedAt: this.clock.now(),
      })
      .where(eq(recipients.userId, userId));
  }

  /** One webhook update. User input never throws: Telegram would redeliver it. */
  async handleUpdate(body: unknown) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return;
    const { message, my_chat_member: member } = parsed.data;

    if (member && member.chat.type === "private") {
      if (["kicked", "left"].includes(member.new_chat_member.status)) {
        await this.unlinkChat(String(member.chat.id));
      }
      return;
    }
    if (message?.chat.type !== "private" || !message.text) return;

    const chatId = String(message.chat.id);
    const guess: Locale = message.from?.language_code?.startsWith("ru")
      ? "ru"
      : "en";
    const settingsUrl = `${this.config.accountUrl}/account/notifications`;

    const start = START.exec(message.text.trim());
    if (start) {
      const token = start[1];
      if (!token) {
        await this.reply(chatId, replies.welcome[guess], settingsUrl);
        return;
      }
      const locale = await this.link(chatId, token);
      if (locale) await this.reply(chatId, replies.linked[locale]);
      else await this.reply(chatId, replies.invalid[guess], settingsUrl);
      return;
    }
    if (STOP.test(message.text.trim())) {
      const locale = await this.unlinkChat(chatId);
      await this.reply(chatId, replies.stopped[locale ?? guess]);
      return;
    }
    await this.reply(chatId, replies.welcome[guess], settingsUrl);
  }

  /** Consumes the token once; returns the account locale on success. */
  private async link(chatId: string, token: string): Promise<Locale | null> {
    const now = this.clock.now();
    return this.database.db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(telegramLinks)
        .set({ consumedAt: now })
        .where(
          and(
            eq(telegramLinks.tokenHash, hash(token)),
            isNull(telegramLinks.consumedAt),
            gt(telegramLinks.expiresAt, now),
          ),
        )
        .returning({ userId: telegramLinks.userId });
      if (!consumed) return null;
      // A chat belongs to one account: linking it here moves it.
      await tx
        .update(recipients)
        .set({ telegramChatId: null, telegramLinkedAt: null, updatedAt: now })
        .where(eq(recipients.telegramChatId, chatId));
      const [row] = await tx
        .insert(recipients)
        .values({
          userId: consumed.userId,
          telegramChatId: chatId,
          telegramLinkedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: recipients.userId,
          set: {
            telegramChatId: chatId,
            telegramLinkedAt: now,
            updatedAt: now,
          },
        })
        .returning({ locale: recipients.locale });
      // A new channel is a security fact: the owner hears of it by email too.
      await this.intents.record(tx, {
        sourceEventId: randomUUID(),
        producer: "notifications",
        templateKey: "security.telegram-linked.v1",
        category: "security",
        userId: consumed.userId,
        data: { at: now.toISOString() },
      });
      return row?.locale ?? "en";
    });
  }

  private async unlinkChat(chatId: string): Promise<Locale | null> {
    const [row] = await this.database.db
      .update(recipients)
      .set({
        telegramChatId: null,
        telegramLinkedAt: null,
        updatedAt: this.clock.now(),
      })
      .where(eq(recipients.telegramChatId, chatId))
      .returning({ locale: recipients.locale });
    return row?.locale ?? null;
  }

  private async reply(chatId: string, text: string, url?: string) {
    try {
      await this.telegram.send(chatId, url ? text.replace("{url}", url) : text);
    } catch (error) {
      this.logger.warn(
        { err: (error as Error).message },
        "Telegram reply failed",
      );
    }
  }
}
