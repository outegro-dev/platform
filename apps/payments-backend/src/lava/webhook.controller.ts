import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Public } from "@outegro/nest-common";
import { ProviderEvents } from "../billing/provider-events.js";
import { LavaWebhookGuard } from "./webhook.guard.js";

/**
 * POST /webhooks/lava (outside the /v1 prefix, no user session). 2xx only
 * after the event is durably stored; a database failure is a 5xx so Lava
 * retries. Unknown and invalid authenticated events are stored without effect.
 */
@Public()
@Controller("webhooks")
export class LavaWebhookController {
  constructor(private readonly events: ProviderEvents) {}

  @Post("lava")
  @HttpCode(200)
  @UseGuards(LavaWebhookGuard)
  receive(@Body() body: unknown) {
    return this.events.receiveWebhook(body);
  }
}
