import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { Api, GrammyError, HttpError } from "grammy";
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { channelsConfig } from "../config/config.js";

/** Retrying cannot help: bad address, blocked bot, rejected content. */
export class PermanentDeliveryError extends Error {}
/** The provider may or may not have delivered; do not blindly resend. */
export class UnknownOutcomeError extends Error {}

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key on every retry of one delivery: the provider drops duplicates. */
  idempotencyKey: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string }>;
}
export interface TelegramProvider {
  send(chatId: string, text: string): Promise<{ id: string }>;
}
export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
export const TELEGRAM_PROVIDER = Symbol("TELEGRAM_PROVIDER");

/** Production: Resend with idempotency keys (24 h window). */
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send(
      {
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (data) return { id: data.id };
    const name = error?.name ?? "unknown_error";
    if (
      [
        "validation_error",
        "invalid_to_address",
        "invalid_from_address",
        "restricted_api_key",
      ].includes(name)
    ) {
      throw new PermanentDeliveryError(name);
    }
    throw new Error(name);
  }
}

/** Local development: SMTP to Mailpit (http://localhost:8025). */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnApplicationShutdown {
  private readonly transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: EmailMessage) {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { "X-Idempotency-Key": message.idempotencyKey },
      });
      return { id: info.messageId };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode ?? 0;
      if (code >= 500 && code < 600)
        throw new PermanentDeliveryError(`smtp ${code}`);
      throw error;
    }
  }

  onApplicationShutdown() {
    this.transport.close();
  }
}

/** Telegram Bot API through grammY. No idempotency: timeouts become "unknown". */
export class GrammyTelegramProvider implements TelegramProvider {
  private readonly api: Api;
  constructor(token: string) {
    this.api = new Api(token);
  }

  async send(chatId: string, text: string) {
    try {
      const message = await this.api.sendMessage(chatId, text, {
        link_preview_options: { is_disabled: true },
      });
      return { id: String(message.message_id) };
    } catch (error) {
      if (
        error instanceof GrammyError &&
        [400, 403].includes(error.error_code)
      ) {
        throw new PermanentDeliveryError(`telegram ${error.error_code}`);
      }
      if (error instanceof HttpError)
        throw new UnknownOutcomeError(error.message);
      throw error;
    }
  }
}

/** Used when no bot is configured: every Telegram delivery is unavailable. */
export class DisabledTelegramProvider implements TelegramProvider {
  async send(): Promise<{ id: string }> {
    throw new PermanentDeliveryError("telegram not configured");
  }
}

export const providers = [
  {
    provide: EMAIL_PROVIDER,
    inject: [channelsConfig.KEY],
    useFactory: (config: ConfigType<typeof channelsConfig>): EmailProvider =>
      config.emailProvider === "resend" && config.resendApiKey
        ? new ResendEmailProvider(config.resendApiKey, config.emailFrom)
        : new SmtpEmailProvider(config.smtpUrl, config.emailFrom),
  },
  {
    provide: TELEGRAM_PROVIDER,
    inject: [channelsConfig.KEY],
    useFactory: (
      config: ConfigType<typeof channelsConfig>,
    ): TelegramProvider =>
      config.telegramBotToken
        ? new GrammyTelegramProvider(config.telegramBotToken)
        : new DisabledTelegramProvider(),
  },
];
