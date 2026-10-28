import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  AuthModule,
  ClockModule,
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MetricsModule,
} from "@outegro/nest-common";
import { AdminController } from "./admin/admin.controller.js";
import { BonusController } from "./bonus/bonus.controller.js";
import { BonusService } from "./bonus/bonus.service.js";
import { cryptoRandom } from "./bonus/rules.js";
import { SettingsService } from "./bonus/settings.service.js";
import { DailyMetrics } from "./common/metrics.js";
import { IDENTITY, PRIZE_RANDOM, WALLET } from "./common/tokens.js";
import {
  authConfig,
  dbConfig,
  identityConfig,
  metricsConfig,
  walletConfig,
} from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";
import { CurrentAccessGuard, HttpIdentity } from "./identity/identity.js";
import { HttpDailyWallet, InMemoryDailyWallet } from "./wallet/wallet.js";

/**
 * daily-bonus (ADR-012): grumbles once a day through the wallet, a streak
 * for days in a row, guards against farming, and the prize table for the
 * admin console. Its own database; no broker, no Valkey.
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "daily-bonus-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "daily-bonus-backend",
        port: metrics.port,
      }),
    }),
    DatabaseModule.forRootAsync({
      schema,
      service: "daily-bonus-backend",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => db,
    }),
    AuthModule.forRootAsync({
      inject: [authConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>) => ({
        issuer: auth.issuer,
        audience: auth.audience,
        keys: new URL(auth.jwksUrl),
      }),
    }),
  ],
  controllers: [BonusController, AdminController],
  providers: [
    {
      provide: IDENTITY,
      inject: [identityConfig.KEY],
      useFactory: (identity: ConfigType<typeof identityConfig>) =>
        new HttpIdentity(identity.url, identity.token),
    },
    {
      provide: WALLET,
      inject: [walletConfig.KEY],
      useFactory: (wallet: ConfigType<typeof walletConfig>) =>
        wallet.mode === "http" && wallet.url
          ? new HttpDailyWallet(wallet.url, wallet.token)
          : new InMemoryDailyWallet(wallet.openingBalance),
    },
    { provide: PRIZE_RANDOM, useValue: cryptoRandom },
    DailyMetrics,
    SettingsService,
    BonusService,
    CurrentAccessGuard,
  ],
})
export class AppModule {}
