import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { createEvent, notificationDeliveryChanged } from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import { CLOCK, type Clock, DATABASE, OutboxRelay } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { SettingsService } from "../admin/settings.service.js";
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  PermanentDeliveryError,
  TELEGRAM_PROVIDER,
  type TelegramProvider,
  UnknownOutcomeError,
} from "../channels/providers.js";
import type { NotificationsDatabase } from "../common/database.js";
import { channelsConfig } from "../config/config.js";
import {
  deliveries,
  deliveryStates,
  intents,
  preferences,
  recipients,
} from "../db/schema.js";
import { channelEnabled } from "../intents/preferences.js";
import { templateFor } from "../templates/registry.js";
import { renderEmail } from "../templates/render.js";

/** Notifications contract: retries after 15 s, 1 min, 5 min, 15 min, then failed. */
export const RETRY_DELAYS_MS = [15_000, 60_000, 300_000, 900_000];
const LEASE_MS = 60_000;

type State = (typeof deliveryStates)[number];
type Claimed = typeof deliveries.$inferSelect & { leaseToken: string };

class Skip extends Error {
  constructor(
    readonly state: State,
    reason: string,
  ) {
    super(reason);
  }
}

@Injectable()
export class DeliveryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("DeliveryWorker");
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  /** Tests drive the worker with tick(); the loop runs only outside tests. */
  autoStart = process.env.NODE_ENV !== "test";

  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
    private readonly relay: OutboxRelay,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    if (this.autoStart) this.schedule(0);
  }
  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  kick() {
    if (this.autoStart && !this.running) this.schedule(0);
  }
  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** One pass over due deliveries; returns how many were handled. */
  async tick(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let handled = 0;
    try {
      const batch = await this.claim(limit);
      for (const delivery of batch) {
        await this.process(delivery);
        handled++;
      }
      if (batch.length === limit) this.schedule(0);
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Delivery pass failed",
      );
    } finally {
      this.running = false;
      if (this.autoStart) this.schedule(1000);
    }
    return handled;
  }

  /** Claims due deliveries; an expired lease (crashed worker) is claimable again. */
  async claim(limit: number): Promise<Claimed[]> {
    const now = this.clock.now();
    const leaseToken = randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    // A paused channel keeps its deliveries pending until an operator resumes it.
    const paused = await this.settings.pausedChannels();
    const channelFilter = paused.length
      ? sql` and channel not in ${paused}`
      : sql``;
    const result = await this.database.db.execute<{ id: string }>(sql`
      update deliveries
         set state = 'leased', lease_token = ${leaseToken}, lease_until = ${leaseUntil.toISOString()},
             attempts = attempts + 1, updated_at = ${now.toISOString()}
       where id in (
         select id from deliveries
          where ((state in ('pending', 'retry_wait') and next_attempt_at <= ${now.toISOString()})
             or (state = 'leased' and lease_until < ${now.toISOString()}))${channelFilter}
          order by next_attempt_at
          limit ${limit}
          for update skip locked)
      returning id`);
    const ids = result.rows.map((row) => row.id);
    if (!ids.length) return [];
    const rows = await this.database.db
      .select()
      .from(deliveries)
      .where(sql`${deliveries.id} in ${ids}`);
    return rows.map((row) => ({ ...row, leaseToken }));
  }

  private async process(delivery: Claimed) {
    try {
      const outcome = await this.send(delivery);
      await this.finish(delivery, "accepted", {
        providerMessageId: outcome.id,
      });
    } catch (error) {
      if (error instanceof Skip) {
        await this.finish(delivery, error.state, { lastError: error.message });
      } else if (error instanceof PermanentDeliveryError) {
        await this.finish(delivery, "failed", { lastError: error.message });
      } else if (error instanceof UnknownOutcomeError) {
        await this.finish(delivery, "unknown", { lastError: error.message });
      } else {
        const delay = RETRY_DELAYS_MS[delivery.attempts - 1];
        const message = (error as Error).message ?? "error";
        if (delay === undefined) {
          await this.finish(delivery, "failed", { lastError: message });
        } else {
          await this.finish(delivery, "retry_wait", {
            lastError: message,
            nextAttemptAt: new Date(this.clock.now().getTime() + delay),
          });
        }
      }
    }
  }

  /** Every check happens right before sending, on current data. */
  private async send(delivery: Claimed) {
    const now = this.clock.now();
    const [intent] = await this.database.db
      .select()
      .from(intents)
      .where(eq(intents.id, delivery.intentId));
    if (!intent) throw new Skip("failed", "intent missing");
    if (intent.expiresAt <= now)
      throw new Skip("expired", "message no longer relevant");
    const template = templateFor(intent.templateKey);
    const [recipient] = await this.database.db
      .select()
      .from(recipients)
      .where(eq(recipients.userId, delivery.userId));
    // Identity events may still be on their way: retry rather than fail.
    if (!recipient) throw new Error("recipient not known yet");
    if (recipient.status !== "active")
      throw new Skip("failed", `recipient ${recipient.status}`);
    const prefs = await this.database.db
      .select({
        category: preferences.category,
        channel: preferences.channel,
        enabled: preferences.enabled,
      })
      .from(preferences)
      .where(eq(preferences.userId, delivery.userId));
    if (!channelEnabled(template, delivery.channel, prefs)) {
      throw new Skip("failed", "disabled by user");
    }
    const locale = intent.locale ?? recipient.locale;
    const data = intent.data as Record<
      string,
      string | number | boolean | null
    >;
    if (delivery.channel === "email") {
      if (!recipient.email || !recipient.emailVerified)
        throw new Skip("failed", "no verified email");
      const rendered = await renderEmail(intent.templateKey, locale, data, {
        webUrl: this.config.publicWebUrl,
        accountUrl: this.config.accountUrl,
      });
      return this.email.send({
        to: recipient.email,
        ...rendered,
        idempotencyKey: delivery.id,
      });
    }
    if (!recipient.telegramChatId)
      throw new Skip("failed", "telegram not linked");
    return this.telegram.send(
      recipient.telegramChatId,
      template.text(locale, data),
    );
  }

  /** Records the outcome only while holding the lease, with its event. */
  private async finish(
    delivery: Claimed,
    state: State,
    fields: {
      providerMessageId?: string;
      lastError?: string;
      nextAttemptAt?: Date;
    },
  ) {
    const now = this.clock.now();
    const updated = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(deliveries)
        .set({
          state,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
          version: sql`${deliveries.version} + 1`,
          ...(fields.providerMessageId
            ? { providerMessageId: fields.providerMessageId }
            : {}),
          ...(fields.lastError
            ? { lastError: fields.lastError.slice(0, 500) }
            : {}),
          ...(fields.nextAttemptAt
            ? { nextAttemptAt: fields.nextAttemptAt }
            : {}),
        })
        .where(
          and(
            eq(deliveries.id, delivery.id),
            eq(deliveries.leaseToken, delivery.leaseToken),
          ),
        )
        .returning({ version: deliveries.version });
      if (!row) return false;
      if (state !== "retry_wait") {
        await enqueueEvent(
          tx,
          createEvent(notificationDeliveryChanged, {
            aggregateId: delivery.id,
            aggregateVersion: row.version,
            occurredAt: now,
            payload: {
              deliveryId: delivery.id,
              intentId: delivery.intentId,
              userId: delivery.userId,
              channel: delivery.channel,
              state,
            },
          }),
        );
      }
      return true;
    });
    if (updated) this.relay.kick();
    else
      this.logger.warn(
        { deliveryId: delivery.id },
        "Lease lost before recording outcome",
      );
  }
}
