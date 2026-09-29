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
import type { PaymentsDatabase } from "../common/database.js";
import { customers } from "../db/schema.js";

/**
 * Admin commands (grants, refunds, cancellations): the token's roles are
 * trusted only if it was issued after the latest role or status change
 * Identity published (`av` ≥ projected accessVersion). A stale token gets
 * 401 and must be refreshed; a suspended actor gets 403.
 */
@Injectable()
export class CurrentAccessGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly database: PaymentsDatabase) {}

  async canActivate(context: ExecutionContext) {
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new AppError("UNAUTHENTICATED");
    const [row] = await this.database.db
      .select({
        accessVersion: customers.accessVersion,
        status: customers.status,
      })
      .from(customers)
      .where(eq(customers.userId, user.userId));
    if (row && row.status !== "active") throw new AppError("FORBIDDEN");
    if (row && row.accessVersion > user.accessVersion)
      throw new AppError("UNAUTHENTICATED", { message: "stale access token" });
    return true;
  }
}
