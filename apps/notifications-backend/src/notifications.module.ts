import { Module } from "@nestjs/common";
import { AuthCodesController } from "./auth-codes/auth-codes.controller.js";
import { providers } from "./channels/providers.js";
import { DeliveryWorker } from "./delivery/delivery.worker.js";
import { InboxController } from "./inbox/inbox.controller.js";
import { IntentsService } from "./intents/intents.service.js";
import { RecipientsService } from "./recipients/recipients.service.js";

@Module({
  controllers: [AuthCodesController, InboxController],
  providers: [...providers, DeliveryWorker, IntentsService, RecipientsService],
})
export class NotificationsModule {}
