import { Logger, Module } from "@nestjs/common";
import { MathRandom } from "@outegro/battleship-engine";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { AdminController } from "./admin/admin.controller.js";
import { AdminService } from "./admin/admin.service.js";
import { GAME_TIMINGS, RANDOM, SCHEDULER } from "./common/tokens.js";
import { defaultTimings } from "./domain/game/types.js";
import { SystemScheduler } from "./domain/scheduler.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { GameService } from "./game/game.service.js";
import { KeyedMutex } from "./game/keyed-mutex.js";
import { LobbyService } from "./game/lobby.service.js";
import { MatchRepository } from "./game/match.repository.js";
import { MatchmakerService } from "./game/matchmaker.service.js";
import { QueueStore } from "./game/queue.store.js";
import { RecoveryService } from "./game/recovery.service.js";
import { RoomStore } from "./game/room.store.js";
import { SessionRegistry } from "./game/session.registry.js";
import { LeaderboardController } from "./leaderboard/leaderboard.controller.js";
import { LeaderboardService } from "./leaderboard/leaderboard.service.js";
import { EntitlementWatch } from "./players/entitlement.watch.js";
import { EntitlementsService } from "./players/entitlements.service.js";
import { MeController } from "./players/me.controller.js";
import { PlayersService } from "./players/players.service.js";
import { CommandRouter } from "./realtime/command.router.js";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
import { GameSocketServer } from "./realtime/socket.server.js";
import { TicketStore } from "./realtime/ticket.store.js";
import { TicketsController } from "./realtime/tickets.controller.js";
import { StatsController } from "./stats/stats.controller.js";
import { StatsService } from "./stats/stats.service.js";

const schedulerLog = new Logger("Scheduler");

@Module({
  controllers: [
    MeController,
    TicketsController,
    LeaderboardController,
    StatsController,
    AdminController,
  ],
  providers: [
    {
      provide: SCHEDULER,
      inject: [CLOCK],
      useFactory: (clock: Clock) =>
        new SystemScheduler(clock, (error) =>
          schedulerLog.error(
            { err: (error as Error).message },
            "Timer task failed",
          ),
        ),
    },
    { provide: RANDOM, useValue: new MathRandom() },
    { provide: GAME_TIMINGS, useValue: defaultTimings },
    // Players and grants
    EntitlementsService,
    EntitlementWatch,
    PlayersService,
    GrantsConsumer,
    IdentityConsumer,
    // Game
    SessionRegistry,
    KeyedMutex,
    MatchRepository,
    QueueStore,
    RoomStore,
    GameService,
    MatchmakerService,
    LobbyService,
    RecoveryService,
    // Realtime
    ConnectionRegistry,
    TicketStore,
    CommandRouter,
    GameSocketServer,
    // Read models
    StatsService,
    LeaderboardService,
    AdminService,
  ],
})
export class BattleshipModule {}
