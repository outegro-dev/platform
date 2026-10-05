import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  DATABASE,
} from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { EduDatabase } from "../common/database.js";
import { grants, users } from "../db/schema.js";
import { Viewer } from "../domain/access.js";

/**
 * The caller as a reader: the token's roles, the grants projection and the
 * account status from Identity. Suspended and deleted accounts read nothing
 * (403), whatever the book.
 */
@Injectable()
export class ViewerService {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async of(user: AuthenticatedUser | null): Promise<Viewer> {
    if (!user) return Viewer.anonymous();
    const db = this.database.db;
    const [account] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.userId, user.userId));
    if (account && account.status !== "active") throw new AppError("FORBIDDEN");
    const records = await db
      .select({
        feature: grants.feature,
        state: grants.state,
        validFrom: grants.validFrom,
        validUntil: grants.validUntil,
      })
      .from(grants)
      .where(eq(grants.userId, user.userId));
    return Viewer.of({
      userId: user.userId,
      roles: user.roles,
      grants: records,
      now: this.clock.now(),
    });
  }
}
