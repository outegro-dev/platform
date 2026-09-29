import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  defineQueue,
  type EventOf,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { and, eq, lt } from "drizzle-orm";
import type { BattleshipDatabase } from "../common/database.js";
import { players } from "../db/schema.js";
import { deletedNickname } from "../domain/names.js";
import { GameService } from "../game/game.service.js";
import { LobbyService } from "../game/lobby.service.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";

export const identityQueue = defineQueue("battleship", "identity-events", [
  { producer: "identity", types: [identityUserStatusChanged.type] },
]);

/** Close code for sockets of a suspended or deleted account. */
export const ACCOUNT_CLOSED = 4403;

/**
 * Account status from Identity (newer accessVersion wins). A suspended or
 * deleted player loses the sockets, forfeits the live match, leaves the queue
 * and the leaderboard; a deleted one becomes "Deleted player".
 */
@Injectable()
export class IdentityConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger("IdentityConsumer");

  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
    private readonly game: GameService,
    private readonly lobby: LobbyService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(identityQueue, async (event) => {
      const parsed = identityUserStatusChanged.schema.safeParse(event);
      if (!parsed.success)
        throw new PermanentError(
          "invalid identity.user.status.changed payload",
        );
      await this.apply(parsed.data);
    });
  }

  /** True when the status changed a known player. */
  async apply(
    event: EventOf<typeof identityUserStatusChanged>,
  ): Promise<boolean> {
    const { userId, status, accessVersion } = event.payload;
    let changed = false;
    await processOnce(
      this.database.db,
      {
        consumer: identityQueue.name,
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        const rows = await tx
          .update(players)
          .set({
            status,
            accessVersion,
            ...(status === "deleted" ? { nickname: deletedNickname } : {}),
            updatedAt: this.clock.now(),
          })
          .where(
            and(
              eq(players.userId, userId),
              lt(players.accessVersion, accessVersion),
            ),
          )
          .returning({ userId: players.userId });
        changed = rows.length > 0;
      },
    );
    if (changed && status !== "active") {
      // Order: the result reaches both players before the sockets close.
      await this.game
        .forfeit(userId)
        .catch((error: unknown) =>
          this.logger.error(
            { err: (error as Error).message },
            "Forfeit failed",
          ),
        );
      await this.lobby.dropUser(userId);
      this.registry.closeUser(userId, ACCOUNT_CLOSED, "account closed");
    }
    return changed;
  }
}
