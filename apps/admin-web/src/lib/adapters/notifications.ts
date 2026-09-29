import type { Page } from "../result";
import { ServiceAdapter } from "./base";

/** notifications-backend admin API (`/v1/admin`). */

export const deliveryStates = [
  "pending",
  "leased",
  "accepted",
  "delivered",
  "retry_wait",
  "failed",
  "expired",
  "unknown",
] as const;
export type DeliveryState = (typeof deliveryStates)[number];
export const externalChannels = ["email", "telegram"] as const;
export type ExternalChannel = (typeof externalChannels)[number];

export type NotificationsOverview = {
  generatedAt: string;
  last24h: {
    deliveries: Record<ExternalChannel, Partial<Record<DeliveryState, number>>>;
    intents: number;
  };
  backlog: { count: number; oldestCreatedAt: string | null };
  daily: {
    day: string;
    channel: string;
    ok: number;
    bad: number;
    total: number;
  }[];
  recipients: { total: number; emailVerified: number; telegramLinked: number };
  channels: {
    email: { provider: string; from: string; enabled: boolean };
    telegram: {
      configured: boolean;
      botUsername: string | null;
      webhookConfigured: boolean;
      linkingAvailable: boolean;
      enabled: boolean;
    };
  };
  settingsVersion: number;
};

export type DeliverySummary = {
  id: string;
  userId: string;
  channel: ExternalChannel;
  state: DeliveryState;
  attempts: number;
  templateKey: string;
  category: string;
  title: string;
  lastError: string | null;
  providerMessageId: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryDetail = DeliverySummary & {
  intent: {
    id: string;
    producer: string;
    sourceEventId: string;
    locale: string | null;
    data: Record<string, unknown>;
    expiresAt: string;
    createdAt: string;
  };
  recipient: {
    email: string | null;
    emailVerified: boolean;
    telegramLinked: boolean;
    status: string;
    locale: string;
  } | null;
  retryable: boolean;
};

export type Recipient = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  locale: string;
  status: string;
  telegram: { linked: boolean; linkedAt: string | null };
  optOuts: { category: string; channel: string; enabled: boolean }[];
  recentDeliveries: DeliverySummary[];
};

export type Template = {
  key: string;
  category: string;
  channels: string[];
  mandatory: string[];
  ttlMs: number;
  locales: string[];
};

export type TemplatePreview = {
  key: string;
  locale: "en" | "ru";
  subject: string;
  text: string;
  html: string;
};

export type ChannelSettings = {
  version: number;
  channels: Record<ExternalChannel, { enabled: boolean }>;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type TelegramStatus = {
  configured: boolean;
  /** null when Telegram could not be reached. */
  username?: string | null;
  webhook?: {
    url: string | null;
    pendingUpdates: number;
    lastErrorAt: string | null;
    lastError: string | null;
  } | null;
  expectedWebhookUrl: string | null;
  linkingAvailable: boolean;
};

export type NotificationAudit = {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type DeliveryFilter = {
  state?: DeliveryState;
  channel?: ExternalChannel;
  userId?: string;
  template?: string;
  cursor?: string;
  limit?: number;
};

export class NotificationsAdmin extends ServiceAdapter {
  overview(): Promise<NotificationsOverview> {
    return this.get("/v1/admin/overview");
  }

  deliveries(filter: DeliveryFilter): Promise<Page<DeliverySummary>> {
    return this.get("/v1/admin/deliveries", filter);
  }

  delivery(id: string): Promise<DeliveryDetail> {
    return this.get(`/v1/admin/deliveries/${encodeURIComponent(id)}`);
  }

  retry(
    id: string,
    input: { reason: string; confirmUnknown: boolean },
  ): Promise<DeliverySummary> {
    return this.send(
      "POST",
      `/v1/admin/deliveries/${encodeURIComponent(id)}/retry`,
      input,
    );
  }

  recipient(userId: string): Promise<Recipient> {
    return this.get(`/v1/admin/recipients/${encodeURIComponent(userId)}`);
  }

  async templates(): Promise<Template[]> {
    return (await this.get<{ items: Template[] }>("/v1/admin/templates")).items;
  }

  preview(key: string, locale: "en" | "ru"): Promise<TemplatePreview> {
    return this.get(`/v1/admin/templates/${encodeURIComponent(key)}/preview`, {
      locale,
    });
  }

  settings(): Promise<ChannelSettings> {
    return this.get("/v1/admin/settings");
  }

  updateSettings(input: {
    expectedVersion: number;
    channels: Partial<Record<ExternalChannel, { enabled: boolean }>>;
    reason: string;
  }): Promise<ChannelSettings> {
    return this.send("PATCH", "/v1/admin/settings", input);
  }

  telegram(): Promise<TelegramStatus> {
    return this.get("/v1/admin/telegram");
  }

  /** Delivered to the operator's own address or chat, never to anyone else. */
  testMessage(
    channel: ExternalChannel,
  ): Promise<{ deliveryId: string | null }> {
    return this.send("POST", "/v1/admin/test-message", { channel });
  }

  audit(filter: {
    cursor?: string;
    limit?: number;
  }): Promise<Page<NotificationAudit>> {
    return this.get("/v1/admin/audit", filter);
  }
}
