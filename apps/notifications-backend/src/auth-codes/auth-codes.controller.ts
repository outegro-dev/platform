import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { localeSchema } from "@outegro/contracts";
import {
  CLOCK,
  type Clock,
  createServiceTokenGuard,
  Public,
} from "@outegro/nest-common";
import { z } from "zod";
import { EMAIL_PROVIDER, type EmailProvider } from "../channels/providers.js";
import { channelsConfig } from "../config/config.js";
import { env } from "../config/env.js";
import { renderEmail } from "../templates/render.js";

const codeSchema = z.object({
  challengeId: z.uuid(),
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
  locale: localeSchema,
  expiresAt: z.iso.datetime(),
});

const ServiceToken = createServiceTokenGuard(() => env().INTERNAL_API_TOKEN);
const SEND_TIMEOUT_MS = 5000;

/**
 * Private login-code delivery for Identity (ADR-008). Synchronous, nothing
 * persisted, the code is never logged, and nothing is sent after expiry.
 */
@Public()
@UseGuards(ServiceToken)
@Controller("internal/auth-codes")
export class AuthCodesController {
  private readonly logger = new Logger("AuthCodes");

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
  ) {}

  @Post()
  @HttpCode(200)
  async deliver(
    @Body({ schema: codeSchema }) body: z.infer<typeof codeSchema>,
  ) {
    const now = this.clock.now();
    const expiresAt = new Date(body.expiresAt);
    if (expiresAt <= now) {
      this.logger.warn(
        { challengeId: body.challengeId },
        "Login code expired before delivery",
      );
      return { status: "failed" as const, reason: "expired" };
    }
    const minutes = Math.max(
      1,
      Math.round((expiresAt.getTime() - now.getTime()) / 60_000),
    );
    const rendered = await renderEmail(
      "auth.login-code",
      body.locale,
      { code: body.code, minutes },
      this.config.publicWebUrl,
    );
    try {
      await Promise.race([
        this.email.send({
          to: body.email,
          ...rendered,
          idempotencyKey: `auth-code:${body.challengeId}`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("provider timeout")),
            SEND_TIMEOUT_MS,
          ),
        ),
      ]);
      this.logger.log(
        { challengeId: body.challengeId },
        "Login code accepted by provider",
      );
      return { status: "accepted" as const };
    } catch (error) {
      this.logger.warn(
        { challengeId: body.challengeId, err: (error as Error).message },
        "Login code delivery failed",
      );
      return { status: "failed" as const, reason: "provider" };
    }
  }
}
