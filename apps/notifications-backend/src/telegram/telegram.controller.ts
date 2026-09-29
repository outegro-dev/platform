import { timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
  Public,
} from "@outegro/nest-common";
import { channelsConfig } from "../config/config.js";
import { TelegramLinkService } from "./telegram-link.service.js";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

@Controller()
export class TelegramController {
  constructor(
    private readonly links: TelegramLinkService,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
  ) {}

  @Get("me/telegram")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.links.status(user.userId);
  }

  /** A fresh one-time deep link; opening it in Telegram links the chat. */
  @Post("me/telegram/link")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  link(@CurrentUser() user: AuthenticatedUser) {
    return this.links.createLink(user.userId);
  }

  @Delete("me/telegram")
  @HttpCode(204)
  async unlink(@CurrentUser() user: AuthenticatedUser) {
    await this.links.unlink(user.userId);
  }

  /** Telegram Bot API webhook, authenticated by the secret token it echoes. */
  @Public()
  @Post("webhooks/telegram")
  @HttpCode(200)
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = this.config.telegramWebhookSecret;
    if (!expected || !secret || !sameSecret(secret, expected))
      throw new AppError("UNAUTHENTICATED");
    await this.links.handleUpdate(body);
    return { ok: true };
  }
}
