import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { platformRoles } from "@outegro/contracts";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  CurrentUser,
  DATABASE,
} from "@outegro/nest-common";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../common/audit.js";
import type { AuthDatabase } from "../common/database.js";
import {
  auditLog,
  identities,
  roleBindings,
  sessions,
  users,
} from "../db/schema.js";
import { GrantsService } from "../grants/grants.service.js";
import { PasskeysService } from "../passkeys/passkeys.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { UsersService } from "../users/users.service.js";
import {
  FreshPermissionsGuard,
  RequireFreshPermissions,
} from "./fresh-permissions.guard.js";
import { RolesService } from "./roles.service.js";

const reason = z.string().trim().min(3).max(500);
const idParam = z.uuid();

const listSchema = z.object({
  query: z.string().trim().max(254).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const grantSchema = z.object({
  role: z.enum(Object.keys(platformRoles) as [string, ...string[]]),
  reason,
  expiresAt: z.iso.datetime().nullable().optional(),
});
const reasonSchema = z.object({ reason });
const statusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason,
});
const auditQuerySchema = z.object({
  targetId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
const decodeCursor = (cursor: string) => {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  // The id goes into a uuid comparison; anything else would be a 500.
  if (!id || !idParam.safeParse(id).success || Number.isNaN(date.getTime()))
    throw new AppError("VALIDATION_FAILED");
  return { at: date, id };
};

/** Identity side of the admin console. Every command is audited with a reason. */
@Controller("admin")
@UseGuards(FreshPermissionsGuard)
export class AdminController {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly sessions: SessionsService,
    private readonly grants: GrantsService,
    private readonly passkeys: PasskeysService,
  ) {}

  /** Numbers for the admin dashboard: accounts, sessions, sign-in methods. */
  @Get("overview")
  @RequireFreshPermissions("users.read")
  async overview() {
    const db = this.database.db;
    const now = this.clock.now();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
    const [accounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
        suspended: sql<number>`count(*) filter (where ${users.status} = 'suspended')::int`,
        new24h: sql<number>`count(*) filter (where ${users.createdAt} >= ${dayAgo})::int`,
        new7d: sql<number>`count(*) filter (where ${users.createdAt} >= ${weekAgo})::int`,
      })
      .from(users);
    const [live] = await db
      .select({
        active: sql<number>`count(*) filter (where ${sessions.revokedAt} is null)::int`,
        seen24h: sql<number>`count(*) filter (where ${sessions.revokedAt} is null and ${sessions.lastActiveAt} >= ${dayAgo})::int`,
      })
      .from(sessions);
    const methods = await db
      .select({ method: sessions.authMethod, n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(sql`${sessions.createdAt} >= ${weekAgo}`)
      .groupBy(sessions.authMethod);
    const clients = await db
      .select({ clientId: sessions.clientId, n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(isNull(sessions.revokedAt))
      .groupBy(sessions.clientId);
    const roles = await db
      .select({ role: roleBindings.role, n: sql<number>`count(*)::int` })
      .from(roleBindings)
      .where(eq(roleBindings.state, "active"))
      .groupBy(roleBindings.role);
    const [linked] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(identities);
    const daily = await db.execute<{ day: string; n: number }>(sql`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             count(*)::int as n
        from users
       where created_at >= ${weekAgo}
       group by 1
       order by 1`);
    return {
      generatedAt: now.toISOString(),
      users: accounts,
      sessions: {
        ...live,
        byClient: Object.fromEntries(
          clients.map((row) => [row.clientId ?? "id-web", row.n]),
        ),
      },
      signIns7d: Object.fromEntries(methods.map((row) => [row.method, row.n])),
      roleBindings: Object.fromEntries(roles.map((row) => [row.role, row.n])),
      googleLinked: linked?.n ?? 0,
      dailySignups: daily.rows,
    };
  }

  /** Security and administrative actions, newest first. */
  @Get("audit")
  @RequireFreshPermissions("audit.read")
  async auditTrail(
    @Query({ schema: auditQuerySchema }) query: z.infer<
      typeof auditQuerySchema
    >,
  ) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(auditLog)
      .where(
        and(
          query.targetId ? eq(auditLog.targetId, query.targetId) : undefined,
          query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
          query.action ? eq(auditLog.action, query.action) : undefined,
          cursor
            ? or(
                lt(auditLog.createdAt, cursor.at),
                and(
                  eq(auditLog.createdAt, cursor.at),
                  lt(auditLog.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  @Get("users")
  @RequireFreshPermissions("users.read")
  async list(@Query({ schema: listSchema }) query: z.infer<typeof listSchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(users)
      .where(
        and(
          query.query
            ? ilike(users.email, `%${query.query.replace(/[%_\\]/g, "\\$&")}%`)
            : undefined,
          cursor
            ? or(
                lt(users.createdAt, cursor.at),
                and(eq(users.createdAt, cursor.at), lt(users.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((user) => this.users.toProfile(user)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  @Get("users/:id")
  @RequireFreshPermissions("users.read")
  async detail(@Param("id") id: string) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    const user = await this.users.get(id);
    const bindings = await this.database.db
      .select()
      .from(roleBindings)
      .where(eq(roleBindings.userId, id))
      .orderBy(desc(roleBindings.createdAt));
    const [active] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
    return {
      user: this.users.toProfile(user),
      roleBindings: bindings,
      activeSessions: active?.count ?? 0,
      grants: await this.grants.active(id),
    };
  }

  @Post("users/:id/role-bindings")
  @RequireFreshPermissions("roles.assign")
  grant(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: grantSchema }) body: z.infer<typeof grantSchema>,
  ) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    return this.roles.grant(
      { userId: actor.userId },
      {
        userId: id,
        role: body.role,
        reason: body.reason,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    );
  }

  @Post("role-bindings/:id/revoke")
  @HttpCode(204)
  @RequireFreshPermissions("roles.assign")
  async revokeBinding(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: reasonSchema }) body: z.infer<typeof reasonSchema>,
  ) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    await this.roles.revoke(
      { userId: actor.userId },
      { bindingId: id, reason: body.reason },
    );
  }

  @Post("users/:id/sessions/revoke-all")
  @HttpCode(200)
  @RequireFreshPermissions("sessions.revoke")
  async revokeSessions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: reasonSchema }) body: z.infer<typeof reasonSchema>,
  ) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    const revoked = await this.sessions.revoke(id, "all", "admin", {
      userId: actor.userId,
    });
    await this.database.db.transaction((tx) =>
      audit(tx, {
        actorId: actor.userId,
        action: "sessions.revoked",
        targetType: "user",
        targetId: id,
        reason: body.reason,
        data: { count: revoked.length },
        at: this.clock.now(),
      }),
    );
    return { revoked: revoked.length };
  }

  /** The user's passkeys: names, dates, synced; never the credential ids. */
  @Get("users/:id/passkeys")
  @RequireFreshPermissions("users.read")
  passkeysOf(@Param("id") id: string) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    return this.passkeys.listForOperator(id);
  }

  /** Removes a lost device's passkey; the user keeps another way in. */
  @Post("users/:id/passkeys/:passkeyId/revoke")
  @HttpCode(204)
  @RequireFreshPermissions("passkeys.revoke")
  async revokePasskey(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Param("passkeyId") passkeyId: string,
    @Body({ schema: reasonSchema }) body: z.infer<typeof reasonSchema>,
  ) {
    if (!idParam.safeParse(id).success || !idParam.safeParse(passkeyId).success)
      throw new AppError("NOT_FOUND");
    await this.passkeys.revoke(
      { userId: actor.userId },
      id,
      passkeyId,
      body.reason,
    );
  }

  @Post("users/:id/status")
  @HttpCode(200)
  @RequireFreshPermissions("users.suspend")
  async setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: statusSchema }) body: z.infer<typeof statusSchema>,
  ) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    return this.users.setStatus(
      { userId: actor.userId },
      id,
      body.status,
      body.reason,
    );
  }
}
