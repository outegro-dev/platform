import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const { outbox, inbox } = platformTables;

export const channels = ["email", "telegram", "inbox"] as const;
export const categories = ["auth", "security", "billing", "service"] as const;
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

/** Contact projection from Identity events; checked right before each send. */
export const recipients = pgTable("recipients", {
  userId: uuid("user_id").primaryKey(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  locale: text("locale", { enum: ["en", "ru"] })
    .notNull()
    .default("en"),
  telegramChatId: text("telegram_chat_id"),
  status: text("status").notNull().default("active"),
  preferencesVersion: integer("preferences_version").notNull().default(1),
  updatedAt: at("updated_at").notNull(),
});

/** What a service asked us to tell a user; unique per source event and template. */
export const intents = pgTable(
  "intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceEventId: uuid("source_event_id").notNull(),
    producer: text("producer").notNull(),
    templateKey: text("template_key").notNull(),
    category: text("category", { enum: categories }).notNull(),
    userId: uuid("user_id").notNull(),
    locale: text("locale", { enum: ["en", "ru"] }),
    data: jsonb("data").notNull().default({}),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("intents_source_uq").on(
      t.sourceEventId,
      t.templateKey,
      t.userId,
    ),
  ],
);

/** One external send attempt chain per intent and channel. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    channel: text("channel", { enum: ["email", "telegram"] }).notNull(),
    state: text("state", { enum: deliveryStates }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: at("next_attempt_at").notNull(),
    leaseToken: uuid("lease_token"),
    leaseUntil: at("lease_until"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    version: integer("version").notNull().default(1),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("deliveries_intent_channel_uq").on(t.intentId, t.channel),
    index("deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.state} in ('pending', 'retry_wait', 'leased')`),
  ],
);

/** In-app inbox. `readAt` is independent from any external delivery state. */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .unique()
      .references(() => intents.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    category: text("category", { enum: categories }).notNull(),
    data: jsonb("data").notNull().default({}),
    readAt: at("read_at"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("inbox_user_idx").on(t.userId, t.createdAt)],
);

/** Explicit opt-outs; absent rows mean the template default. */
export const preferences = pgTable(
  "preferences",
  {
    userId: uuid("user_id").notNull(),
    category: text("category", { enum: categories }).notNull(),
    channel: text("channel", { enum: channels }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category, t.channel] })],
);
