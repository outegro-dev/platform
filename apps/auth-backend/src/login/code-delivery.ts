import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type { Locale } from "@outegro/contracts";
import { callInternal } from "@outegro/nest-common";
import { internalConfig } from "../config/config.js";

export type CodeMessage = {
  challengeId: string;
  email: string;
  code: string;
  locale: Locale;
  expiresAt: string;
};

export type DeliveryStatus = "accepted" | "failed";

/** How Identity hands a login code to Notifications (ADR-008). */
export interface CodeDelivery {
  deliver(
    message: CodeMessage,
    requestId: string | null,
  ): Promise<DeliveryStatus>;
}
export const CODE_DELIVERY = Symbol("CODE_DELIVERY");

/**
 * Private, synchronous call to Notifications: the code never enters the
 * broker, the outbox, audit or logs, and cannot be delivered after it expires.
 */
@Injectable()
export class HttpCodeDelivery implements CodeDelivery {
  private readonly logger = new Logger("CodeDelivery");

  constructor(
    @Inject(internalConfig.KEY)
    private readonly config: ConfigType<typeof internalConfig>,
  ) {}

  async deliver(
    message: CodeMessage,
    requestId: string | null,
  ): Promise<DeliveryStatus> {
    try {
      const result = await callInternal<{ status: DeliveryStatus }>(
        `${this.config.notificationsUrl}/v1/internal/auth-codes`,
        {
          token: this.config.token,
          body: message,
          timeoutMs: 8000,
          requestId: requestId ?? undefined,
        },
      );
      return result.status;
    } catch (error) {
      this.logger.warn(
        { challengeId: message.challengeId, err: (error as Error).message },
        "Login code delivery failed",
      );
      return "failed";
    }
  }
}
