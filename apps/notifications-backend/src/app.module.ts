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
  OutboxModule,
  ValkeyModule,
  ValkeyThrottlerStorage,
} from "@outegro/nest-common";
import {
  authConfig,
  dbConfig,
  rabbitConfig,
  valkeyConfig,
} from "./config/config.js";
import { AppConfigModule } from "./config/config.module.js";
import { env } from "./config/env.js";
import * as schema from "./db/schema.js";
import { NotificationsModule } from "./notifications.module.js";

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    createLoggerModule({
      service: "notifications-backend",
      level: env().LOG_LEVEL,
      pretty: env().NODE_ENV === "development",
    }),
    HealthModule,
    DatabaseModule.forRootAsync({
      schema,
      service: "notifications-backend",
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
        service: "notifications",
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
      inject: [ValkeyThrottlerStorage],
      useFactory: (storage: ValkeyThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 240 }],
        storage,
      }),
    }),
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
