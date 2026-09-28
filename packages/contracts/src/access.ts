/**
 * Platform administration roles and permissions (identity-access contract).
 * Commercial grants from Payments are a separate axis: paid never means admin.
 */
export const permissions = [
  "users.read",
  "users.read.sensitive",
  "users.suspend",
  "sessions.revoke",
  "roles.read",
  "roles.assign",
  "notifications.read",
  "notifications.retry",
  "billing.read",
  "subscriptions.cancel",
  "refunds.request",
  "audit.read",
  "services.read",
  "services.flags",
  "events.replay",
] as const;
export type Permission = (typeof permissions)[number];

export const platformRoles = {
  owner: permissions,
  support: [
    "users.read",
    "sessions.revoke",
    "notifications.read",
    "notifications.retry",
  ],
  billing_operator: ["billing.read", "subscriptions.cancel"],
  auditor: ["audit.read", "billing.read"],
  service_operator: ["services.read", "services.flags", "events.replay"],
} as const satisfies Record<string, readonly Permission[]>;
export type PlatformRole = keyof typeof platformRoles;

/** Unknown roles grant nothing (deny by default). */
export function permissionsOf(roles: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    const list = (platformRoles as Record<string, readonly Permission[]>)[role];
    if (list) for (const permission of list) granted.add(permission);
  }
  return granted;
}

/** Claims carried by platform access tokens (ES256, 5 min). */
export type AccessTokenClaims = {
  sub: string;
  sid: string;
  roles: string[];
  /** Bumped on suspension or role change; services may re-check it. */
  av: number;
};
