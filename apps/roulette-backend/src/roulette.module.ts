import { Logger, Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { defaultTimings } from "@outegro/roulette-engine";
import { BetService } from "./bets/bet.service.js";
import { BetWriter } from "./bets/bet.writer.js";
import { RouletteMetrics } from "./common/metrics.js";
import {
  FAIR_ROLL,
  ROUND_TIMINGS,
  SCHEDULER,
  WALLET,
} from "./common/tokens.js";
import { fairRollConfig, walletConfig } from "./config/config.js";
import { SystemScheduler } from "./domain/scheduler.js";
import { HttpFairRoll } from "./fair/http-fair-roll.js";
import { MeController } from "./players/me.controller.js";
import { PlayersService } from "./players/players.service.js";
import { CommandRouter } from "./realtime/command.router.js";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
import { RoundRelay } from "./realtime/round.relay.js";
import { RouletteSocketServer } from "./realtime/socket.server.js";
import { TicketStore } from "./realtime/ticket.store.js";
import { TicketsController } from "./realtime/tickets.controller.js";
import { EngineDriver } from "./rounds/engine.driver.js";
import { RoundEngine } from "./rounds/round.engine.js";
import { RoundFeed, SnapshotService } from "./rounds/round.feed.js";
import { RoundRepository } from "./rounds/round.repository.js";
import { RoundStore } from "./rounds/round.store.js";
import { RoundsController } from "./rounds/rounds.controller.js";
import { SettlementService } from "./rounds/settlement.service.js";
import { InMemoryWallet } from "./wallet/memory-wallet.js";

const schedulerLog = new Logger("Scheduler");

@Module({
  controllers: [MeController, TicketsController, RoundsController],
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
    { provide: ROUND_TIMINGS, useValue: defaultTimings },
    {
      provide: WALLET,
      inject: [walletConfig.KEY],
      // The only adapter until wallet-backend has its internal API (ADR-012).
      useFactory: (wallet: ConfigType<typeof walletConfig>) =>
        new InMemoryWallet(wallet.starterChips),
    },
    {
      provide: FAIR_ROLL,
      inject: [fairRollConfig.KEY],
      useFactory: (fair: ConfigType<typeof fairRollConfig>) =>
        new HttpFairRoll(fair.url, fair.token),
    },
    RouletteMetrics,
    PlayersService,
    // Rounds
    RoundRepository,
    RoundStore,
    SnapshotService,
    RoundFeed,
    SettlementService,
    RoundEngine,
    EngineDriver,
    // Bets
    BetWriter,
    BetService,
    // Realtime
    ConnectionRegistry,
    TicketStore,
    CommandRouter,
    RoundRelay,
    RouletteSocketServer,
  ],
})
export class RouletteModule {}
