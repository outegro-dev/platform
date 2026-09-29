import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  defineQueue,
  type EventOf,
  notificationRequested,
  type Producer,
} from "@outegro/contracts";
import { type Executor, processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import type { NotificationsDatabase } from "../common/database.js";
import { channelsConfig } from "../config/config.js";
import { deliveries, inboxItems, intents } from "../db/schema.js";
import { DeliveryWorker } from "../delivery/delivery.worker.js";
import { allowedLink, type Channel, templates } from "../templates/registry.js";
import { contextOf } from "../templates/render.js";

const requesters: Producer[] = ["identity", "payments", "admin", "assistant"];

export const intentsQueue = defineQueue(
  "notifications",
  "intents",
  requesters.map((producer) => ({
    producer,
    types: [notificationRequested.type],
  })),
);

/** What to tell whom: a broker request, or one of this service's own notices. */
export type IntentRequest = {
  sourceEventId: string;
  producer: Producer;
  templateKey: string;
  category: string;
  userId: string;
  locale?: "en" | "ru";
  channels?: Channel[];
  data: Record<string, string | number | boolean | null>;
};

/**
 * Turns `notifications.intent.requested` into one intent, an inbox item and
 * one delivery per external channel, atomically and once per source event.
 */
@Injectable()
export class IntentsService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(channelsConfig.KEY)
    private readonly config: ConfigType<typeof channelsConfig>,
    private readonly messaging: Messaging,
    private readonly worker: DeliveryWorker,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(intentsQueue, async (event) => {
      const parsed = notificationRequested.schema.safeParse(event);
      if (!parsed.success) throw new PermanentError("invalid intent payload");
      await this.accept(parsed.data);
    });
  }

  async accept(event: EventOf<typeof notificationRequested>) {
    const p = event.payload;
    const result = await processOnce(
      this.database.db,
      {
        consumer: "notifications.intents",
        eventId: event.eventId,
        type: event.type,
      },
      (tx) =>
        this.record(tx, {
          sourceEventId: p.sourceEventId,
          producer: event.producer,
          templateKey: p.templateKey,
          category: p.category,
          userId: p.recipient.userId,
          locale: p.locale,
          channels: p.channels,
          data: p.data,
        }),
    );
    if (result === "processed") this.worker.kick();
    return result;
  }

  /**
   * Stores the intent in the caller's transaction; the same source event,
   * template and recipient only once. A request that can never be shown
   * correctly is refused before anything is written.
   */
  async record(tx: Executor, request: IntentRequest) {
    const template = templates[request.templateKey];
    if (!template)
      throw new PermanentError(`unknown template ${request.templateKey}`);
    if (template.category !== request.category)
      throw new PermanentError("category mismatch");
    // Login codes never come through the broker (ADR-008).
    if (template.category === "auth")
      throw new PermanentError("auth templates are private");
    const parsed = template.schema
      ? template.schema.safeParse(request.data)
      : { success: true as const, data: request.data };
    // The reason stays generic: data values may be personal.
    if (!parsed.success)
      throw new PermanentError(`invalid data for ${request.templateKey}`);
    const data = parsed.data;
    if (
      data.actionUrl != null &&
      !allowedLink(data.actionUrl, contextOf(this.config))
    )
      throw new PermanentError("action link not allowed");
    const wanted = (request.channels ?? template.channels).filter((c) =>
      template.channels.includes(c),
    );
    const now = this.clock.now();

    const [intent] = await tx
      .insert(intents)
      .values({
        sourceEventId: request.sourceEventId,
        producer: request.producer,
        templateKey: request.templateKey,
        category: template.category,
        userId: request.userId,
        locale: request.locale ?? null,
        data,
        expiresAt: new Date(now.getTime() + template.ttlMs),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: intents.id });
    if (!intent) return; // same source event and template already accepted
    if (wanted.includes("inbox")) {
      await tx.insert(inboxItems).values({
        userId: request.userId,
        intentId: intent.id,
        templateKey: request.templateKey,
        category: template.category,
        data,
        createdAt: now,
      });
    }
    const external = wanted.filter(
      (c): c is "email" | "telegram" => c !== "inbox",
    );
    if (external.length) {
      await tx.insert(deliveries).values(
        external.map((channel) => ({
          intentId: intent.id,
          userId: request.userId,
          channel,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
  }
}
