import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  DATABASE,
} from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import type { EduDatabase } from "../common/database.js";
import { users } from "../db/schema.js";

/**
 * Admin commands (publish, archive, change who reads a book): the token's
 * roles are trusted only if it was issued after the latest role or status
 * change Identity published (`av` ≥ projected accessVersion). A stale token
 * gets 401 and must be refreshed; a suspended actor gets 403.
 */
@Injectable()
export class CurrentAccessGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly database: EduDatabase) {}

  async canActivate(context: ExecutionContext) {
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    const [row] = await this.database.db
      .select({
        accessVersion: users.accessVersion,
        status: users.status,
      })
      .from(users)
      .where(eq(users.userId, user.userId));
    if (row && row.status !== "active") throw new AppError("FORBIDDEN");
    if (row && row.accessVersion > user.accessVersion)
      throw new AppError("UNAUTHENTICATED", { message: "stale access token" });
    return true;
  }
}
