import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { createEvent, notificationRequested } from "@outegro/contracts";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  CurrentUser,
  DATABASE,
  RequirePermissions,
} from "@outegro/nest-common";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  min,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../common/cursor.js";
import type { NotificationsDatabase } from "../common/database.js";
import { channelsConfig } from "../config/config.js";
import {
  adminAudit,
  deliveries,
  deliveryStates,
  intents,
  preferences,
  recipients,
} from "../db/schema.js";
import { DeliveryWorker } from "../delivery/delivery.worker.js";
import { IntentsService } from "../intents/intents.service.js";
import { TELEGRAM_BOT, type TelegramBot } from "../telegram/telegram-bot.js";
import { TelegramLinkService } from "../telegram/telegram-link.service.js";
import { templateFor, templates } from "../templates/registry.js";
import { renderEmail } from "../templates/render.js";
import { channelSettingsSchema, SettingsService } from "./settings.service.js";

const DAY_MS = 24 * 3600_000;
const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);

const deliveriesQuery = z.object({
  state: z.enum(deliveryStates).optional(),
  channel: z.enum(["email", "telegram"]).optional(),
  userId: uuid.optional(),
  template: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const retrySchema = z.object({
  reason,
  /** The provider may already have delivered an "unknown" message. */
  confirmUnknown: z.boolean().optional(),
});
const settingsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  channels: channelSettingsSchema.partial(),
  reason,
});
const previewQuery = z.object({ locale: z.enum(["en", "ru"]).default("en") });
const testSchema = z.object({ channel: z.enum(["email", "telegram"]) });

const RETRYABLE = ["failed", "unknown"] as const;
const SENSITIVE_KEY = /code|token|secret|password|^ip$/i;

/** Login codes never leave the service; other keys that look secret are hidden too. */
export function redact(
  category: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      category === "auth" || SENSITIVE_KEY.test(key) ? "[redacted]" : value,
    ]),
  );
}

export function maskEmail(email: string | null) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Notifications side of the admin console (chapter 7): read, retry, switches. */
@Controller("admin")
export class NotificationsAdminController {
  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TELEGRAM_BOT) private readonly bot: TelegramBot,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
    private readonly settings: SettingsService,
    private readonly links: TelegramLinkService,
    private readonly intents: IntentsService,
    private readonly worker: DeliveryWorker,
  ) {}

  @Get("overview")
  @RequirePermissions("notifications.read")
  async overview() {
    const db = this.database.db;
    const now = this.clock.now();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    const byState = await db
      .select({
        channel: deliveries.channel,
        state: deliveries.state,
        n: count(),
      })
      .from(deliveries)
      .where(gte(deliveries.createdAt, dayAgo))
      .groupBy(deliveries.channel, deliveries.state);
    const [backlog] = await db
      .select({ n: count(), oldest: min(deliveries.createdAt) })
      .from(deliveries)
      .where(inArray(deliveries.state, ["pending", "retry_wait", "leased"]));
    const [intents24h] = await db
      .select({ n: count() })
      .from(intents)
      .where(gte(intents.createdAt, dayAgo));
    const daily = await db.execute<{
      day: string;
      channel: string;
      ok: number;
      bad: number;
      total: number;
    }>(sql`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             channel,
             count(*) filter (where state in ('accepted', 'delivered'))::int as ok,
             count(*) filter (where state in ('failed', 'expired', 'unknown'))::int as bad,
             count(*)::int as total
        from deliveries
       where created_at >= ${weekAgo.toISOString()}
       group by 1, 2
       order by 1, 2`);
    const [people] = await db
      .select({
        total: count(),
        emailVerified: count(
          sql`case when ${recipients.emailVerified} then 1 end`,
        ),
        telegramLinked: count(recipients.telegramChatId),
      })
      .from(recipients);
    const { channels, version } = await this.settings.channels();

    const last24h: Record<string, Record<string, number>> = {
      email: {},
      telegram: {},
    };
    for (const row of byState) {
      const bucket = last24h[row.channel] ?? {};
      bucket[row.state] = row.n;
      last24h[row.channel] = bucket;
    }
    return {
      generatedAt: now.toISOString(),
      last24h: { deliveries: last24h, intents: intents24h?.n ?? 0 },
      backlog: {
        count: backlog?.n ?? 0,
        oldestCreatedAt: backlog?.oldest?.toISOString() ?? null,
      },
      daily: daily.rows,
      recipients: {
        total: people?.total ?? 0,
        emailVerified: people?.emailVerified ?? 0,
        telegramLinked: people?.telegramLinked ?? 0,
      },
      channels: {
        email: {
          provider: this.config.emailProvider,
          from: this.config.emailFrom,
          enabled: channels.email.enabled,
        },
        telegram: {
          configured: this.bot.configured,
          botUsername: this.config.telegramBotUsername ?? null,
          webhookConfigured:
            !!this.config.telegramWebhookUrl &&
            !!this.config.telegramWebhookSecret,
          linkingAvailable: this.links.available,
          enabled: channels.telegram.enabled,
        },
      },
      settingsVersion: version,
    };
  }

  @Get("deliveries")
  @RequirePermissions("notifications.read")
  async deliveries(
    @Query({ schema: deliveriesQuery }) query: z.infer<typeof deliveriesQuery>,
  ) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const filters: (SQL | undefined)[] = [
      query.state ? eq(deliveries.state, query.state) : undefined,
      query.channel ? eq(deliveries.channel, query.channel) : undefined,
      query.userId ? eq(deliveries.userId, query.userId) : undefined,
      query.template ? eq(intents.templateKey, query.template) : undefined,
      cursor
        ? or(
            lt(deliveries.createdAt, cursor.at),
            and(
              eq(deliveries.createdAt, cursor.at),
              lt(deliveries.id, cursor.id),
            ),
          )
        : undefined,
    ];
    const rows = await this.database.db
      .select({ delivery: deliveries, intent: intents })
      .from(deliveries)
      .innerJoin(intents, eq(intents.id, deliveries.intentId))
      .where(and(...filters))
      .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.delivery;
    return {
      items: page.map((row) => this.summary(row.delivery, row.intent)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  @Get("deliveries/:id")
  @RequirePermissions("notifications.read")
  async delivery(@Param("id") id: string) {
    const row = await this.load(id);
    const [recipient] = await this.database.db
      .select()
      .from(recipients)
      .where(eq(recipients.userId, row.delivery.userId));
    return {
      ...this.summary(row.delivery, row.intent),
      intent: {
        id: row.intent.id,
        producer: row.intent.producer,
        sourceEventId: row.intent.sourceEventId,
        locale: row.intent.locale,
        data: redact(
          row.intent.category,
          row.intent.data as Record<string, unknown>,
        ),
        expiresAt: row.intent.expiresAt.toISOString(),
        createdAt: row.intent.createdAt.toISOString(),
      },
      recipient: recipient
        ? {
            email: maskEmail(recipient.email),
            emailVerified: recipient.emailVerified,
            telegramLinked: !!recipient.telegramChatId,
            status: recipient.status,
            locale: recipient.locale,
          }
        : null,
      retryable:
        (RETRYABLE as readonly string[]).includes(row.delivery.state) &&
        row.intent.category !== "auth" &&
        row.intent.expiresAt > this.clock.now(),
    };
  }

  /** Puts a failed or unknown delivery back in the queue with a fresh retry schedule. */
  @Post("deliveries/:id/retry")
  @HttpCode(200)
  @RequirePermissions("notifications.retry")
  async retry(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: retrySchema }) body: z.infer<typeof retrySchema>,
  ) {
    const row = await this.load(id);
    const now = this.clock.now();
    if (row.intent.category === "auth")
      throw new AppError("CONFLICT", {
        fieldErrors: { delivery: ["private"] },
      });
    if (!(RETRYABLE as readonly string[]).includes(row.delivery.state))
      throw new AppError("CONFLICT", {
        fieldErrors: { state: ["not_retryable"] },
      });
    if (row.intent.expiresAt <= now)
      throw new AppError("CONFLICT", { fieldErrors: { intent: ["expired"] } });
    if (row.delivery.state === "unknown" && !body.confirmUnknown)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { confirmUnknown: ["required"] },
      });

    const updated = await this.database.db.transaction(async (tx) => {
      const [delivery] = await tx
        .update(deliveries)
        .set({
          state: "pending",
          attempts: 0,
          nextAttemptAt: now,
          updatedAt: now,
          version: sql`${deliveries.version} + 1`,
        })
        .where(
          and(
            eq(deliveries.id, id),
            eq(deliveries.version, row.delivery.version),
          ),
        )
        .returning();
      if (!delivery) throw new AppError("VERSION_CONFLICT");
      await tx.insert(adminAudit).values({
        actorId: user.userId,
        action: "delivery.retry",
        targetType: "delivery",
        targetId: id,
        reason: body.reason,
        data: {
          previousState: row.delivery.state,
          previousAttempts: row.delivery.attempts,
          lastError: row.delivery.lastError,
        },
        createdAt: now,
      });
      return delivery;
    });
    this.worker.kick();
    return this.summary(updated, row.intent);
  }

  @Get("recipients/:userId")
  @RequirePermissions("notifications.read")
  async recipient(@Param("userId") userId: string) {
    if (!uuid.safeParse(userId).success) throw new AppError("NOT_FOUND");
    const db = this.database.db;
    const [recipient] = await db
      .select()
      .from(recipients)
      .where(eq(recipients.userId, userId));
    if (!recipient) throw new AppError("NOT_FOUND");
    const prefs = await db
      .select({
        category: preferences.category,
        channel: preferences.channel,
        enabled: preferences.enabled,
      })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    const recent = await db
      .select({ delivery: deliveries, intent: intents })
      .from(deliveries)
      .innerJoin(intents, eq(intents.id, deliveries.intentId))
      .where(eq(deliveries.userId, userId))
      .orderBy(desc(deliveries.createdAt))
      .limit(20);
    return {
      userId,
      email: maskEmail(recipient.email),
      emailVerified: recipient.emailVerified,
      locale: recipient.locale,
      status: recipient.status,
      telegram: {
        linked: !!recipient.telegramChatId,
        linkedAt: recipient.telegramLinkedAt?.toISOString() ?? null,
      },
      optOuts: prefs.filter((p) => !p.enabled),
      recentDeliveries: recent.map((row) =>
        this.summary(row.delivery, row.intent),
      ),
    };
  }

  @Get("templates")
  @RequirePermissions("notifications.read")
  templates() {
    return {
      items: Object.entries(templates).map(([key, t]) => ({
        key,
        category: t.category,
        channels: t.channels,
        mandatory: t.mandatory,
        ttlMs: t.ttlMs,
        locales: ["en", "ru"],
      })),
    };
  }

  /** Renders a template with its sample data (never real user data). */
  @Get("templates/:key/preview")
  @RequirePermissions("notifications.read")
  async preview(
    @Param("key") key: string,
    @Query({ schema: previewQuery }) query: z.infer<typeof previewQuery>,
  ) {
    const template = templates[key];
    if (!template) throw new AppError("NOT_FOUND");
    const context = {
      webUrl: this.config.publicWebUrl,
      accountUrl: this.config.accountUrl,
    };
    const email = await renderEmail(
      key,
      query.locale,
      template.sample,
      context,
    );
    return {
      key,
      locale: query.locale,
      subject: email.subject,
      text: template.text(query.locale, template.sample),
      html: email.html,
    };
  }

  @Get("settings")
  @RequirePermissions("notifications.read")
  getSettings() {
    return this.settings.channels();
  }

  @Patch("settings")
  @RequirePermissions("services.flags")
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: settingsSchema }) body: z.infer<typeof settingsSchema>,
  ) {
    return this.settings.updateChannels({
      actorId: user.userId,
      expectedVersion: body.expectedVersion,
      channels: body.channels,
      reason: body.reason,
    });
  }

  @Get("telegram")
  @RequirePermissions("notifications.read")
  async telegram() {
    return {
      ...(await this.bot.status()),
      expectedWebhookUrl: this.config.telegramWebhookUrl ?? null,
      linkingAvailable: this.links.available,
    };
  }

  /** Sends a check message to the operator's own address or chat, never to anyone else. */
  @Post("test-message")
  @HttpCode(202)
  @RequirePermissions("notifications.retry")
  async testMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: testSchema }) body: z.infer<typeof testSchema>,
  ) {
    const sourceEventId = randomUUID();
    await this.intents.accept(
      createEvent(notificationRequested, {
        producer: "admin",
        aggregateId: user.userId,
        aggregateVersion: 1,
        occurredAt: this.clock.now(),
        payload: {
          sourceEventId,
          templateKey: "service.test",
          category: "service",
          recipient: { userId: user.userId },
          channels: [body.channel],
          data: { channel: body.channel },
        },
      }),
    );
    const [row] = await this.database.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .innerJoin(intents, eq(intents.id, deliveries.intentId))
      .where(
        and(
          eq(intents.sourceEventId, sourceEventId),
          eq(deliveries.channel, body.channel),
        ),
      );
    return { deliveryId: row?.id ?? null };
  }

  @Get("audit")
  @RequirePermissions("audit.read")
  async audit(@Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(adminAudit)
      .where(
        cursor
          ? or(
              lt(adminAudit.createdAt, cursor.at),
              and(
                eq(adminAudit.createdAt, cursor.at),
                lt(adminAudit.id, cursor.id),
              ),
            )
          : isNotNull(adminAudit.id),
      )
      .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  private async load(id: string) {
    if (!uuid.safeParse(id).success) throw new AppError("NOT_FOUND");
    const [row] = await this.database.db
      .select({ delivery: deliveries, intent: intents })
      .from(deliveries)
      .innerJoin(intents, eq(intents.id, deliveries.intentId))
      .where(eq(deliveries.id, id));
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  }

  private summary(
    delivery: typeof deliveries.$inferSelect,
    intent: typeof intents.$inferSelect,
  ) {
    return {
      id: delivery.id,
      userId: delivery.userId,
      channel: delivery.channel,
      state: delivery.state,
      attempts: delivery.attempts,
      templateKey: intent.templateKey,
      category: intent.category,
      title: templateFor(intent.templateKey).title(
        intent.locale ?? "en",
        redact(
          intent.category,
          intent.data as Record<string, unknown>,
        ) as never,
      ),
      lastError: delivery.lastError,
      providerMessageId: delivery.providerMessageId,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }
}
