import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { localeSchema, permissionsOf } from "@outegro/contracts";
import {
  AppError,
  type AuthenticatedUser,
  CurrentUser,
} from "@outegro/nest-common";
import { z } from "zod";
import { RolesService } from "../access/roles.service.js";
import { GrantsService } from "../grants/grants.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { UsersService } from "./users.service.js";

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    locale: localeSchema.optional(),
  })
  .strict();

const revokeAllSchema = z.object({
  includeCurrent: z.boolean().default(false),
});

/** The signed-in user's own account (ownership comes from the token, never the URL). */
@Controller("me")
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly roles: RolesService,
    private readonly grants: GrantsService,
  ) {}

  @Get()
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.users.get(current.userId);
    const roles = await this.roles.activeRoles(current.userId);
    return {
      ...this.users.toProfile(user),
      roles,
      permissions: [...permissionsOf(roles)].sort(),
    };
  }

  @Patch()
  update(
    @CurrentUser() current: AuthenticatedUser,
    @Body({ schema: updateSchema }) body: z.infer<typeof updateSchema>,
  ) {
    return this.users.update(current.userId, body);
  }

  @Get("sessions")
  async listSessions(@CurrentUser() current: AuthenticatedUser) {
    const items = await this.sessions.list(current.userId);
    return {
      items: items.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
        current: session.id === current.sessionId,
      })),
    };
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
    const revoked = await this.sessions.revoke(current.userId, [id], "user", {
      userId: current.userId,
    });
    if (revoked.length === 0) throw new AppError("NOT_FOUND");
  }

  @Post("sessions/revoke-all")
  @HttpCode(200)
  async revokeAll(
    @CurrentUser() current: AuthenticatedUser,
    @Body({ schema: revokeAllSchema }) body: z.infer<typeof revokeAllSchema>,
  ) {
    const revoked = await this.sessions.revoke(
      current.userId,
      "all",
      "user",
      { userId: current.userId },
      body.includeCurrent ? {} : { except: current.sessionId },
    );
    return { revoked: revoked.length };
  }

  @Get("grants")
  async myGrants(@CurrentUser() current: AuthenticatedUser) {
    return { items: await this.grants.active(current.userId) };
  }
}
