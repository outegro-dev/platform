import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AppError } from "@outegro/nest-common";
import type { Request } from "express";
import { lavaConfig } from "../config/config.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Lava webhook credential: the X-Api-Key header must equal
 * LAVA_WEBHOOK_SECRET. Compared as SHA-256 digests with timingSafeEqual,
 * so neither content nor length leaks through timing. Runs before the
 * payload is trusted or stored (TC-PAY-04-01).
 */
@Injectable()
export class LavaWebhookGuard implements CanActivate {
  private readonly logger = new Logger("LavaWebhook");
  private readonly expected: Buffer;

  constructor(@Inject(lavaConfig.KEY) config: ConfigType<typeof lavaConfig>) {
    this.expected = digest(config.webhookSecret);
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers["x-api-key"];
    const presented = typeof header === "string" ? header : "";
    if (!presented || !timingSafeEqual(digest(presented), this.expected)) {
      this.logger.warn(
        { ip: request.ip },
        "Webhook with a wrong or missing credential",
      );
      throw new AppError("UNAUTHENTICATED");
    }
    return true;
  }
}
