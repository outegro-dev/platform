import type { DailyPrize } from "@outegro/contracts/daily-bonus";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const grumbles = (name: string) => bigint(name, { mode: "number" });

/**
 * The bonus switches and prize table, one row. Defaults are seeded once;
 * afterwards the admin console changes them with the version as the lock.
 */
export const settings = pgTable("settings", {
  id: smallint("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull(),
  streaksEnabled: boolean("streaks_enabled").notNull(),
  prizes: jsonb("prizes").$type<DailyPrize[]>().notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: at("updated_at").notNull(),
  updatedBy: uuid("updated_by"),
});

export const claimStatuses = ["pending", "granted"] as const;

/**
 * Every bonus taken, numbered per player. `pending` until the wallet
 * confirms the credit with `ref = daily:{userId}:{claimNo}`; a retry
 * repeats that ref, so nothing is credited twice.
 */
export const claims = pgTable(
  "claims",
  {
    userId: uuid("user_id").notNull(),
    claimNo: integer("claim_no").notNull(),
    status: text("status", { enum: claimStatuses }).notNull(),
    prizeIndex: smallint("prize_index").notNull(),
    basePrize: grumbles("base_prize").notNull(),
    prize: grumbles("prize").notNull(),
    streak: integer("streak").notNull(),
    claimedAt: at("claimed_at").notNull(),
    /** claimedAt + 24 h: counted from the claim, not the calendar. */
    nextAt: at("next_at").notNull(),
    grantedAt: at("granted_at"),
    /** Peppered hashes, never the address or the device id. */
    ipHash: text("ip_hash"),
    deviceHash: text("device_hash"),
    settingsVersion: integer("settings_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.claimNo] }),
    index("claims_claimed_idx").on(t.claimedAt),
    index("claims_ip_idx").on(t.ipHash, t.claimedAt),
    index("claims_device_idx").on(t.deviceHash, t.claimedAt),
  ],
);

/** Every admin command: who, why, and the settings before and after. */
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id").notNull(),
  action: text("action", { enum: ["settings.update"] }).notNull(),
  reason: text("reason").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  requestId: text("request_id"),
  createdAt: at("created_at").notNull(),
});
