import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  defineQueue,
  type EventOf,
  notificationRequested,
  type Producer,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import type { NotificationsDatabase } from "../common/database.js";
import { deliveries, inboxItems, intents } from "../db/schema.js";
import { DeliveryWorker } from "../delivery/delivery.worker.js";
import { templates } from "../templates/registry.js";

const requesters: Producer[] = ["identity", "payments", "admin", "assistant"];

export const intentsQueue = defineQueue(
  "notifications",
  "intents",
  requesters.map((producer) => ({
    producer,
    types: [notificationRequested.type],
  })),
);

/**
 * Turns `notifications.intent.requested` into one intent, an inbox item and
 * one delivery per external channel, atomically and once per source event.
 */
@Injectable()
export class IntentsService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: NotificationsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
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
    const template = templates[p.templateKey];
    if (!template)
      throw new PermanentError(`unknown template ${p.templateKey}`);
    if (template.category !== p.category)
      throw new PermanentError("category mismatch");
    // Login codes never come through the broker (ADR-008).
    if (template.category === "auth")
      throw new PermanentError("auth templates are private");
    const wanted = (p.channels ?? template.channels).filter((c) =>
      template.channels.includes(c),
    );
    const now = this.clock.now();

    const result = await processOnce(
      this.database.db,
      {
        consumer: "notifications.intents",
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        const [intent] = await tx
          .insert(intents)
          .values({
            sourceEventId: p.sourceEventId,
            producer: event.producer,
            templateKey: p.templateKey,
            category: p.category,
            userId: p.recipient.userId,
            locale: p.locale ?? null,
            data: p.data,
            expiresAt: new Date(now.getTime() + template.ttlMs),
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: intents.id });
        if (!intent) return; // same source event and template already accepted
        if (wanted.includes("inbox")) {
          await tx.insert(inboxItems).values({
            userId: p.recipient.userId,
            intentId: intent.id,
            templateKey: p.templateKey,
            category: p.category,
            data: p.data,
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
              userId: p.recipient.userId,
              channel,
              nextAttemptAt: now,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
      },
    );
    if (result === "processed") this.worker.kick();
    return result;
  }
}
