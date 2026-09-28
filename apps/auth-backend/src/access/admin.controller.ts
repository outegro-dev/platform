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
import { roleBindings, sessions, users } from "../db/schema.js";
import { GrantsService } from "../grants/grants.service.js";
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

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
const decodeCursor = (cursor: string) => {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at ?? "");
  if (!id || Number.isNaN(date.getTime()))
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
  ) {}

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

  @Post("users/:id/status")
  @HttpCode(200)
  @RequireFreshPermissions("users.suspend")
  async setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: statusSchema }) body: z.infer<typeof statusSchema>,
  ) {
    if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND");
    const user = await this.users.setStatus(
      { userId: actor.userId },
      id,
      body.status,
      body.reason,
    );
    if (body.status === "suspended") {
      await this.sessions.revoke(id, "all", "admin", { userId: actor.userId });
    }
    return user;
  }
}
