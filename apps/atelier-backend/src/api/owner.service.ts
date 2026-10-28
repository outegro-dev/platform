import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Profile } from "@outegro/contracts/atelier";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { AtelierDatabase } from "../common/database.js";
import {
  applications,
  jobs,
  OWNER_PLACEHOLDER,
  profiles,
} from "../db/schema.js";

/**
 * Whose data a signed-in user sees. The owner's profile may be imported
 * before their account id is known (`import-profile --user owner`): the
 * first user with `atelier.use` and no profile of their own adopts the
 * placeholder row, with every application and job made under it, in one
 * transaction.
 */
@Injectable()
export class OwnerService {
  private readonly logger = new Logger("Owner");
  private readonly settled = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The user's id after adoption (the id itself; adoption happens at most once). */
  async userIdOf(userId: string): Promise<string> {
    if (this.settled.has(userId)) return userId;
    const settled = await this.database.db.transaction(async (tx) => {
      const [own] = await tx
        .select({ userId: profiles.userId })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      if (own) return true;
      const [placeholder] = await tx
        .select({ userId: profiles.userId })
        .from(profiles)
        .where(eq(profiles.userId, OWNER_PLACEHOLDER))
        .for("update");
      // Nothing to adopt yet: look again on the next request.
      if (!placeholder) return false;
      const now = this.clock.now();
      await tx
        .update(profiles)
        .set({ userId, updatedAt: now })
        .where(eq(profiles.userId, OWNER_PLACEHOLDER));
      const moved = await tx
        .update(applications)
        .set({ userId, updatedAt: now })
        .where(eq(applications.userId, OWNER_PLACEHOLDER))
        .returning({ id: applications.id });
      await tx
        .update(jobs)
        .set({ userId })
        .where(eq(jobs.userId, OWNER_PLACEHOLDER));
      this.logger.log(
        { applications: moved.length },
        "Owner profile adopted by the signed-in user",
      );
      return true;
    });
    if (settled) this.settled.add(userId);
    return userId;
  }

  async profileOf(userId: string): Promise<Profile | null> {
    const [row] = await this.database.db
      .select({ data: profiles.data })
      .from(profiles)
      .where(eq(profiles.userId, await this.userIdOf(userId)));
    return row?.data ?? null;
  }
}
