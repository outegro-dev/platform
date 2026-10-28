/**
 * Platform administration roles and permissions (identity-access contract).
 * Commercial grants from Payments are a separate axis: paid never means admin.
 */
export const permissions = [
  "users.read",
  "users.read.sensitive",
  "users.suspend",
  "sessions.revoke",
  /**
   * Remove a user's passkey (a lost device) with a reason. Separate from
   * sessions.revoke: it takes a way in away for good, not just a sign-in.
   */
  "passkeys.revoke",
  "roles.read",
  "roles.assign",
  "notifications.read",
  "notifications.retry",
  "billing.read",
  "subscriptions.cancel",
  "refunds.request",
  /** Manual commercial grants: give or revoke access without a payment. */
  "grants.assign",
  "audit.read",
  "services.read",
  "services.flags",
  "events.replay",
  "battleship.read",
  "battleship.moderate",
  /** Education: books, access rules, readers' progress; staff preview of every book. */
  "edu.read",
  /** Education: publish, archive and change who reads a book, with a reason. */
  "edu.manage",
  /** Roulette: the live table, rounds, players and the daily bonus. */
  "roulette.read",
  /** Roulette: table limits, pausing bets, maintenance, the daily bonus table. */
  "roulette.manage",
  /** Roulette: cancel a round and return every bet (owner only). */
  "roulette.void",
  /**
   * Grafana behind the console's sign-in (admin.outegro.dev/grafana/):
   * an owner opens it as Admin, anyone else with this permission as Viewer.
   */
  "monitoring.read",
  /** Wallet: grumbles on hand, wallets, the journal (before → after), reconciliation, audit. */
  "wallet.read",
  /** Wallet: grant or take grumbles from a player, with a reason and a per-operation cap. */
  "wallet.adjust",
  /**
   * Atelier (atelier.outegro.dev): the owner's own job search, CVs and
   * applications. Owner-only until it becomes a product with grants.
   */
  "atelier.use",
] as const;
export type Permission = (typeof permissions)[number];

export const platformRoles = {
  owner: permissions,
  support: [
    "users.read",
    "sessions.revoke",
    "passkeys.revoke",
    "notifications.read",
    "notifications.retry",
    "battleship.read",
    "battleship.moderate",
    "edu.read",
    "roulette.read",
  ],
  billing_operator: ["billing.read", "subscriptions.cancel"],
  /** Runs the textbooks at edu.outegro.dev; reading access itself is a Payments grant. */
  edu_editor: ["edu.read", "edu.manage"],
  auditor: ["audit.read", "billing.read", "monitoring.read"],
  service_operator: [
    "services.read",
    "services.flags",
    "events.replay",
    "monitoring.read",
  ],
} as const satisfies Record<string, readonly Permission[]>;
export type PlatformRole = keyof typeof platformRoles;

/**
 * Unknown roles grant nothing (deny by default). Only the table's own keys
 * count: a role named after something every object inherits
 * (`constructor`, `toString`, `__proto__`) is unknown, not a lookup into
 * Object.prototype.
 */
export function permissionsOf(roles: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (!Object.hasOwn(platformRoles, role)) continue;
    for (const permission of platformRoles[role as PlatformRole])
      granted.add(permission);
  }
  return granted;
}

/**
 * The user holds at least one platform role, so the admin console has
 * something for them. A hint for navigation only: the console and every
 * service check permissions again on their side.
 */
export function hasPlatformRole(
  roles: readonly string[] | null | undefined,
): boolean {
  return (roles ?? []).some((role) => Object.hasOwn(platformRoles, role));
}

/** Claims carried by platform access tokens (ES256, 5 min). */
export type AccessTokenClaims = {
  sub: string;
  sid: string;
  roles: string[];
  /** Bumped on suspension or role change; services may re-check it. */
  av: number;
};
