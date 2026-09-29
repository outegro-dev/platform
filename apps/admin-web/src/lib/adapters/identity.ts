import type { Page } from "../result";
import { ServiceAdapter } from "./base";

/**
 * auth-backend (Identity): `/v1/me` and the admin API under `/v1/admin`.
 * Admin commands re-read the operator's permissions from the database.
 */

export type Operator = {
  id: string;
  email: string;
  displayName: string | null;
  locale: "en" | "ru";
  status: string;
  roles: string[];
  permissions: string[];
};

export type IdentityOverview = {
  generatedAt: string;
  users: {
    total: number;
    active: number;
    suspended: number;
    new24h: number;
    new7d: number;
  };
  sessions: {
    active: number;
    seen24h: number;
    byClient: Record<string, number>;
  };
  signIns7d: Record<string, number>;
  roleBindings: Record<string, number>;
  googleLinked: number;
  dailySignups: { day: string; n: number }[];
};

export type AdminUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  locale: "en" | "ru";
  status: "active" | "suspended" | "deleted";
  version: number;
  createdAt: string;
};

export type RoleBinding = {
  id: string;
  userId: string;
  role: string;
  scope: string;
  state: "active" | "revoked";
  expiresAt: string | null;
  grantedBy: string | null;
  reason: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
};

/** Commercial access projected from Payments (read-only here). */
export type AccessGrant = {
  grantId: string;
  service: string;
  feature: string;
  sourceType: string;
  validUntil: string | null;
};

export type UserDetail = {
  user: AdminUser;
  roleBindings: RoleBinding[];
  activeSessions: number;
  grants: AccessGrant[];
};

export type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  data: Record<string, unknown>;
  requestId?: string | null;
  createdAt: string;
};

export class IdentityAdmin extends ServiceAdapter {
  me(): Promise<Operator> {
    return this.get<Operator>("/v1/me");
  }

  overview(): Promise<IdentityOverview> {
    return this.get("/v1/admin/overview");
  }

  users(filter: {
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<AdminUser>> {
    return this.get("/v1/admin/users", filter);
  }

  user(id: string): Promise<UserDetail> {
    return this.get(`/v1/admin/users/${encodeURIComponent(id)}`);
  }

  audit(filter: {
    targetId?: string;
    actorId?: string;
    action?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<AuditEntry>> {
    return this.get("/v1/admin/audit", filter);
  }

  grantRole(
    userId: string,
    input: { role: string; reason: string; expiresAt: string | null },
  ): Promise<RoleBinding> {
    return this.send(
      "POST",
      `/v1/admin/users/${encodeURIComponent(userId)}/role-bindings`,
      input,
    );
  }

  revokeRole(bindingId: string, reason: string): Promise<void> {
    return this.send(
      "POST",
      `/v1/admin/role-bindings/${encodeURIComponent(bindingId)}/revoke`,
      { reason },
    );
  }

  revokeSessions(userId: string, reason: string): Promise<{ revoked: number }> {
    return this.send(
      "POST",
      `/v1/admin/users/${encodeURIComponent(userId)}/sessions/revoke-all`,
      { reason },
    );
  }

  setStatus(
    userId: string,
    status: "active" | "suspended",
    reason: string,
  ): Promise<AdminUser> {
    return this.send(
      "POST",
      `/v1/admin/users/${encodeURIComponent(userId)}/status`,
      { status, reason },
    );
  }
}
