import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const { outbox, inbox } = platformTables;

/** A person. `email` (normalised to lower case) is the anchor identity. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  displayName: text("display_name"),
  locale: text("locale", { enum: ["en", "ru"] })
    .notNull()
    .default("en"),
  status: text("status", { enum: ["active", "suspended", "deleted"] })
    .notNull()
    .default("active"),
  /** Bumped when roles or status change; carried in access tokens as `av`. */
  accessVersion: integer("access_version").notNull().default(0),
  /** Optimistic concurrency for profile edits (`expectedVersion`). */
  version: integer("version").notNull().default(1),
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/**
 * One email-code login attempt. The user is created only after a correct
 * code, so requesting a code reveals nothing about existing accounts.
 * Only an HMAC of the code is stored.
 */
export const loginChallenges = pgTable(
  "login_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    locale: text("locale", { enum: ["en", "ru"] }).notNull(),
    expiresAt: at("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: at("consumed_at"),
    deliveryStatus: text("delivery_status", {
      enum: ["pending", "accepted", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("login_challenges_email_idx").on(t.email, t.createdAt)],
);

/** Session metadata. Refresh tokens live in Valkey, keyed by session id. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authMethod: text("auth_method", {
      enum: ["email", "google", "passkey", "sso"],
    }).notNull(),
    /** Registered client for app sessions created through SSO; null on id.outegro.dev. */
    clientId: text("client_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: at("created_at").notNull(),
    lastActiveAt: at("last_active_at").notNull(),
    revokedAt: at("revoked_at"),
    revokedReason: text("revoked_reason", {
      enum: ["logout", "user", "admin", "reuse_detected", "expired"],
    }),
  },
  (t) => [index("sessions_user_idx").on(t.userId, t.createdAt)],
);

/**
 * External sign-in methods (ID-02). A provider account belongs to one user;
 * the provider email is informational and never used to match accounts.
 */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google"] }).notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("identities_provider_subject_uq").on(t.provider, t.subject),
    uniqueIndex("identities_user_provider_uq").on(t.userId, t.provider),
  ],
);

/**
 * One-time authorization codes for SSO (ID-04): bound to the client, the
 * exact redirect URI and a PKCE S256 challenge; only a hash is stored.
 */
export const authorizationCodes = pgTable(
  "authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: at("expires_at").notNull(),
    consumedAt: at("consumed_at"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("authorization_codes_user_idx").on(t.userId)],
);

/** Platform administration roles. Paid grants never live here. */
export const roleBindings = pgTable(
  "role_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    scope: text("scope").notNull().default("platform"),
    state: text("state", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    expiresAt: at("expires_at"),
    grantedBy: uuid("granted_by"),
    reason: text("reason").notNull(),
    createdAt: at("created_at").notNull(),
    revokedAt: at("revoked_at"),
    revokedBy: uuid("revoked_by"),
  },
  (t) => [
    uniqueIndex("role_bindings_active_uq")
      .on(t.userId, t.role, t.scope)
      .where(sql`${t.state} = 'active'`),
  ],
);

/**
 * Projection of commercial grants owned by Payments (billing.grant.changed).
 * `version` is the aggregateVersion: older events never overwrite newer state.
 */
export const grants = pgTable(
  "grants",
  {
    grantId: uuid("grant_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    service: text("service").notNull(),
    feature: text("feature").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    state: text("state", { enum: ["active", "revoked", "expired"] }).notNull(),
    validFrom: at("valid_from").notNull(),
    validUntil: at("valid_until"),
    version: integer("version").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("grants_user_idx").on(t.userId)],
);

/** Append-only record of administrative and security actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    data: jsonb("data").notNull().default({}),
    requestId: text("request_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId, t.createdAt)],
);
