import { Inject, Injectable } from "@nestjs/common";
import {
  CLOCK,
  type Clock,
  type Counter,
  DATABASE,
  Metrics,
} from "@outegro/nest-common";
import { count, inArray, min } from "drizzle-orm";
import { deliveries, type deliveryStates } from "../db/schema.js";
import type { NotificationsDatabase } from "./database.js";

type Channel = (typeof deliveries.$inferSelect)["channel"];
type State = (typeof deliveryStates)[number];

const CHANNELS: readonly Channel[] = ["email", "telegram"];
/** Waiting to be sent: due, backing off, or held by a worker. */
const QUEUED: State[] = ["pending", "retry_wait", "leased"];
/** Recorded delivery outcomes; `sent` is accepted by the provider. */
const OUTCOMES: Partial<Record<State, string>> = {
  accepted: "sent",
  retry_wait: "retried",
  failed: "failed",
  expired: "expired",
  unknown: "unknown",
};

/** Delivery metrics of Notifications (OPS-04). */
@Injectable()
export class NotificationsMetrics {
  private readonly deliveries: Counter<"channel" | "outcome">;
  private readonly droppedLinks: Counter<"template">;

  constructor(
    metrics: Metrics,
    @Inject(DATABASE) database: NotificationsDatabase,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.deliveries = metrics.counter({
      name: "notifications_deliveries_total",
      help: "Delivery attempts by channel and outcome (sent, retried, failed, expired, unknown).",
      labelNames: ["channel", "outcome"],
    });
    this.droppedLinks = metrics.counter({
      name: "notifications_action_links_dropped_total",
      help: "Action links outside our sites dropped at intake, by template key; the notice goes out with the template's own page.",
      labelNames: ["template"],
    });
    const queued = metrics.gauge({
      name: "notifications_deliveries_queued",
      help: "Deliveries waiting to be sent, by channel.",
      labelNames: ["channel"],
    });
    const oldest = metrics.gauge({
      name: "notifications_delivery_oldest_queued_age_seconds",
      help: "Age of the oldest waiting delivery by channel; 0 when none.",
      labelNames: ["channel"],
    });
    metrics.readOnScrape("deliveries", [queued, oldest], async () => {
      const rows = await database.db
        .select({
          channel: deliveries.channel,
          queued: count(),
          oldest: min(deliveries.createdAt),
        })
        .from(deliveries)
        .where(inArray(deliveries.state, QUEUED))
        .groupBy(deliveries.channel);
      const now = clock.now().getTime();
      for (const channel of CHANNELS) {
        const row = rows.find((r) => r.channel === channel);
        queued.set({ channel }, row?.queued ?? 0);
        oldest.set(
          { channel },
          row?.oldest ? Math.max(0, now - row.oldest.getTime()) / 1000 : 0,
        );
      }
    });
  }

  /** A delivery's recorded outcome; `pending` and `leased` are not outcomes. */
  delivery(channel: Channel, state: State) {
    const outcome = OUTCOMES[state];
    if (outcome) this.deliveries.inc({ channel, outcome });
  }

  /** `template` is a key of the registry, checked before this is counted. */
  actionLinkDropped(template: string) {
    this.droppedLinks.inc({ template });
  }
}
