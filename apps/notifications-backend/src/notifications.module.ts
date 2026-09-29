import { Module } from "@nestjs/common";
import { NotificationsAdminController } from "./admin/admin.controller.js";
import { SettingsService } from "./admin/settings.service.js";
import { AuthCodesController } from "./auth-codes/auth-codes.controller.js";
import { providers } from "./channels/providers.js";
import { DeliveryWorker } from "./delivery/delivery.worker.js";
import { InboxController } from "./inbox/inbox.controller.js";
import { IntentsService } from "./intents/intents.service.js";
import { RecipientsService } from "./recipients/recipients.service.js";
import { TelegramController } from "./telegram/telegram.controller.js";
import { telegramBotProvider } from "./telegram/telegram-bot.js";
import { TelegramLinkService } from "./telegram/telegram-link.service.js";

@Module({
  controllers: [
    AuthCodesController,
    InboxController,
    TelegramController,
    NotificationsAdminController,
  ],
  providers: [
    ...providers,
    telegramBotProvider,
    DeliveryWorker,
    IntentsService,
    RecipientsService,
    SettingsService,
    TelegramLinkService,
  ],
})
export class NotificationsModule {}
