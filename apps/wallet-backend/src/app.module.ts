import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import {
  AuthModule,
  ClockModule,
  createLoggerModule,
  DatabaseModule,
  HealthModule,
  MessagingModule,
  MetricsModule,
  ValkeyModule,
  ValkeyThrottlerStorage,
} from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  httpConfig,
  metricsConfig,
  rabbitConfig,
  valkeyConfig,
} from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";
import { WalletModule } from "./wallet.module.js";

// No OutboxModule: the wallet publishes nothing until an event has a
// consumer (ADR-011); it only listens to Identity.
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "wallet-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "wallet-backend",
        port: metrics.port,
      }),
    }),
    DatabaseModule.forRootAsync({
      schema,
      service: "wallet-backend",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => db,
    }),
    ValkeyModule.forRootAsync({
      inject: [valkeyConfig.KEY],
      useFactory: (valkey: ConfigType<typeof valkeyConfig>) => valkey.url,
    }),
    MessagingModule.forRootAsync({
      inject: [rabbitConfig.KEY],
      useFactory: (rabbit: ConfigType<typeof rabbitConfig>) => ({
        url: rabbit.url,
        service: "wallet",
      }),
    }),
    AuthModule.forRootAsync({
      inject: [authConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>) => ({
        issuer: auth.issuer,
        audience: auth.audience,
        keys: new URL(auth.jwksUrl),
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ValkeyThrottlerStorage, httpConfig.KEY],
      useFactory: (
        storage: ValkeyThrottlerStorage,
        http: ConfigType<typeof httpConfig>,
      ) => ({
        throttlers: [
          { name: "default", ttl: 60_000, limit: http.rateLimitPerMinute },
        ],
        storage,
      }),
    }),
    WalletModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
