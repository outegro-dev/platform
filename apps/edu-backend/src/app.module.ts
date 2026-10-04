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
  OutboxModule,
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
import { EduModule } from "./edu.module.js";

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "edu-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    MetricsModule.forRootAsync({
      inject: [metricsConfig.KEY],
      useFactory: (metrics: ConfigType<typeof metricsConfig>) => ({
        service: "edu-backend",
        port: metrics.port,
      }),
    }),
    DatabaseModule.forRootAsync({
      schema,
      service: "edu-backend",
      inject: [dbConfig.KEY],
      useFactory: (db: ConfigType<typeof dbConfig>) => db,
    }),
    ValkeyModule.forRootAsync({
      inject: [valkeyConfig.KEY],
      useFactory: (valkey: ConfigType<typeof valkeyConfig>) => valkey,
    }),
    MessagingModule.forRootAsync({
      inject: [rabbitConfig.KEY],
      useFactory: (rabbit: ConfigType<typeof rabbitConfig>) => ({
        url: rabbit.url,
        service: "edu",
      }),
    }),
    OutboxModule.forRoot(),
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
    EduModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
